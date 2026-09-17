// Leitura do consumo das APIs pagas. So o administrador enxerga (RLS + checagem no RPC).
//
// Desde 17/09/2026 a agregacao roda NO BANCO (RPC usage_report, migration 0038). Antes o painel
// puxava linhas cruas com .limit(5000): com 25 usuarios isso estoura em poucas semanas e TODOS os
// KPIs ficam errados em silencio. E cada linha tem custo REAL (o que sai do caixa) separado do custo
// de TABELA (quanto custaria se o provedor fosse cobrado) -- Groq e AssemblyAI em tier gratuito
// inflavam o painel de US$ 5,31 para US$ 20,54 em 30 dias.

import { supabase } from './supabase'
import type { AdminAlert } from './types'

export type Provider = 'anthropic' | 'groq' | 'assemblyai' | 'openai'

/** Ordem FIXA: a cor de cada provedor segue a entidade, nunca a posicao no ranking. */
export const PROVIDERS: Provider[] = ['anthropic', 'groq', 'assemblyai', 'openai']

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  groq: 'Groq',
  assemblyai: 'AssemblyAI',
  openai: 'OpenAI',
}

/**
 * Paleta categorica validada (scripts/validate_palette.js da skill de dataviz) contra o card
 * claro #ffffff e o escuro #161619: passa CVD e distincao normal. No tema claro, AssemblyAI e
 * OpenAI ficam abaixo de 3:1 de contraste -- por isso toda barra tem o valor em texto ao lado e o
 * grafico diario tem visao em tabela.
 */
export const PROVIDER_COLOR: Record<string, { light: string; dark: string }> = {
  anthropic: { light: '#2a78d6', dark: '#3987e5' },
  groq: { light: '#eb6834', dark: '#d95926' },
  assemblyai: { light: '#1baf7a', dark: '#199e70' },
  openai: { light: '#eda100', dark: '#c98500' },
}

export const TASK_LABEL: Record<string, string> = {
  transcription: 'Transcrição',
  summary: 'Resumo e itens de ação',
  action_items: 'Itens de ação (chamada separada)',
  detailed: 'Resumo detalhado',
  analysis: 'Análise da reunião',
  chat: 'Chat com a nota',
  mindmap: 'Mapa mental',
  feedback: 'Feedback',
  translate: 'Tradução',
  help: 'Ajuda da ANA',
  search: 'Busca em todas as notas',
  image: 'Leitura de imagem',
}

export const taskLabel = (t: string) => TASK_LABEL[t] ?? t

// ------------------------------------------------------------------------------ periodo

export type PeriodKey = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom'

export interface Period {
  key: PeriodKey
  from: Date
  to: Date
}

