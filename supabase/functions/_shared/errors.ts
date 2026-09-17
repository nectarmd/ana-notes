// Catalogo UNICO de erros das edge functions.
//
// Regra (pedido do administrador, 17/09/2026): o USUARIO ve uma mensagem simples e acolhedora,
// que nunca expoe detalhe tecnico; o ADMINISTRADOR ve no audit_log o CODIGO e a causa real.
// Antes, a mesma string ia para os dois lugares -- e o usuario lia coisas como
// `Anthropic 400: {"type":"error",...credit balance is too low}`.
//
// Este arquivo NAO importa nada de proposito: guard.ts importa daqui, e daqui importar guard.ts
// criaria import circular.

// @ts-nocheck  (ambiente Deno)

export type Severity = 'info' | 'warning' | 'error' | 'critical'
export type Category = 'system' | 'user' | 'silent' | 'security'

export interface ErrorDef {
  status: number
  severity: Severity
  category: Category
  /** O que o usuario le. Simples, sem jargao, sem culpa. */
  user: string
  /** O que o administrador le no log: a causa e, quando possivel, onde resolver. */
  admin: string
  /** Problema que SO o administrador resolve: o app para de oferecer "tentar de novo". */
  adminOnly?: boolean
  /** Cria/incrementa um alerta em admin_alerts (um por codigo, com contagem e usuarios). */
  alert?: boolean
  /** Abre o disjuntor do provedor por N minutos: nem chega a chamar o provedor. */
  breaker?: { provider: string; minutes: number }
  /** Quanto tempo o app espera antes de deixar tentar de novo. */
  retryAfterSec?: number
}

const INDISPONIVEL_ADMIN_AVISADO =
  'A inteligência artificial está indisponível no momento. O administrador já foi avisado e vai resolver. Sua gravação e a transcrição continuam salvas.'

