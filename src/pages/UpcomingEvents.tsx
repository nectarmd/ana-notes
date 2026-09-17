import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ExternalLink, RefreshCw, Clock, Link2Off, Mic, Users } from 'lucide-react'
import {
  startCalendarConnect,
  finishCalendarConnect,
  disconnectCalendar,
  disconnectCalendarServer,
  listUpcomingEvents,
  type CalEvent,
  type CalError,
} from '../lib/googleCalendar'
import { fmtDate, fmtTime } from '../lib/format'
import { Spinner, Skeleton, Sheet } from '../components/ui'
import { ErrorNotice } from '../components/ErrorNotice'
import { useToast } from '../components/Toast'
import { useI18n } from '../lib/i18n'
import { AgendaView } from '../components/AgendaView'

const LOCALE: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }

/** No modo pagina a Agenda mostra UM mes por vez (antes: 50 eventos numa rolagem sem fim). */
const MONTH_MAX = 250
/** Ate onde da para navegar, em meses a partir do atual. */
const MONTH_MIN_OFFSET = -6
const MONTH_MAX_OFFSET = 12

/** Mes atual comeca HOJE (quem abre a Agenda quer ver o que vem); os dias ja passados deste mes
 *  aparecem sob demanda. Outros meses vem inteiros. */
function monthRange(offset: number, showPast: boolean) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
  const from = offset === 0 && !showPast ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : start
  return { from, to, month: start }
}

