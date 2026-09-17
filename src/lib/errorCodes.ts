// O que cada CODIGO de erro significa para quem administra, e o que fazer.
//
// O catalogo que decide status HTTP, mensagem ao usuario, alerta e disjuntor mora no servidor
// (supabase/functions/_shared/errors.ts). Este aqui e so a leitura humana para o /admin/audit:
// antes a tela mostrava a mensagem crua (`Anthropic 400: {"type":"error",...}`) e cabia a quem lia
// adivinhar se era grave e o que fazer.

export interface CodeInfo {
  /** Nome curto do problema. */
  title: string
  /** O que fazer. `null` quando o app ja trata sozinho e nao ha acao. */
  action: string | null
  /** Quem resolve: o admin (provedor, chave, credito), o usuario, ou ninguem (ja tratado). */
  owner: 'admin' | 'user' | 'auto'
}

const CODES: Record<string, CodeInfo> = {
  // ---------------------------------------------------------------- IA (Anthropic)
  AI_CREDIT_EXHAUSTED: {
    title: 'Créditos da Anthropic esgotados',
    action: 'Recarregue em console.anthropic.com → Billing. O app volta sozinho em até 10 minutos, ou libere na hora em Custos das APIs → Freios.',
    owner: 'admin',
  },
  AI_AUTH_INVALID: {
    title: 'Chave da Anthropic recusada',
    action: 'Confira ANTHROPIC_API_KEY nos secrets do Supabase (chave revogada ou digitada errada).',
    owner: 'admin',
  },
  AI_PROVIDER_RATE_LIMIT: {
    title: 'Limite de taxa da Anthropic',
    action: 'Se repetir com frequência, peça aumento de limite da organização no console da Anthropic.',
    owner: 'admin',
  },
  AI_OVERLOADED: { title: 'Anthropic sobrecarregada', action: null, owner: 'auto' },
  AI_PROVIDER_ERROR: {
    title: 'Erro inesperado da Anthropic',
    action: 'Veja status.anthropic.com. Se não houver incidente e continuar, abra as ocorrências para ver o detalhe.',
    owner: 'admin',
  },
  AI_OUTPUT_INVALID: {
    title: 'Resposta da IA malformada',
    action: 'Ocasional é normal (o usuário tenta de novo). Muitas seguidas indicam prompt ou limite de tokens a revisar.',
    owner: 'auto',
  },
  AI_EMPTY_TRANSCRIPT: { title: 'IA chamada sem transcrição', action: null, owner: 'auto' },
  AI_BAD_REQUEST: {
    title: 'Requisição inválida à IA',
    action: 'Indica bug ou chamada fora do app. Abra as ocorrências e veja a origem.',
    owner: 'admin',
  },
  AI_IMAGE_INVALID: { title: 'Imagem em formato não aceito', action: null, owner: 'user' },
  AI_IMAGE_TOO_LARGE: { title: 'Imagem acima de 5 MB', action: null, owner: 'user' },

  // ---------------------------------------------------------------- transcricao
  TRANSCRIBE_FILE_MISSING: { title: 'Transcrição sem arquivo', action: 'Indica bug no envio. Veja a origem nas ocorrências.', owner: 'admin' },
  TRANSCRIBE_TOO_LARGE: { title: 'Arquivo acima de 60 MB', action: null, owner: 'user' },
  TRANSCRIBE_TOO_LONG: { title: 'Áudio acima de 2 horas', action: null, owner: 'user' },
  TRANSCRIBE_EMPTY_FILE: {
    title: 'Gravação sem áudio (arquivo vazio)',
    action: 'Normalmente o microfone não entregou som. Se repetir com a mesma pessoa, confira o dispositivo dela.',
    owner: 'user',
  },
  TRANSCRIBE_EMPTY_RESULT: { title: 'Transcrição voltou vazia', action: null, owner: 'user' },
  TRANSCRIBE_INVALID_MEDIA: { title: 'Áudio ilegível para o provedor', action: null, owner: 'user' },
  TRANSCRIBE_PROVIDER_LIMIT: {
    title: 'Limite do plano do Groq',
    action: 'O app manda para o AssemblyAI quando chega perto do limite. Se aparecer, o AssemblyAI também falhou: confira crédito e chave.',
    owner: 'admin',
  },
  TRANSCRIBE_PROVIDER_AUTH: {
    title: 'Chave ou crédito de transcrição recusado',
    action: 'Confira GROQ_API_KEY / ASSEMBLYAI_API_KEY nos secrets do Supabase e o crédito do AssemblyAI.',
    owner: 'admin',
  },
  TRANSCRIBE_PROVIDER_TOO_LARGE: {
    title: 'Arquivo grande demais para o Groq',
    action: 'Desde a v0.19.6 esses arquivos vão para o AssemblyAI. Ocorrências anteriores a 10/09 já foram corrigidas.',
    owner: 'auto',
  },
  TRANSCRIBE_JOB_FAILED: { title: 'AssemblyAI não conseguiu transcrever', action: null, owner: 'user' },
  TRANSCRIBE_DEDUPED: {
    title: 'Mesmo áudio enviado de novo (reaproveitado)',
    action: 'Nada a fazer: a transcrição já feita foi devolvida sem custo. Muitas ocorrências indicam alguém repetindo o envio.',
    owner: 'auto',
  },
  TRANSCRIBE_JOB_UNREACHABLE: { title: 'AssemblyAI não respondeu à consulta', action: null, owner: 'auto' },
  TRANSCRIBE_PROVIDER_ERROR: {
    title: 'Erro inesperado do provedor de transcrição',
    action: 'Veja status.groq.com / status.assemblyai.com. Se não houver incidente e continuar, abra as ocorrências.',
    owner: 'admin',
  },

  // ---------------------------------------------------------------- freio e medidor
  AUTH_SESSION_INVALID: { title: 'Sessão expirada', action: null, owner: 'user' },
  BUDGET_UNAVAILABLE: {
    title: 'Medidor de gasto indisponível',
    action: 'Sem o medidor nenhuma chamada paga passa. Veja se o Supabase está com instabilidade (status.supabase.com).',
    owner: 'admin',
  },
  AI_DISABLED: { title: 'IA pausada pelo administrador', action: 'Reative em Custos das APIs → Freios, se foi sem querer.', owner: 'admin' },
  BUDGET_MONTHLY_GLOBAL: {
    title: 'Teto mensal de gasto atingido',
    action: 'A IA parou para todos. Suba o teto em Custos das APIs → Freios se o gasto for esperado.',
    owner: 'admin',
  },
  BUDGET_DAILY_USER: { title: 'Usuário no limite diário de gasto', action: 'Se for uso legítimo, aumente o limite em Freios.', owner: 'admin' },
  BUDGET_NOTES_PER_HOUR: { title: 'Usuário no limite de notas por hora', action: 'Se for uso legítimo, aumente o limite em Freios.', owner: 'admin' },
  BUDGET_AUDIO_PER_DAY: { title: 'Usuário no limite diário de áudio', action: 'Se for uso legítimo, aumente o limite em Freios.', owner: 'admin' },
  BUDGET_RATE_BURST: {
    title: 'Rajada de chamadas (anti-abuso)',
    action: 'Uso humano raramente chega aqui. Veja quem foi e se há automação usando a conta.',
    owner: 'admin',
  },
  BUDGET_DAILY_ALERT: { title: 'Gasto do dia acima do alerta', action: 'Confira em Custos das APIs quem e qual função puxaram o gasto.', owner: 'admin' },
  PROVIDER_ASSEMBLYAI_CREDIT_LOW: {
    title: 'Crédito do AssemblyAI acabando',
    action: 'Adicione crédito em assemblyai.com/dashboard e atualize o valor em Custos das APIs → Provedores.',
    owner: 'admin',
  },
  PROVIDER_ANTHROPIC_BALANCE_LOW: {
    title: 'Saldo da Anthropic acabando',
    action: 'Recarregue em console.anthropic.com → Billing e atualize o saldo em Custos das APIs → Provedores.',
    owner: 'admin',
  },
  PROVIDER_GROQ_FREE_TIER_NEAR_LIMIT: {
    title: 'Groq perto do limite gratuito',
    action: 'O excesso vai para o AssemblyAI. Se virar rotina, avalie o plano pago do Groq.',
    owner: 'admin',
  },

  // ---------------------------------------------------------------- gravador e cliente
  RECORDER_SYSTEM_AUDIO_MISSING: {
    title: 'Reunião no PC sem o áudio do sistema',
    action: 'Só a voz de quem gravou entra. O usuário já recebe o passo a passo na tela; se repetir com a mesma pessoa, ajude-a a conferir a saída de som.',
    owner: 'user',
  },
  RECORDER_SYSTEM_AUDIO_MUTED: {
    title: 'Áudio do sistema mudo por 30s ou mais',
    action: 'Comum em silêncios longos da reunião. Só preocupa se a transcrição sair sem a fala dos outros participantes.',
    owner: 'user',
  },
  NETWORK: { title: 'Falha de conexão do usuário', action: null, owner: 'auto' },
  CLIENT_SINGLE_ROW_NOT_FOUND: {
    title: 'Registro não encontrado',
    action: 'Geralmente nota apagada ou link antigo aberto. Muitas ocorrências da mesma rota indicam bug.',
    owner: 'auto',
  },
  CLIENT_SCRIPT_ERROR: { title: 'Erro de script sem detalhe', action: 'O navegador esconde a causa (extensão ou script de outro domínio).', owner: 'auto' },
  CLIENT_LEGACY_MESSAGE: { title: 'Erro com mensagem antiga', action: 'Tela ainda sem código próprio. Abra as ocorrências para ver a origem.', owner: 'admin' },
  CLIENT_UNEXPECTED: { title: 'Erro inesperado no app', action: 'Abra as ocorrências: a origem e a rota mostram onde está o bug.', owner: 'admin' },
  UNEXPECTED: { title: 'Erro não classificado no servidor', action: 'Abra as ocorrências: o detalhe mostra a causa.', owner: 'admin' },
  ADMIN_REGENERATE_NOTE: { title: 'Resumo regenerado pelo administrador', action: null, owner: 'auto' },
}

export const OWNER_LABEL: Record<CodeInfo['owner'], string> = {
  admin: 'Você resolve',
  user: 'Do lado do usuário',
  auto: 'O app já trata',
}

export function codeInfo(code: string, sample?: string | null): CodeInfo {
  if (CODES[code]) return CODES[code]
  return { title: sample?.slice(0, 120) || code, action: null, owner: 'admin' }
}
