// Log de auditoria: erros gerais, silenciosos, de usuario e de seguranca. So o administrador
// le (RLS em audit_log); o cliente so GRAVA atraves da edge function `log-event` (a tabela nao
// tem policy de insert -- ver supabase/migrations/0026_audit_log.sql).

import { supabase } from './supabase'
import { config } from './config'
import { describeUnknownError } from './errorMessage'

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical'
export type AuditCategory = 'system' | 'user' | 'silent' | 'security'

export interface AuditLogRow {
  id: string
  created_at: string
  severity: AuditSeverity
  category: AuditCategory
  source: string
  message: string
  detail: Record<string, unknown> | null
  user_id: string | null
  note_id: string | null
  route: string | null
  user_agent: string | null
  resolved_at: string | null
  resolved_by: string | null
}

/* ---------------------------------------------------------------------------
 * Escrita (qualquer usuario logado, atraves da edge function -- nunca direto na tabela)
 * ------------------------------------------------------------------------- */

interface LogClientInput {
  /** Default 'error'. O servidor rebaixa qualquer coisa fora de info/warning/error. */
  severity?: 'info' | 'warning' | 'error'
  /** Default 'system'. O servidor rebaixa qualquer coisa fora de system/user/silent. */
  category?: 'system' | 'user' | 'silent'
  source: string
  message: string
  /** Codigo para agrupar no /admin/audit (ex.: NETWORK, CLIENT_UNEXPECTED). */
  code?: string
  detail?: Record<string, unknown>
  note_id?: string
}

/**
 * SEMPRE solta (fire-and-forget): nunca lanca, nunca precisa ser aguardada por quem chama, e
 * a propria promise interna sempre tem `.catch()` (senao uma falha de rede aqui dispararia um
 * NOVO `unhandledrejection`, que tentaria logar de novo -- loop). Se o app estiver em modo
 * mock ou sem Supabase configurado, e um no-op.
 */
export function logClientError(input: LogClientInput): void {
  if (config.mockMode || !supabase) return
  try {
    const body = {
      severity: input.severity ?? 'error',
      category: input.category ?? 'system',
      source: input.source,
      code: input.code,
      message: input.message.slice(0, 500),
      detail: input.detail,
      note_id: input.note_id,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }
    void supabase.functions.invoke('log-event', { body }).catch(() => {})
  } catch {
    /* nunca deixa o log quebrar quem chamou */
  }
}

/**
 * Atalho para o padrao mais comum no app: `catch { toast(t('common.error'), 'error') }` mostra
 * uma mensagem generica pro usuario e joga fora o erro real, sem registrar nada em lugar
 * nenhum. Uma linha no catch (antes do toast) resolve, sem mudar o que o usuario ve.
 */
export function logSilentError(source: string, err: unknown): void {
  logClientError({
    severity: 'error',
    category: 'system',
    source,
    message: describeUnknownError(err),
    detail: err instanceof Error ? { stack: err.stack?.slice(0, 1000) } : undefined,
  })
}

/* ---------------------------------------------------------------------------
 * Leitura (somente admin -- pagina /admin/audit)
 * ------------------------------------------------------------------------- */

export interface AuditLogFilters {
  from: string // ISO
  to: string // ISO
  severities?: AuditSeverity[]
  categories?: AuditCategory[]
  search?: string
  /** Default false: um evento marcado como resolvido some da lista (senao a tela so acumula
   *  pra sempre, mesmo depois do bug corrigido). Ligar pra ver o historico completo. */
  includeResolved?: boolean
}

export interface AuditLogCursor {
  created_at: string
  id: string
}

const PAGE_SIZE = 50

/**
 * Paginacao por CURSOR composto (created_at, id), nao por offset: sob uma rajada de erro,
 * varias linhas podem ter o mesmissimo created_at (mesmo milissegundo) -- cursor so em
 * created_at pularia ou duplicaria linhas nessa fronteira.
 */
export async function listAuditLog(
  filters: AuditLogFilters,
  cursor?: AuditLogCursor,
): Promise<AuditLogRow[]> {
  if (!supabase) return []
  let q = supabase
    .from('audit_log')
    .select('*')
    .gte('created_at', filters.from)
    .lte('created_at', filters.to)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE)

  if (filters.severities?.length) q = q.in('severity', filters.severities)
  if (filters.categories?.length) q = q.in('category', filters.categories)
  if (filters.search?.trim()) q = q.ilike('message', `%${filters.search.trim()}%`)
  if (!filters.includeResolved) q = q.is('resolved_at', null)
  if (cursor) {
    q = q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as AuditLogRow[]
}

/** Marca uma ou mais linhas como resolvidas -- somem da lista padrao (includeResolved=false). */
export async function resolveAuditLog(ids: string[], resolvedBy: string): Promise<void> {
  if (!supabase || !ids.length) return
  const { error } = await supabase
    .from('audit_log')
    .update({ resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .in('id', ids)
  if (error) throw error
}

/** Desfaz a resolucao (caso tenha marcado sem querer). */
export async function unresolveAuditLog(ids: string[]): Promise<void> {
  if (!supabase || !ids.length) return
  const { error } = await supabase
    .from('audit_log')
    .update({ resolved_at: null, resolved_by: null })
    .in('id', ids)
  if (error) throw error
}

export interface AuditLogSummary {
  total: number
  bySeverity: Record<AuditSeverity, number>
  distinctUsers: number
}

export function summarizeAuditLog(rows: AuditLogRow[]): AuditLogSummary {
  const bySeverity: Record<AuditSeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 }
  const users = new Set<string>()
  for (const r of rows) {
    bySeverity[r.severity]++
    if (r.user_id) users.add(r.user_id)
  }
  return { total: rows.length, bySeverity, distinctUsers: users.size }
}