export function UpcomingEvents({ mode = 'card' }: { mode?: 'card' | 'page' }) {
  const isPage = mode === 'page'
  const [events, setEvents] = useState<CalEvent[]>([])
  // Otimista: comeca "conectado" mesmo sem token local -- o efeito abaixo sempre tenta renovar
  // em silencio via servidor (refresh_token e por CONTA, nao por navegador/dispositivo) antes
  // de decidir que precisa mesmo pedir para conectar de novo.
  const [needsAuth, setNeedsAuth] = useState(false)
  const [loading, setLoading] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [error, setError] = useState<CalError | null>(null)
  const [monthOffset, setMonthOffset] = useState(0)
  const [showPast, setShowPast] = useState(false)
  // Trocar de mes rapido dispara buscas em sequencia: so a ultima pode gravar o resultado.
  const reqSeq = useRef(0)
  const toast = useToast()
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  function recordFromEvent(e: CalEvent) {
    const qs = new URLSearchParams({ mode: 'meeting', title: e.title, context: e.title })
    navigate(`/capturar?${qs.toString()}`)
  }

  async function refresh(offset = monthOffset, past = showPast) {
    const seq = ++reqSeq.current
    setLoading(true)
    try {
      const r = isPage
        ? await listUpcomingEvents(MONTH_MAX, monthRange(offset, past))
        : await listUpcomingEvents(10)
      if (seq !== reqSeq.current) return
      setNeedsAuth(r.needsAuth)
      setEvents(r.events)
      setError(r.error ?? null)
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }

  function goMonth(offset: number) {
    const next = Math.min(MONTH_MAX_OFFSET, Math.max(MONTH_MIN_OFFSET, offset))
    setMonthOffset(next)
    setShowPast(false)
    setEvents([])
    window.scrollTo({ top: 0, behavior: 'smooth' })
    void refresh(next, false)
  }

  useEffect(() => {
    ;(async () => {
      const params = new URLSearchParams(window.location.search)
      const returning = params.has('code') || params.has('error')
      if (returning) setLoading(true)
      const res = await finishCalendarConnect()
      if (returning) setLoading(false)
      if (res.done) {
        if (res.ok) {
          setNeedsAuth(false)
          // No desktop os eventos ja aparecem no card + botao "Ver meus eventos" — nao abre o popup.
          const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
          if (!isPage && !isDesktop) setEventsOpen(true)
          toast('Google Calendar conectado')
          refresh()
        } else {
          setNeedsAuth(true)
          setError({ key: 'common.errorGeneric', detail: res.error })
        }
        return
      }
      // Sempre tenta: mesmo sem token local, o servidor pode renovar sozinho via refresh_token
      // salvo de uma conexao anterior (outro navegador/dispositivo, ou so o token de 1h expirou).
      refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function connect() {
    setError(null)
    setLoading(true)
    const res = startCalendarConnect()
    if (!res.ok) {
      setError({ key: 'common.errorGeneric', detail: res.error })
      setLoading(false)
    }
  }

  async function disconnect() {
    // A limpeza local acontece de qualquer forma; o servidor (revoga + apaga o refresh_token)
    // e melhor esforco -- sem isto o Calendario voltaria sozinho na proxima vez.
    await disconnectCalendarServer()
    disconnectCalendar()
    setNeedsAuth(true)
    setEvents([])
    setEventsOpen(false)
    toast('Google Calendar desconectado', 'info')
  }

  const errorBlock = error ? (
    <ErrorNotice className="text-xs" message={t(error.key)} detail={error.detail} />
  ) : null

  function eventLine(e: CalEvent) {
    return (
      <>
        {e.start ? fmtDate(e.start) : ''}
        {e.start && !e.allDay ? ` · ${fmtTime(e.start)}` : e.allDay ? ` · ${t('events.allDay')}` : ''}
      </>
    )
  }

  /* ----------------------- Modo PAGINA (rota /agenda) ---------------------- */
  if (isPage) {
    if (needsAuth) {
      return (
        <div className="card p-6 sm:p-8 text-center max-w-lg mx-auto">
          <span className="grid place-items-center h-14 w-14 rounded-2xl bg-accent/10 text-accent mx-auto mb-4">
            <CalendarDays size={26} />
          </span>
          <p className="font-display font-semibold text-lg">{t('events.connect')}</p>
          <p className="text-sm text-content-muted mt-1 mb-5">{t('events.connectSub')}</p>
          <button className="btn-primary w-full sm:w-auto px-5" onClick={connect} disabled={loading}>
            {loading ? <Spinner /> : <CalendarDays size={18} />}
            {t('events.connect')}
          </button>
          {errorBlock && <div className="mt-4 text-left">{errorBlock}</div>}
        </div>
      )
    }

    return (
      <AgendaView
        events={events}
        loading={loading}
        error={errorBlock}
        onRefresh={() => refresh()}
        onDisconnect={disconnect}
        onRecord={recordFromEvent}
        month={monthRange(monthOffset, showPast).month}
        monthOffset={monthOffset}
        canPrev={monthOffset > MONTH_MIN_OFFSET}
        canNext={monthOffset < MONTH_MAX_OFFSET}
        onMonth={goMonth}
        showPast={showPast}
        onShowPast={() => {
          setShowPast(true)
          setEvents([])
          void refresh(monthOffset, true)
        }}
      />
    )
  }

  /* ------------- Modo SECAO (tela inicial, ABAIXO das notas) -------------------
   * Os proximos 5 compromissos em cartoes, cada um com gravar e entrar na chamada, e o atalho
   * para o calendario no titulo. Nasceu do retorno de 17/09/2026: a agenda tinha virado uma linha
   * so no topo (pouca informacao) e antes disso um cartao espremido ao lado das notas. */
  const dayLabel = (iso: string) => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
    const same = (x: Date, y: Date) => x.toDateString() === y.toDateString()
    const now = new Date()
    if (same(d, now)) return t('events.today')
    if (same(d, new Date(now.getTime() + 86400000))) return t('events.tomorrow')
    return d.toLocaleDateString(LOCALE[lang] ?? 'pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  /** Comeca em menos de 1 h (ou ja esta rolando): o cartao ganha destaque. */
  const isSoon = (e: CalEvent) => {
    if (e.allDay || !e.start) return false
    const start = new Date(e.start).getTime()
    const end = e.end ? new Date(e.end).getTime() : start + 30 * 60000
    const now = Date.now()
    return now < end && start - now < 60 * 60000
  }

  const durationLabel = (e: CalEvent) => {
    if (e.allDay || !e.end || !e.start) return null
    const min = Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000)
    if (min <= 0) return null
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    const m = min % 60
    return m ? `${h} h ${m} min` : `${h} h`
  }

  const joinLink = (e: CalEvent) => e.joinUrl ?? (e.location?.startsWith('https://') ? e.location : null)

  return (
    <section className="mt-8 mb-6 md:mb-20">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="flex items-center gap-2 font-display font-semibold shrink-0">
          <CalendarDays size={18} className="text-accent" /> {t('events.title')}
        </h2>
        {/* Linha fina ligando o titulo aos botoes: separa a agenda das notas sem pesar. */}
        <span aria-hidden className="h-px flex-1 bg-surface-border" />
        {!needsAuth && (
          <button
            onClick={() => refresh()}
            className="grid place-items-center h-8 w-8 rounded-lg text-content-muted hover:bg-surface-elevated hover:text-content-primary shrink-0"
            aria-label={t('events.update')}
            title={t('events.update')}
          >
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
          </button>
        )}
        <button onClick={() => navigate('/agenda')} className="btn-outline h-8 px-3 text-xs shrink-0">
          <CalendarDays size={14} /> {t('events.seeAgenda')}
        </button>
      </div>

      {needsAuth ? (
        <div className="card p-4 flex flex-col md:flex-row md:items-center gap-3">
          <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/10 text-accent shrink-0">
            <CalendarDays size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('events.connect')}</p>
            <p className="text-sm text-content-muted">{t('events.connectSub')}</p>
          </div>
          <button className="btn-neutral w-full md:w-auto shrink-0 text-sm px-3.5 py-2" onClick={connect} disabled={loading}>
            {loading ? <Spinner /> : <CalendarDays size={18} className="text-accent" />}
            {t('events.connect')}
          </button>
          {errorBlock && <div className="md:hidden">{errorBlock}</div>}
        </div>
      ) : loading && events.length === 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="card p-3.5">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-4 w-full mb-1.5" />
              <Skeleton className="h-3 w-2/3" />
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <div className="card p-6 text-center">
          <CalendarDays size={22} className="mx-auto text-content-muted mb-2" />
          <p className="text-sm text-content-muted">{t('events.none')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {events.slice(0, 5).map((e) => {
            const soon = isSoon(e)
            const dur = durationLabel(e)
            const join = joinLink(e)
            return (
              <li
                key={e.id}
                className={`card p-3.5 flex flex-col gap-2 transition-all hover:shadow-hover ${
                  soon ? 'border-accent/40 bg-accent/5' : ''
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0 ${
                      soon ? 'bg-brand-solid text-white' : 'bg-surface-elevated text-content-muted'
                    }`}
                  >
                    {dayLabel(e.start)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums truncate">
                    {e.allDay ? t('events.allDay') : fmtTime(e.start)}
                  </span>
                </div>

                <p className="font-medium text-sm leading-snug line-clamp-2 break-words">{e.title}</p>

                <p className="text-xs text-content-muted flex flex-wrap items-center gap-x-3 gap-y-1">
                  {dur && <span>{dur}</span>}
                  {e.attendees > 1 && (
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} /> {e.attendees}
                    </span>
                  )}
                </p>

                <div className="flex gap-2 mt-auto pt-1">
                  <button
                    onClick={() => recordFromEvent(e)}
                    title={t('events.record')}
                    className={`${soon ? 'btn-primary' : 'btn-outline'} h-8 px-2.5 text-xs flex-1 whitespace-nowrap`}
                  >
                    <Mic size={14} /> {t('events.recordShort')}
                  </button>
                  {join && (
                    <a
                      href={join}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-ghost h-8 px-2.5 text-xs shrink-0"
                      title={t('events.join')}
                      aria-label={t('events.join')}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {errorBlock && <div className="mt-3">{errorBlock}</div>}

      {eventsOpen && (
        <Sheet open={eventsOpen} onClose={() => setEventsOpen(false)} title={t('events.mine')}>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => refresh()}
              className="flex items-center gap-1.5 text-sm text-content-secondary hover:text-content-primary"
            >
              {loading ? <Spinner size={14} /> : <RefreshCw size={14} />} {t('events.update')}
            </button>
            <button onClick={disconnect} className="flex items-center gap-1 text-xs text-content-muted hover:text-accent">
              <Link2Off size={12} /> {t('events.disconnect')}
            </button>
          </div>

          {loading && events.length === 0 ? (
            <div className="grid place-items-center py-8">
              <Spinner className="text-accent" />
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-content-muted text-center py-6">{t('events.none')}</p>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3 min-w-0 max-h-[60vh] overflow-y-auto pr-1">
              {events.map((e) => (
                <li key={e.id} className="card p-4 min-w-0">
                  <div className="flex gap-3">
                    <div className="grid place-items-center h-10 w-10 rounded-xl bg-brand-solid text-white shrink-0">
                      <CalendarDays size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{e.title}</p>
                      <p className="text-xs text-content-muted mt-0.5 flex items-center gap-1">
                        <Clock size={12} />
                        {eventLine(e)}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => recordFromEvent(e)} className="btn-outline w-full h-9 mt-3 text-sm">
                    <Mic size={16} /> {t('events.record')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </section>
  )
}
