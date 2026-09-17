import { logClientError } from './auditLog'
import { describeUnknownError } from './errorMessage'
import { isAppError, registerCooldown } from './appError'

/**
 * As edge functions devolvem `{ error: "..." }` com mensagem pronta quando barram a chamada
 * (cota diaria, teto mensal, rate limit, arquivo grande demais). Nesses casos o usuario
 * precisa ler o motivo, nao um "algo deu errado" generico.
 */
const FRIENDLY = [
  'limite diario',
  'orcamento mensal',
  'Muitas solicitacoes',
  'temporariamente desativadas',
  'muito grande',
  'Limite de',
  'acima do limite',
  'Sessao invalida',
  'nao conseguiu gerar',
  'verificar o orcamento',
  'transcricao esta vazia',
  'conseguimos ler', // "Nao conseguimos ler este audio..." (formato/arquivo invalido)
]

/**
 * Subconjunto de FRIENDLY que e o freio de orcamento FUNCIONANDO certo, nao um bug -- e ja
 * aparece agregado no /admin/api (calls_last_min, budget_alerts). Logar de novo aqui seria
 * so ruido: um usuario testando o limite geraria uma linha de audit_log por tentativa.
 */
const EXPECTED_LIMITS = ['limite diario', 'orcamento mensal', 'Muitas solicitacoes', 'temporariamente desativadas']

/**
 * Mensagens que a PROPRIA edge function ja loga (no catch OU nas barreiras de guarda -- ver
 * logAuditServer em ai/index.ts e transcribe/index.ts), com contexto melhor (task, userId,
 * tamanho). Logar de novo aqui so duplicaria a linha no /admin/audit. Tudo o que NAO estiver
 * aqui (erro de rede, 413 do gateway, provedor fora do ar, mensagem inesperada) continua sendo
 * logado pelo cliente -- que muitas vezes e a UNICA rede que ve esses casos.
 */
const ALREADY_LOGGED_SERVER = [
  'nao conseguiu gerar',
  'transcricao esta vazia',
  'muito grande', // "Arquivo muito grande" / "Imagem muito grande"
  'acima do limite', // "Audio acima do limite de 2 horas"
  'task invalida',
  'conseguimos ler', // "Nao conseguimos ler este audio..." (logado em edge:transcribe)
]

/**
 * Falha de REDE na camada de conexao: a requisicao nem chegou ao servidor. Cada navegador usa uma
 * frase diferente. NAO e bug do sistema -- e a internet do usuario que caiu/oscilou, ou o request
 * foi abortado (troca de rede, app em segundo plano, reload da pagina no meio de um upload de
 * audio, que e o caso mais comum no /capturar). Merece uma mensagem clara de conexao pro usuario e
 * um registro como AVISO silencioso (nao deve inflar "Erros + criticos" no /admin/audit como se
 * fosse um defeito nosso). Ex. real: Larissa Estrada, /capturar, 29/07 -- upload de audio cortado.
 */
const NETWORK = [
  'Failed to fetch', // Chrome/Electron
  'Failed to send a request', // supabase-js FunctionsFetchError: o fetch em si falhou (upload grande abortado, rede)
  'Load failed', // Safari/iOS
  'NetworkError', // Firefox
  'network request failed',
  'ERR_NETWORK',
  'ERR_INTERNET_DISCONNECTED',
  'net::ERR',
  'The Internet connection appears to be offline',
]

/**
 * Funcao usada como `setError(aiError(err, ...))`/`toast(aiError(err, ...), 'error')` em toda
 * tela que chama IA -- por isso PRECISA continuar sincrona (nunca vire async, nunca faça
 * `await logClientError(...)`): se retornasse uma Promise, `setError` receberia um objeto em
 * vez de uma string e quebraria a tela em vez de so deixar de logar direito. O log roda solto,
 * sem bloquear o retorno.
 */
export function aiError(err: unknown, fallback: string): string {
  // Erro com codigo do servidor (catalogo em _shared/errors.ts): a mensagem ja e a amigavel, e o
  // servidor ja gravou o log com a causa tecnica -- logar aqui so duplicaria a linha. So resta
  // aplicar o cooldown quando o problema e do administrador ou um limite de uso.
  if (isAppError(err)) {
    registerCooldown(err)
    return err.message
  }

  const msg = describeUnknownError(err)
  if (!msg) return fallback

  // Erro de rede: mensagem clara de conexao + registro como AVISO silencioso (nao como "erro").
  if (NETWORK.some((n) => msg.includes(n))) {
    logClientError({
      severity: 'warning',
      category: 'silent',
      source: 'client:aiError',
      code: 'NETWORK',
      message: `Falha de rede: ${msg}`,
    })
    return 'Sem conexão com o servidor agora. Verifique sua internet e tente novamente.'
  }

  const matched = FRIENDLY.some((f) => msg.includes(f))
  const isExpectedLimit = EXPECTED_LIMITS.some((f) => msg.includes(f))
  const isAlreadyLoggedServer = ALREADY_LOGGED_SERVER.some((f) => msg.includes(f))
  if (!isExpectedLimit && !isAlreadyLoggedServer) {
    logClientError({
      severity: matched ? 'warning' : 'error',
      category: matched ? 'user' : 'system',
      source: 'client:aiError',
      code: matched ? 'CLIENT_LEGACY_MESSAGE' : 'CLIENT_UNEXPECTED',
      message: msg,
      detail: err instanceof Error ? { stack: err.stack?.slice(0, 2000) } : undefined,
    })
  }
  // Mensagem crua do servidor/provedor NUNCA vai para o usuario (ja apareceu
  // `Anthropic 400: {"type":"error"...}` na tela). So as frases conhecidas passam.
  return matched ? msg : fallback
}