export function periodRange(key: PeriodKey, custom?: { from: string; to: string }): Period {
  const now = new Date()
  if (key === 'custom' && custom?.from && custom?.to) {
    const f = new Date(`${custom.from}T00:00:00`)
    const t = new Date(`${custom.to}T23:59:59.999`)
    return { key, from: f, to: t }
  }
  if (key === 'today') {
    const f = new Date(now)
    f.setHours(0, 0, 0, 0)
    return { key, from: f, to: now }
  }
  if (key === 'month') {
    return { key, from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
  }
  if (key === 'lastMonth') {
    const f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const t = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    return { key, from: f, to: t }
  }
  const f = new Date(now.getTime() - (key === '7d' ? 7 : 30) * 86400000)
  return { key, from: f, to: now }
}

/** Dias (fracionados) cobertos pela janela, minimo de 1 hora para nao explodir projecoes. */
export function periodDays(p: Period): number {
  return Math.max(1 / 24, (p.to.getTime() - p.from.getTime()) / 86400000)
}

/**
 * Projecao para 30 dias. No "mes atual" projeta o FECHAMENTO do mes (gasto ate agora / dias
 * decorridos x dias do mes) -- e o numero que se compara com o teto mensal do freio.
 */
export function projectMonth(value: number, p: Period): number {
  if (p.key === 'month') {
    const now = p.to
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const elapsed = Math.max(1 / 24, (now.getTime() - p.from.getTime()) / 86400000)
    return (value / elapsed) * daysInMonth
  }
  return (value / periodDays(p)) * 30
}

// ------------------------------------------------------------------------------ relatorio

export interface Money {
  cost_list: number
  cost_real: number
}

export interface UsageReport {
  totals: Money & {
    calls: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    audio_seconds: number
    users: number
  }
  by_provider: Array<Money & { provider: string; has_paid: boolean; has_free: boolean; calls: number; audio_seconds: number; tokens: number }>
  by_task: Array<
    Money & {
      task: string
      provider: string
      model: string
      calls: number
      audio_seconds: number
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
    }
  >
  by_user: Array<Money & { user_id: string | null; name: string | null; email: string | null; calls: number; audio_seconds: number; notes: number }>
  by_user_task: Array<Money & { user_id: string | null; task: string; provider: string; calls: number; audio_seconds: number; tokens: number }>
  by_day: Array<Money & { day: string; provider: string; calls: number; audio_seconds: number }>
  notes: { count: number; with_audio: number; audio_seconds: number; users: number }
  lifetime: {
    assemblyai_cost_list: number
    anthropic_real_since_balance: number
    groq_audio_seconds_last_hour: number
    groq_audio_seconds_today: number
    groq_requests_today: number
    groq_peak_hour_seconds_30d: number
    groq_peak_day_seconds_30d: number
  }
}

/** O Postgres devolve numeric como string no JSON: converte tudo que parece numero. */
function numify<T>(value: T): T {
  if (Array.isArray(value)) return value.map(numify) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && k !== 'day' ? Number(v) : numify(v)
    }
    return out as T
  }
  return value
}

export async function getUsageReport(p: Period, provider: Provider | null): Promise<UsageReport> {
  if (!supabase) throw new Error('Supabase nao configurado')
  const { data, error } = await supabase.rpc('usage_report', {
    p_from: p.from.toISOString(),
    p_to: p.to.toISOString(),
    p_provider: provider,
  })
  if (error) throw error
  return numify(data as UsageReport)
}

/** Economia do cache da Anthropic: tokens lidos do cache custam 10% da entrada normal. */
const INPUT_PRICE_PER_MTOK: Record<string, number> = {
  'claude-haiku-4-5-20251001': 1.0,
  'claude-sonnet-5': 2.0,
}
export function cacheSavingsUsd(r: UsageReport): number {
  return r.by_task.reduce((acc, t) => {
    const price = INPUT_PRICE_PER_MTOK[t.model] ?? 0
    return acc + (t.cache_read_tokens * price * 0.9) / 1e6
  }, 0)
}

// ------------------------------------------------------------------------------ alertas

export async function listAdminAlerts(): Promise<AdminAlert[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('admin_alerts')
    .select('*')
    .is('resolved_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(50)
  if (error) throw error
  const rank = { critical: 0, error: 1, warning: 2 } as const
  return ((data ?? []) as AdminAlert[]).sort((a, b) => rank[a.severity] - rank[b.severity])
}

export async function resolveAdminAlert(id: string, userId: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('admin_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)
  if (error) throw error
}

/**
 * Troca o modo de cobranca de um provedor. `since` remarca o historico a partir da data (ex.:
 * descobriu que o Groq ja era pago desde o dia 1); sem `since`, so vale daqui para frente.
 */
export async function setProviderBilling(provider: Provider, mode: 'paid' | 'free', since: string | null): Promise<number> {
  if (!supabase) throw new Error('Supabase nao configurado')
  const { data, error } = await supabase.rpc('set_provider_billing', {
    p_provider: provider,
    p_mode: mode,
    p_since: since ? new Date(`${since}T00:00:00`).toISOString() : null,
  })
  if (error) throw error
  return Number(data ?? 0)
}

// ------------------------------------------------------------------------------ formatos

export const compactNum = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
    : n >= 1000
      ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
      : String(Math.round(n))

/** "54 min", "3,2 h" -- para audio. */
export function fmtAudio(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${(seconds / 3600).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
}
