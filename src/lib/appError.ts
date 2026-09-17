// Erro com CODIGO vindo do servidor (catalogo em supabase/functions/_shared/errors.ts).
//
// Regra (pedido do administrador, 17/09/2026): o usuario ve uma mensagem simples e acolhedora; o
// administrador ve o codigo e a causa real no /admin/audit. O servidor ja grava o log com a causa
// tecnica, entao o app NAO loga de novo um AppError -- antes cada falha virava 2 ou 3 linhas (o
// "credit balance" de 16/09 apareceu 66 vezes para 33 falhas).
//
// COOLDOWN: quando o problema so o administrador resolve (credito esgotado, IA pausada, teto do
// mes), insistir nao adianta. A Larissa tentou 16 vezes seguidas em 16/09. Durante o cooldown o app
// nem chama o servidor e o botao "Tentar novamente" fica desabilitado com o tempo restante.

export class AppError extends Error {
  code: string
  adminOnly: boolean
  retryAfterSec: number | null

  constructor(message: string, code: string, adminOnly = false, retryAfterSec: number | null = null) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.adminOnly = adminOnly
    this.retryAfterSec = retryAfterSec
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (!!err && typeof err === 'object' && typeof (err as AppError).code === 'string' && (err as AppError).name === 'AppError')
}

/** Codigos do freio de gasto/limite: o usuario pode tentar de novo, mas so depois de um tempo. */
const LIMIT_CODES = new Set([
  'BUDGET_DAILY_USER',
  'BUDGET_NOTES_PER_HOUR',
  'BUDGET_AUDIO_PER_DAY',
  'BUDGET_RATE_BURST',
])

const KEY = 'tailor.cooldown'

interface Cooldown {
  code: string
  message: string
  until: number
  adminOnly: boolean
}

function read(): Cooldown | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Cooldown
    if (!c?.until || c.until <= Date.now()) {
      localStorage.removeItem(KEY)
      return null
    }
    return c
  } catch {
    return null
  }
}

/**
 * Registra o cooldown de um erro, se ele pede um. Chamado por aiError ao receber um AppError.
 * So problemas do administrador e limites de uso ganham cooldown; um erro transitorio
 * ("sobrecarregado") nao trava o botao, so sugere esperar.
 */
export function registerCooldown(err: AppError): void {
  if (!err.adminOnly && !LIMIT_CODES.has(err.code)) return
  const seconds = Math.max(15, Math.min(err.retryAfterSec ?? 180, 1800))
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ code: err.code, message: err.message, until: Date.now() + seconds * 1000, adminOnly: err.adminOnly }),
    )
  } catch {
    /* sem localStorage (modo privado): segue sem cooldown */
  }
}

/** Cooldown ativo agora, ou null. */
export function activeCooldown(): Cooldown | null {
  return read()
}

/** Segundos restantes (arredondado para cima), 0 se livre. */
export function cooldownSecondsLeft(): number {
  const c = read()
  return c ? Math.ceil((c.until - Date.now()) / 1000) : 0
}

/**
 * Chamado ANTES de cada chamada paga. Com cooldown de um problema do administrador ativo, falha na
 * hora com a mesma mensagem -- sem ir ao servidor, sem gastar a cota de ninguem.
 */
export function assertNoAdminCooldown(): void {
  const c = read()
  if (c?.adminOnly) throw new AppError(c.message, c.code, true, Math.ceil((c.until - Date.now()) / 1000))
}

export function clearCooldown(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** "3 min" / "45 s" -- para o texto do botao desabilitado. */
export function formatWait(seconds: number): string {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`
  return `${Math.max(1, seconds)} s`
}
