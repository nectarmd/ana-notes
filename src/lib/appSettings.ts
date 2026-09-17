// Configuracoes globais: aviso (banner) e modo manutencao.
// Real: tabela app_settings (Supabase). Mock: localStorage.

import { config } from './config'
import { supabase } from './supabase'
import type { AppSettings } from './types'

const DEFAULTS: AppSettings = {
  announcement_enabled: false,
  announcement_type: 'info',
  announcement_message: '',
  announcement_starts_at: null,
  announcement_ends_at: null,
  announcement_version: 0,
  maintenance_enabled: false,
  maintenance_message: 'Estamos em manutencao. Voltamos em breve.',
  maintenance_eta: '',
  tips_rotate_enabled: false,
  tips_rotate_hours: 72,
  // Devem espelhar os defaults da migration 0019.
  ai_enabled: true,
  ai_daily_usd_per_user: 2,
  ai_monthly_usd_global: 300,
  ai_rate_per_min: 20,
  ai_daily_alert_usd: 10,
  // Devem espelhar os defaults da migration 0038.
  ai_notes_per_hour_per_user: 20,
  ai_audio_minutes_per_day_per_user: 480,
  provider_billing: { anthropic: 'paid', openai: 'paid', groq: 'free', assemblyai: 'free' },
  provider_limits: {
    groq: { requests_min: 20, requests_day: 2000, audio_seconds_hour: 7200, audio_seconds_day: 28800 },
    assemblyai: { credit_usd: 50 },
    anthropic: { balance_usd: null, balance_set_at: null },
  },
  ai_breaker: {},
}

const KEY = 'tailor.appsettings'

export async function getAppSettings(): Promise<AppSettings> {
  if (config.mockMode) {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
    } catch {
      return DEFAULTS
    }
  }
  if (!supabase) return DEFAULTS
  try {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).single()
    if (error || !data) return DEFAULTS
    return { ...DEFAULTS, ...(data as Partial<AppSettings>) }
  } catch {
    return DEFAULTS
  }
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (config.mockMode) {
    const cur = await getAppSettings()
    const next = { ...cur, ...patch }
    localStorage.setItem(KEY, JSON.stringify(next))
    return next
  }
  if (!supabase) throw new Error('Supabase nao configurado')
  const { data, error } = await supabase
    .from('app_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select()
    .single()
  if (error) throw error
  return { ...DEFAULTS, ...(data as Partial<AppSettings>) }
}

/** Aviso deve aparecer agora? (habilitado, com texto e dentro do periodo) */
export function announcementActive(s: AppSettings | null): boolean {
  if (!s || !s.announcement_enabled || !s.announcement_message.trim()) return false
  const now = Date.now()
  if (s.announcement_starts_at && now < Date.parse(s.announcement_starts_at)) return false
  if (s.announcement_ends_at && now > Date.parse(s.announcement_ends_at)) return false
  return true
}
