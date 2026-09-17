// Integracao com Google Calendar (leitura).
// Fluxo: authorization code por redirect. O client e "confidencial" (tem secret),
// entao o Google bloqueia o fluxo implicit; a troca do code por token e feita na
// Edge Function google-oauth (que guarda o CLIENT_SECRET no servidor).

import { config } from './config'
import { supabase } from './supabase'

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const STORE = 'tailor.gcal'

export interface CalEvent {
  id: string
  title: string
  start: string
  /** Fim do evento (dateTime ou date). Vazio quando o Google nao informa. */
  end: string
  allDay: boolean
  /** Link da chamada (Meet ou outro provedor de videoconferencia), quando houver. */
  joinUrl: string | null
  location: string | null
  /** Quantidade de convidados (inclui voce). 0 quando o evento nao tem convidados. */
  attendees: number
}


function storedToken(): string | null {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return null
    const { token, exp } = JSON.parse(raw)
    return Date.now() < exp ? token : null
  } catch {
    return null
  }
}

export function isCalendarConnected(): boolean {
  return !!storedToken()
}

export function disconnectCalendar(): void {
  localStorage.removeItem(STORE)
}

/**
 * Desconecta de verdade: revoga o refresh_token guardado no servidor e apaga o registro (sem
 * isto, o Calendario voltaria sozinho na proxima vez, ja que o refresh_token e por CONTA, nao
 * por navegador). Melhor esforco -- o disconnectCalendar() local sempre acontece de qualquer
 * forma, entao uma falha aqui nao deixa o usuario preso no fluxo de desconectar.
 */
export async function disconnectCalendarServer(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.functions.invoke('google-oauth', { body: { action: 'disconnect' } })
  } catch {
    /* melhor esforco */
  }
}

/**
 * Renova o access_token em silencio (sem reabrir a tela do Google), usando o refresh_token
 * guardado no servidor desde a ultima vez que o usuario autorizou -- em qualquer navegador
 * ou dispositivo, ja que o refresh_token e salvo por conta.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('google-oauth', { body: { action: 'refresh' } })
    if (error) return null
    const d = data as { access_token?: string; expires_in?: number }
    if (!d.access_token) return null
    localStorage.setItem(
      STORE,
      JSON.stringify({ token: d.access_token, exp: Date.now() + (d.expires_in ? d.expires_in * 1000 : 3300000) }),
    )
    return d.access_token
  } catch {
    return null
  }
}

/**
 * Token valido para usar AGORA: o do navegador (se ainda nao expirou) ou, senao, um novo via
 * refresh_token no servidor. So volta null (pedindo reconexao) se nem isso funcionar -- ex.:
 * o usuario nunca conectou, ou revogou o acesso direto no Google.
 */
async function getValidToken(): Promise<string | null> {
  return storedToken() ?? (await refreshAccessToken())
}

/* ---------------------------------------------------------------------------
 * Fluxo AUTHORIZATION CODE por redirect (funciona no celular e no PWA).
 * 1) startCalendarConnect() manda a pagina para o Google (response_type=code).
 * 2) Ao voltar, a URL tem ?code=... ; finishCalendarConnect() troca o code por
 *    um access_token via Edge Function e salva.
 * ------------------------------------------------------------------------- */
const STATE_KEY = 'tailor.gcal.state'

function redirectUri(): string {
  return window.location.origin + '/'
}

