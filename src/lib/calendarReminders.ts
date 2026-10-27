// Lembretes de eventos do Google Calendar enquanto o app esta aberto.
// (PWA sem push server-side: os lembretes disparam com o app aberto/em segundo plano.)

import { getNotifPrefs, notify } from './notifications'
import { listUpcomingEvents } from './googleCalendar'
import { getLang } from './lang'
import { logClientError } from './auditLog'
import { describeUnknownError } from './errorMessage'

const REMIND_WINDOW_MIN = 15 // avisa quando faltar entre 0 e 15 min para o evento
const POLL_MS = 3 * 60 * 1000 // reconsulta a cada 3 min
const SEEN_KEY = 'tailor.gcal.reminded'

function getSeen(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'))
  } catch {
    return new Set()
  }
}
function saveSeen(s: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-100)))
  } catch {
    /* ignore */
  }
}

function texts(title: string, mins: number): { t: string; b: string } {
  const l = getLang()
  if (l === 'en') return { t: 'Meeting soon', b: `${title} starts in ${mins} min` }
  if (l === 'es') return { t: 'Reunión pronto', b: `${title} empieza en ${mins} min` }
  return { t: 'Reunião em breve', b: `${title} começa em ${mins} min` }
}

/** Inicia o verificador de lembretes. Retorna funcao de limpeza. */
export function startCalendarReminders(): () => void {
  let stopped = false
  let lastFailureLogged = false // evita logar a mesma falha recorrente a cada 3min
  // Lembrete ligado mas Google desconectado (ou acesso revogado): cada ciclo ia ao servidor
  // tentar renovar o token e voltava sem nada, a cada 3 min, para sempre. Agora espera 30 min.
  let pauseUntil = 0

  async function tick() {
    if (stopped) return
    try {
      if (!getNotifPrefs().calendar) return
      if (Date.now() < pauseUntil) return
      // listUpcomingEvents ja tenta renovar o token sozinho (refresh_token no servidor); se
      // mesmo assim precisar de reconexao, needsAuth vem true e so pulamos este ciclo.
      const { needsAuth, events } = await listUpcomingEvents(10)
      if (needsAuth) {
        pauseUntil = Date.now() + 30 * 60_000
        return
      }
      lastFailureLogged = false
      const now = Date.now()
      const seen = getSeen()
      let changed = false
      for (const e of events) {
        if (!e.start || e.allDay) continue
        const start = Date.parse(e.start)
        if (Number.isNaN(start)) continue
        const mins = (start - now) / 60000
        const key = `${e.id}@${start}`
        if (mins > 0 && mins <= REMIND_WINDOW_MIN && !seen.has(key)) {
          const { t, b } = texts(e.title, Math.max(1, Math.round(mins)))
          notify(t, b)
          seen.add(key)
          changed = true
        }
      }
      if (changed) saveSeen(seen)
    } catch (err) {
      // Falha de rede/quota nao deve quebrar o app (por isso engolida aqui) -- mas o usuario
      // fica sem lembretes sem saber por que; loga uma vez por falha, nao a cada 3min.
      if (!lastFailureLogged) {
        lastFailureLogged = true
        logClientError({
          severity: 'warning',
          category: 'silent',
          source: 'client:calendarReminders',
          message: describeUnknownError(err),
        })
      }
    }
  }

  tick()
  const id = window.setInterval(tick, POLL_MS)
  return () => {
    stopped = true
    window.clearInterval(id)
  }
}