export const ERRORS: Record<string, ErrorDef> = {
  // ---------------------------------------------------------------- sessao / medidor
  AUTH_SESSION_INVALID: {
    status: 401, severity: 'warning', category: 'user',
    user: 'Sua sessão expirou. Entre novamente para continuar.',
    admin: 'Sessao invalida ou token recusado pelo servidor de autenticacao.',
  },
  BUDGET_UNAVAILABLE: {
    status: 503, severity: 'critical', category: 'silent', alert: true, retryAfterSec: 30,
    user: 'Não conseguimos concluir agora. Tente novamente em alguns instantes.',
    admin: 'Medidor de orcamento indisponivel (usage_guard falhou). Sem ele, nenhuma chamada paga e liberada.',
  },

  // ---------------------------------------------------------------- freio de gasto
  AI_DISABLED: {
    status: 503, severity: 'info', category: 'user', adminOnly: true, retryAfterSec: 300,
    user: 'As funções de inteligência artificial estão pausadas pelo administrador no momento.',
    admin: 'IA desligada em app_settings.ai_enabled.',
  },
  BUDGET_MONTHLY_GLOBAL: {
    status: 503, severity: 'critical', category: 'system', adminOnly: true, alert: true, retryAfterSec: 900,
    user: 'A inteligência artificial atingiu o limite de uso deste mês. O administrador já foi avisado e vai liberar em breve.',
    admin: 'Teto mensal global de gasto REAL atingido (ai_monthly_usd_global). Suba o teto em /admin/api se for o caso.',
  },
  BUDGET_DAILY_USER: {
    status: 429, severity: 'info', category: 'user', alert: true, retryAfterSec: 1800,
    user: 'Você atingiu seu limite diário de uso da IA. Ele é renovado amanhã.',
    admin: 'Usuario atingiu o limite diario de gasto real (ai_daily_usd_per_user).',
  },
  BUDGET_NOTES_PER_HOUR: {
    status: 429, severity: 'info', category: 'user', alert: true, retryAfterSec: 600,
    user: 'Você processou muitas notas na última hora. Aguarde alguns minutos e tente novamente.',
    admin: 'Usuario atingiu o limite de notas por hora (ai_notes_per_hour_per_user).',
  },
  BUDGET_AUDIO_PER_DAY: {
    status: 429, severity: 'info', category: 'user', alert: true, retryAfterSec: 1800,
    user: 'Você atingiu o limite diário de minutos de transcrição. Ele é renovado amanhã.',
    admin: 'Usuario atingiu o limite diario de minutos de audio (ai_audio_minutes_per_day_per_user).',
  },
  BUDGET_RATE_BURST: {
    status: 429, severity: 'warning', category: 'security', alert: true, retryAfterSec: 60,
    user: 'Muitas solicitações em sequência. Aguarde um minuto e tente novamente.',
    admin: 'Rajada de chamadas acima da protecao anti-abuso (ai_rate_per_min).',
  },

  // ---------------------------------------------------------------- Anthropic
  AI_CREDIT_EXHAUSTED: {
    status: 503, severity: 'critical', category: 'system', adminOnly: true, alert: true,
    breaker: { provider: 'anthropic', minutes: 10 }, retryAfterSec: 300,
    user: INDISPONIVEL_ADMIN_AVISADO,
    admin: 'Creditos da Anthropic esgotados. Recarregue em console.anthropic.com > Billing.',
  },
  AI_AUTH_INVALID: {
    status: 503, severity: 'critical', category: 'security', adminOnly: true, alert: true,
    breaker: { provider: 'anthropic', minutes: 10 }, retryAfterSec: 300,
    user: INDISPONIVEL_ADMIN_AVISADO,
    admin: 'Chave da Anthropic invalida ou revogada (ANTHROPIC_API_KEY nos secrets do Supabase).',
  },
  AI_PROVIDER_RATE_LIMIT: {
    status: 503, severity: 'error', category: 'system', alert: true, retryAfterSec: 60,
    user: 'Muita gente usando a inteligência artificial agora. Tente novamente em um minuto.',
    admin: 'Anthropic recusou por limite de taxa da organizacao (429) mesmo apos novas tentativas.',
  },
  AI_OVERLOADED: {
    status: 503, severity: 'warning', category: 'system', retryAfterSec: 30,
    user: 'A inteligência artificial está sobrecarregada neste momento. Tente novamente em alguns instantes.',
    admin: 'Anthropic sobrecarregada (529) mesmo apos novas tentativas.',
  },
  AI_PROVIDER_ERROR: {
    status: 502, severity: 'error', category: 'system', alert: true, retryAfterSec: 30,
    user: 'Não conseguimos gerar agora. Tente novamente em alguns instantes.',
    admin: 'Erro inesperado devolvido pela Anthropic.',
  },
  AI_OUTPUT_INVALID: {
    status: 502, severity: 'warning', category: 'system', retryAfterSec: 5,
    user: 'A inteligência artificial não conseguiu gerar este conteúdo agora. Tente novamente.',
    admin: 'Resposta da IA em formato invalido (JSON truncado ou malformado).',
  },
  AI_EMPTY_TRANSCRIPT: {
    status: 422, severity: 'warning', category: 'user',
    user: 'Esta nota não tem transcrição para processar.',
    admin: 'Chamada de IA com transcricao vazia (barrada antes de gastar).',
  },
  AI_BAD_REQUEST: {
    status: 400, severity: 'warning', category: 'system',
    user: 'Não foi possível processar esta solicitação.',
    admin: 'Task invalida ou corpo da requisicao malformado.',
  },
  AI_IMAGE_INVALID: {
    status: 400, severity: 'warning', category: 'user',
    user: 'Formato de imagem não suportado. Envie PNG, JPG, WEBP ou GIF.',
    admin: 'Imagem com media_type fora da lista aceita.',
  },
  AI_IMAGE_TOO_LARGE: {
    status: 413, severity: 'warning', category: 'user',
    user: 'Esta imagem é muito grande. O limite é 5 MB.',
    admin: 'Imagem acima de 5 MB.',
  },

  // ---------------------------------------------------------------- transcricao
  TRANSCRIBE_FILE_MISSING: {
    status: 400, severity: 'warning', category: 'system',
    user: 'Nenhum áudio foi recebido. Tente enviar de novo.',
    admin: 'Requisicao de transcricao sem o campo file.',
  },
  TRANSCRIBE_TOO_LARGE: {
    status: 413, severity: 'warning', category: 'user',
    user: 'Este arquivo passa do limite de 60 MB. Divida o áudio ou converta para MP3 e envie de novo.',
    admin: 'Arquivo acima de MAX_FILE_MB.',
  },
  TRANSCRIBE_TOO_LONG: {
    status: 413, severity: 'warning', category: 'user',
    user: 'Este áudio passa do limite de 2 horas. Divida em partes e envie de novo.',
    admin: 'Audio acima de MAX_AUDIO_SECONDS.',
  },
  TRANSCRIBE_EMPTY_FILE: {
    status: 422, severity: 'warning', category: 'user',
    user: 'Esta gravação não tem áudio (arquivo vazio), então não há o que transcrever.',
    admin: 'Provedor recusou: arquivo vazio.',
  },
  TRANSCRIBE_INVALID_MEDIA: {
    status: 422, severity: 'warning', category: 'user',
    user: 'Não conseguimos ler este áudio. Se enviou um arquivo, tente outro formato (MP3, M4A, WAV ou WEBM).',
    admin: 'Provedor nao conseguiu decodificar o arquivo (could not process file).',
  },
  TRANSCRIBE_PROVIDER_LIMIT: {
    status: 503, severity: 'error', category: 'system', alert: true, retryAfterSec: 120,
    user: 'Muitas transcrições em andamento agora. Tente novamente em alguns minutos.',
    admin: 'Groq recusou por limite do plano (429) e o AssemblyAI nao estava disponivel como alternativa.',
  },
  TRANSCRIBE_PROVIDER_AUTH: {
    status: 503, severity: 'critical', category: 'security', adminOnly: true, alert: true, retryAfterSec: 300,
    user: 'A transcrição está indisponível no momento. O administrador já foi avisado e vai resolver. Sua gravação continua salva neste aparelho.',
    admin: 'Provedor de transcricao recusou a chave ou o credito (401/402/403). Confira GROQ_API_KEY / ASSEMBLYAI_API_KEY.',
  },
  TRANSCRIBE_PROVIDER_TOO_LARGE: {
    status: 413, severity: 'error', category: 'system', alert: true,
    user: 'Este arquivo é grande demais para transcrever agora. Converta para MP3 e envie de novo.',
    admin: 'Groq recusou pelo tamanho (413) e o AssemblyAI nao estava disponivel como alternativa.',
  },
  TRANSCRIBE_JOB_FAILED: {
    status: 422, severity: 'warning', category: 'user',
    user: 'Não conseguimos transcrever este áudio. Tente outro arquivo ou formato.',
    admin: 'Trabalho do AssemblyAI terminou com status error.',
  },
  TRANSCRIBE_JOB_UNREACHABLE: {
    status: 502, severity: 'warning', category: 'system', retryAfterSec: 10,
    user: 'Não conseguimos acompanhar a transcrição agora. Tentando de novo em instantes.',
    admin: 'Nao foi possivel consultar o trabalho no AssemblyAI.',
  },
  TRANSCRIBE_PROVIDER_ERROR: {
    status: 502, severity: 'error', category: 'system', alert: true, retryAfterSec: 30,
    user: 'Não conseguimos transcrever agora. Tente novamente em alguns instantes — sua gravação continua salva.',
    admin: 'Erro inesperado do provedor de transcricao (5xx) mesmo apos novas tentativas e sem alternativa.',
  },

  // ---------------------------------------------------------------- generico
  UNEXPECTED: {
    status: 500, severity: 'error', category: 'system', alert: true, retryAfterSec: 10,
    user: 'Algo deu errado do nosso lado. O problema foi registrado e será analisado.',
    admin: 'Erro nao classificado.',
  },
}