/** Inicia a conexao redirecionando a pagina para o consentimento do Google. */
export function startCalendarConnect(): { ok: boolean; error?: string } {
  if (!config.googleClientId) {
    return { ok: false, error: 'Client ID do Google não configurado (VITE_GOOGLE_CLIENT_ID).' }
  }
  const state = Math.random().toString(36).slice(2)
  try {
    sessionStorage.setItem(STATE_KEY, state)
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    include_granted_scopes: 'true',
    // 'offline' + prompt=consent (abaixo): o Google emite um refresh_token, guardado no
    // servidor (google-oauth) para renovar o access_token em silencio depois -- sem isto, so
    // dava pra ter um access_token de ~1h, sem jeito de renovar sem reabrir esta tela.
    access_type: 'offline',
    state,
    // Permite escolher/trocar a conta e reexibe o consentimento.
    prompt: 'select_account consent',
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return { ok: true }
}

/**
 * Ao voltar do Google: se houver ?code=..., troca por token via Edge Function.
 * Retorna { done } indicando se havia um retorno OAuth para tratar.
 */
export async function finishCalendarConnect(): Promise<{ done: boolean; ok?: boolean; error?: string }> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const err = params.get('error')
  const state = params.get('state')
  if (!code && !err) return { done: false }

  let saved: string | null = null
  try {
    saved = sessionStorage.getItem(STATE_KEY)
    sessionStorage.removeItem(STATE_KEY)
  } catch {
    /* ignore */
  }
  // Limpa a URL (remove code/state/error).
  history.replaceState(null, '', window.location.pathname)

  if (err) {
    return { done: true, ok: false, error: err === 'access_denied' ? 'Permissão negada no Google.' : `Erro do Google: ${err}` }
  }
  if (saved && state !== saved) {
    return { done: true, ok: false, error: 'Falha de segurança (state) ao conectar. Tente de novo.' }
  }
  if (!supabase) {
    return { done: true, ok: false, error: 'Supabase não configurado para concluir a conexão.' }
  }
  try {
    const { data, error } = await supabase.functions.invoke('google-oauth', {
      body: { code, redirect_uri: redirectUri(), client_id: config.googleClientId },
    })
    if (error) return { done: true, ok: false, error: error.message || 'Falha ao trocar o código.' }
    const d = data as { access_token?: string; expires_in?: number; error?: string }
    if (d.access_token) {
      localStorage.setItem(
        STORE,
        JSON.stringify({ token: d.access_token, exp: Date.now() + (d.expires_in ? d.expires_in * 1000 : 3300000) }),
      )
      return { done: true, ok: true }
    }
    return { done: true, ok: false, error: d.error || 'O Google não retornou um token.' }
  } catch (e) {
    return { done: true, ok: false, error: String(e) }
  }
}

/** Erro estruturado: a UI mostra `key` (traduzida) e esconde `detail` atras de "ver mais". */
export interface CalError {
  key: string
  detail?: string
}

const TIMEOUT_MS = 12000

/** fetch com timeout. Sem isso, uma rede lenta trava o carregamento indefinidamente. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

export async function listUpcomingEvents(
  max = 5,
): Promise<{ needsAuth: boolean; events: CalEvent[]; error?: CalError }> {
  const token = await getValidToken()
  if (!token) return { needsAuth: true, events: [] }

  // O navegador ja sabe que nao ha rede: nem tenta (e evita o "TypeError: Load failed").
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { needsAuth: false, events: [], error: { key: 'err.offline' } }
  }

  const now = new Date().toISOString()
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(now)}&maxResults=${max}&singleEvents=true&orderBy=startTime`
  const init = { headers: { Authorization: `Bearer ${token}` } }

  let lastErr: unknown = null
  // Uma retentativa: falhas de rede momentaneas sao comuns quando o app volta do
  // segundo plano no celular (o Safari aborta o fetch e joga "Load failed").
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init)

      if (res.status === 401) {
        disconnectCalendar()
        return { needsAuth: true, events: [], error: { key: 'err.calExpired' } }
      }
      if (!res.ok) {
        return {
          needsAuth: false,
          events: [],
          error: {
            key: res.status === 403 ? 'err.calForbidden' : 'err.calApi',
            detail: `HTTP ${res.status} ${res.statusText}`,
          },
        }
      }

      const data = await res.json()
      const events: CalEvent[] = (data.items ?? []).map((e: {
        id: string
        summary?: string
        start?: { dateTime?: string; date?: string }
        end?: { dateTime?: string; date?: string }
        hangoutLink?: string
        location?: string
        attendees?: unknown[]
        conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
      }) => ({
        id: e.id,
        title: e.summary || '(sem título)',
        start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '',
        allDay: !e.start?.dateTime,
        joinUrl:
          e.hangoutLink ||
          e.conferenceData?.entryPoints?.find((x) => x.entryPointType === 'video' && x.uri?.startsWith('https://'))?.uri ||
          null,
        location: e.location?.trim() || null,
        attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
      }))
      return { needsAuth: false, events }
    } catch (e) {
      lastErr = e
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      if (aborted) break // timeout: repetir so aumentaria a espera
      if (attempt === 0) await new Promise((r) => setTimeout(r, 700))
    }
  }

  const aborted = lastErr instanceof DOMException && lastErr.name === 'AbortError'
  return {
    needsAuth: false,
    events: [],
    error: { key: aborted ? 'err.timeout' : 'err.network', detail: String(lastErr) },
  }
}
