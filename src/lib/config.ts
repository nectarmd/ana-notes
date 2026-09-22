// Central configuration. Reads Vite env vars; falls back to "mock mode"
// so the whole app is navegable/testavel sem backend nem chaves de IA.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const config = {
  supabaseUrl: url ?? '',
  supabaseAnonKey: anon ?? '',
  /** When Supabase is not configured we run fully local (localStorage). */
  mockMode: !url || !anon,

  /** Only e-mails deste dominio podem se cadastrar. */
  allowedDomain: 'tailorexec.com.br',
  adminEmail: 'flavio.junior@tailorexec.com.br',

  /** Limite inicial de duracao de gravacao (2 horas). */
  recordingMaxSeconds: 2 * 60 * 60,

  /**
   * Bitrate do audio gravado (voz). 24 kbps mono em Opus basta para fala — o Whisper
   * reamostra tudo para 16 kHz de qualquer jeito. Corta pela METADE o storage e o egress,
   * que sao os dois primeiros limites que estouramos no Supabase.
   */
  recordingBitrate: 24000,

  /** Retencao padrao do audio: excluido apos N dias (a transcricao e mantida). */
  audioRetentionDays: 3,

  /** Client ID (publico) do Google para ler o calendario no navegador. */
  googleClientId: (
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ??
    '243945952349-f7jboe6oan0oauijb5bbpbqnur9jnrra.apps.googleusercontent.com'
  ).trim(),

  app: {
    name: 'ANA - AI Notes Advisor',
    shortName: 'ANA',
  },
} as const

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === config.adminEmail
}

export function isAllowedDomain(email: string): boolean {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  return domain === config.allowedDomain
}