/** Erro com codigo do catalogo. `technical` vai SO para o log, nunca para o usuario. */
export class CodedError extends Error {
  code: string
  technical: string
  constructor(code: string, technical = '') {
    super(`[${code}] ${technical}`.trim())
    this.code = ERRORS[code] ? code : 'UNEXPECTED'
    this.technical = technical
  }
}

/** Anthropic: status + corpo -> codigo. `retryable` = vale tentar de novo na hora. */
export function classifyAnthropic(status: number, body: string): { code: string; retryable: boolean } {
  const b = (body ?? '').toLowerCase()
  // O "credit balance is too low" chega como 400 invalid_request_error, nao como 402 -- visto em
  // producao em 26/08 e 16/09. Por isso a mensagem decide antes do status.
  if (b.includes('credit balance') || status === 402 || b.includes('billing_error')) {
    return { code: 'AI_CREDIT_EXHAUSTED', retryable: false }
  }
  if (status === 401 || status === 403 || b.includes('authentication_error') || b.includes('permission_error')) {
    return { code: 'AI_AUTH_INVALID', retryable: false }
  }
  if (status === 429) return { code: 'AI_PROVIDER_RATE_LIMIT', retryable: true }
  if (status === 529 || b.includes('overloaded_error')) return { code: 'AI_OVERLOADED', retryable: true }
  if (status >= 500) return { code: 'AI_PROVIDER_ERROR', retryable: true }
  return { code: 'AI_PROVIDER_ERROR', retryable: false }
}

/** Groq/OpenAI Whisper: status + corpo -> codigo. `fallback` = vale mandar para o AssemblyAI. */
export function classifyWhisper(status: number, body: string): { code: string; retryable: boolean; fallback: boolean } {
  const b = (body ?? '').toLowerCase()
  if (status === 413 || b.includes('entity too large') || b.includes('request_too_large')) {
    return { code: 'TRANSCRIBE_PROVIDER_TOO_LARGE', retryable: false, fallback: true }
  }
  if (b.includes('file is empty')) return { code: 'TRANSCRIBE_EMPTY_FILE', retryable: false, fallback: false }
  if (b.includes('could not process file') || b.includes('valid media file')) {
    // Ja apareceu em gravacoes que o navegador decodifica sem problema: tenta de novo e, se
    // persistir, o AssemblyAI (outro decodificador) costuma ler.
    return { code: 'TRANSCRIBE_INVALID_MEDIA', retryable: true, fallback: true }
  }
  if (status === 401 || status === 402 || status === 403) {
    return { code: 'TRANSCRIBE_PROVIDER_AUTH', retryable: false, fallback: true }
  }
  if (status === 429) return { code: 'TRANSCRIBE_PROVIDER_LIMIT', retryable: false, fallback: true }
  if (status >= 500) return { code: 'TRANSCRIBE_PROVIDER_ERROR', retryable: true, fallback: true }
  return { code: 'TRANSCRIBE_PROVIDER_ERROR', retryable: false, fallback: true }
}
