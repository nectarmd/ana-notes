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
  /** Codigo do problema (desde 17/09/2026). Linhas antigas: null -- o banco deduz pelo texto. */
  code: string | null
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
 *
 * Desde 17/09/2026 a tela agrupa por PROBLEMA (codigo) e os numeros saem do banco (RPC
 * audit_summary, migration 0039). Antes os KPIs contavam so os 50 registros carregados e o mesmo
 * problema aparecia como dezenas de linhas soltas.
 * ------------------------------------------------------------------------- */

export interface AuditLogFilters {
  from: string // ISO
  to: string // ISO
  severities?: AuditSeverity[]
  categories?: AuditCategory[]
  search?: string
  /** Default false: resolvido some da lista. Ligar para ver o historico completo. */
  includeResolved?: boolean
}

export interface AuditGroup {
  /** Codigo do problema, ou 'SEM_CODIGO' (agrupado por `pattern`, a mensagem sem numeros). */
  code: string
  pattern: string | null
  occurrences: number
  open: number
  users: number
  severity: AuditSeverity
  first_at: string
  last_at: string
  sources: string[]
  sample: string
}

export interface AuditSummary {
  totals: { events: number; errors: number; critical: number; users: number }
  groups: AuditGroup[]
}

export async function getAuditSummary(f: AuditLogFilters): Promise<AuditSummary> {
  if (!supabase) return { totals: { events: 0, errors: 0, critical: 0, users: 0 }, groups: [] }
  const { data, error } = await supabase.rpc('audit_summary', {
    p_from: f.from,
    p_to: f.to,
    p_severities: f.severities?.length ? f.severities : null,
    p_categories: f.categories?.length ? f.categories : null,
    p_search: f.search?.trim() || null,
    p_include_resolved: !!f.includeResolved,
  })
  if (error) throw error
  const s = data as AuditSummary
  return {
    totals: {
      events: Number(s.totals.events),
      errors: Number(s.totals.errors),
      critical: Number(s.totals.critical),
      users: Number(s.totals.users),
    },
    groups: (s.groups ?? []).map((g) => ({ ...g, occurrences: Number(g.occurrences), open: Number(g.open), users: Number(g.users) })),
  }
}

export async function listAuditOccurrences(g: AuditGroup, f: AuditLogFilters, limit = 100): Promise<AuditLogRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('audit_occurrences', {
    p_code: g.code,
    p_pattern: g.pattern ?? '',
    p_from: f.from,
    p_to: f.to,
    p_include_resolved: !!f.includeResolved,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as AuditLogRow[]
}

/** Resolve (ou reabre) todas as ocorrencias do grupo no periodo. Devolve quantas mudaram. */
export async function resolveAuditGroup(g: AuditGroup, f: AuditLogFilters, resolve: boolean): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('audit_resolve_group', {
    p_code: g.code,
    p_pattern: g.pattern ?? '',
    p_from: f.from,
    p_to: f.to,
    p_resolve: resolve,
  })
  if (error) throw error
  return Number(data ?? 0)
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
