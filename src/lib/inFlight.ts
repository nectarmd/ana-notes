// Trava contra pedido repetido: enquanto uma acao com a mesma chave esta em andamento, uma nova
// chamada NAO dispara outra requisicao (devolve `undefined` na hora). Existe por causa da
// auditoria de 27/10/2026: Enter segurado no "Perguntar as notas", chat enviando duas perguntas
// juntas, "Detalhado" disparando de novo ao trocar de aba, botao de parar a gravacao clicado duas
// vezes criando duas notas...
//
// Fica FORA do componente de proposito: sair da tela e voltar enquanto a IA ainda responde nao
// libera um segundo pedido igual (o estado do React morre com a tela, este Set nao).
//
// A chave identifica O QUE esta rodando (ex.: `summary:<noteId>`), nao quem clicou: acoes
// diferentes, ou a mesma acao em notas diferentes, continuam rodando em paralelo normalmente.

const running = new Set<string>()

export function isRunning(key: string): boolean {
  return running.has(key)
}

/** Roda `fn` se nada com a mesma `key` estiver em andamento; senao devolve `undefined` sem chamar. */
export async function runOnce<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (running.has(key)) return undefined
  running.add(key)
  try {
    return await fn()
  } finally {
    running.delete(key)
  }
}

const shared = new Map<string, Promise<unknown>>()

/**
 * Como runOnce, mas quem chega depois ESPERA o mesmo pedido em vez de desistir: serve para a
 * tela que pode ser reaberta no meio da geracao (mapa mental) e precisa mostrar o resultado.
 */
export function shareInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = shared.get(key)
  if (existing) return existing as Promise<T>
  const p = fn().finally(() => shared.delete(key))
  shared.set(key, p)
  return p
}

const lastRun = new Map<string, number>()

/**
 * Para acoes que terminam rapido mas nao devem ser repetidas em rajada (cutucar um amigo,
 * atualizar a agenda): `true` se pode rodar agora, e ja marca o horario.
 */
export function allowEvery(key: string, ms: number): boolean {
  const now = Date.now()
  const last = lastRun.get(key) ?? 0
  if (now - last < ms) return false
  lastRun.set(key, now)
  return true
}
