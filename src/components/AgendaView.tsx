import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  Link2Off,
  MapPin,
  Mic,
  RefreshCw,
  Users,
} from 'lucide-react'
import type { CalEvent } from '../lib/googleCalendar'
import { useI18n } from '../lib/i18n'
import { Spinner } from './ui'

const LOCALE: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }

/** 'YYYY-MM-DD' (evento de dia inteiro) e meia-noite LOCAL, nao UTC. */
function toDate(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Agenda (/agenda). Eventos agrupados por DIA ("Hoje", "Amanhã", "sexta, 19 de setembro"), com
 * inicio e fim, duracao, local, convidados, selo "agora"/"em 10 min" e os atalhos da hora da
 * reuniao: entrar na chamada e gravar.
 *
 * Desde 17/09/2026 pagina por MES (setas no topo e no fim da lista): antes vinham 50 eventos numa
 * rolagem sem fim. O mes atual comeca hoje; os dias ja passados dele aparecem sob demanda.
 */
export function AgendaView({
  events,
  loading,
  error,
  onRefresh,
  onDisconnect,
  onRecord,
  month,
  monthOffset,
  canPrev,
  canNext,
  onMonth,
  showPast,
  onShowPast,
}: {
  events: CalEvent[]
  loading: boolean
  error: React.ReactNode
  onRefresh: () => void
  onDisconnect: () => void
  onRecord: (e: CalEvent) => void
  /** Primeiro dia do mes exibido. */
  month: Date
  /** 0 = mes atual, -1 = anterior, +1 = seguinte... */
  monthOffset: number
  canPrev: boolean
  canNext: boolean
  onMonth: (offset: number) => void
  showPast: boolean
  onShowPast: () => void
}) {
  const { t, lang } = useI18n()
  const locale = LOCALE[lang] ?? 'pt-BR'
  const [now, setNow] = useState(() => Date.now())

  // Os selos "agora" / "em N min" precisam andar sozinhos com a pagina aberta.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const days = useMemo(() => {
    const groups: { key: string; date: Date; items: CalEvent[] }[] = []
    for (const e of events) {
      if (!e.start) continue
      const d = toDate(e.start)
      const key = dayKey(d)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.items.push(e)
      else groups.push({ key, date: d, items: [e] })
    }
    return groups
  }, [events])

  const isCurrent = monthOffset === 0
  const today = new Date(now)
  const tomorrow = new Date(now + 86400000)
  const todayCount = days.find((g) => g.key === dayKey(today))?.items.length ?? 0
  const next = events.find((e) => !e.allDay && e.start && toDate(e.start).getTime() > now)

  const monthName = (d: Date) => cap(d.toLocaleDateString(locale, { month: 'long', year: 'numeric' }))
  const shortMonth = (offset: number) => {
    const d = new Date(month.getFullYear(), month.getMonth() + (offset - monthOffset), 1)
    return cap(d.toLocaleDateString(locale, { month: 'long' }))
  }
  const time = (iso: string) => toDate(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  function dayLabel(d: Date) {
    const full = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    if (dayKey(d) === dayKey(today)) return { main: t('events.today'), sub: full }
    if (dayKey(d) === dayKey(tomorrow)) return { main: t('events.tomorrow'), sub: full }
    return { main: cap(full), sub: null }
  }

  function durationLabel(e: CalEvent) {
    if (e.allDay || !e.end) return null
    const min = Math.round((toDate(e.end).getTime() - toDate(e.start).getTime()) / 60000)
    if (min <= 0) return null
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    const m = min % 60
    return m ? `${h} h ${m} min` : `${h} h`
  }

  function endOf(e: CalEvent): number {
    const start = toDate(e.start).getTime()
    if (e.end) return toDate(e.end).getTime()
    return e.allDay ? start + 86400000 : start + 30 * 60000
  }

  /** 'now' durante o evento; minutos ate comecar quando faltar ate 60 min. */
  function timing(e: CalEvent): { kind: 'now' } | { kind: 'soon'; min: number } | null {
    if (e.allDay) return null
    const start = toDate(e.start).getTime()
    if (now >= start && now < endOf(e)) return { kind: 'now' }
    const min = Math.ceil((start - now) / 60000)
    if (min > 0 && min <= 60) return { kind: 'soon', min }
    return null
  }

  const summary = isCurrent
    ? `${todayCount > 0 ? t('events.todayCount').replace('{n}', String(todayCount)) : t('events.todayNone')}`
    : t('events.monthCount').replace('{n}', String(events.length))

  const pager = (placement: 'top' | 'bottom') => (
    <div className={`flex items-center gap-2 ${placement === 'bottom' ? 'justify-between' : ''}`}>
      <button
        onClick={() => onMonth(monthOffset - 1)}
        disabled={!canPrev || loading}
        aria-label={t('events.prevMonth')}
        title={t('events.prevMonth')}
        className={
          placement === 'top'
            ? 'grid place-items-center h-9 w-9 rounded-xl border border-surface-border bg-surface-card text-content-secondary hover:text-content-primary disabled:opacity-40'
            : 'btn-outline h-10 px-3 text-sm disabled:opacity-40'
        }
      >
        <ChevronLeft size={18} />
        {placement === 'bottom' && <span>{shortMonth(monthOffset - 1)}</span>}
      </button>
      {placement === 'top' && (
        <h2 className="font-display text-base sm:text-lg font-semibold sm:min-w-[10.5rem] text-center tabular-nums whitespace-nowrap" aria-live="polite">
          {monthName(month)}
        </h2>
      )}
      <button
        onClick={() => onMonth(monthOffset + 1)}
        disabled={!canNext || loading}
        aria-label={t('events.nextMonth')}
        title={t('events.nextMonth')}
        className={
          placement === 'top'
            ? 'grid place-items-center h-9 w-9 rounded-xl border border-surface-border bg-surface-card text-content-secondary hover:text-content-primary disabled:opacity-40'
            : 'btn-outline h-10 px-3 text-sm disabled:opacity-40'
        }
      >
        {placement === 'bottom' && <span>{shortMonth(monthOffset + 1)}</span>}
        <ChevronRight size={18} />
      </button>
    </div>
  )

  return (
    <div>
      <div className="card p-3 sm:p-4 mb-4">
        <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-2">
          {pager('top')}
          {!isCurrent && (
            <button onClick={() => onMonth(0)} className="btn-ghost h-9 px-3 text-sm" disabled={loading}>
              {t('events.backToday')}
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onRefresh} className="btn-ghost h-9 px-2.5 sm:px-3 text-sm" disabled={loading} title={t('events.update')}>
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
            <span className="hidden sm:inline">{t('events.update')}</span>
          </button>
          <button onClick={onDisconnect} className="btn-ghost h-9 px-2.5 sm:px-3 text-sm text-content-muted hover:text-accent" title={t('events.disconnect')}>
            <Link2Off size={14} />
            <span className="hidden sm:inline">{t('events.disconnect')}</span>
          </button>
        </div>
        <p className="text-sm text-content-secondary mt-2 px-1">
          {summary}
          {isCurrent && next && (
            <span className="text-content-muted">
              {' · '}
              {t('events.nextAt').replace('{time}', time(next.start))}
            </span>
          )}
        </p>
      </div>

      {error && <div className="mb-4">{error}</div>}

      {isCurrent && !showPast && today.getDate() > 1 && (
        <button
          onClick={onShowPast}
          disabled={loading}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-content-muted hover:text-content-primary"
        >
          <History size={14} /> {t('events.showPast')}
        </button>
      )}

      {loading && events.length === 0 ? (
        <div className="grid place-items-center py-16">
          <Spinner className="text-accent" />
        </div>
      ) : days.length === 0 ? (
        <div className="card p-8 text-center">
          <span className="grid place-items-center h-14 w-14 rounded-full bg-surface-elevated text-content-muted mx-auto mb-3">
            <CalendarDays size={24} />
          </span>
          <p className="text-content-secondary">
            {isCurrent ? t('events.noneRestOfMonth') : t('events.noneMonth').replace('{month}', monthName(month))}
          </p>
          {canNext && (
            <button onClick={() => onMonth(monthOffset + 1)} className="btn-outline h-9 px-3 text-sm mt-4">
              {t('events.seeMonth').replace('{month}', shortMonth(monthOffset + 1))} <ChevronRight size={16} />
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((g) => {
            const label = dayLabel(g.date)
            return (
              <section key={g.key} aria-label={label.main}>
                <h3 className="flex items-baseline gap-2 mb-2 px-1">
                  <span className="font-display font-semibold">{label.main}</span>
                  {label.sub && <span className="text-xs text-content-muted">{label.sub}</span>}
                  <span className="ml-auto text-xs text-content-muted tabular-nums">
                    {g.items.length} {g.items.length === 1 ? t('events.event') : t('events.eventsWord')}
                  </span>
                </h3>
                <ul className="card divide-y divide-surface-border overflow-hidden">
                  {g.items.map((e) => {
                    const tm = timing(e)
                    const past = endOf(e) <= now
                    const joinUrl = e.joinUrl ?? (e.location?.startsWith('https://') ? e.location : null)
                    const place = e.location && e.location !== joinUrl ? e.location : null
                    const dur = durationLabel(e)
                    return (
                      <li
                        key={e.id}
                        className={`flex gap-3 sm:gap-4 p-3.5 sm:p-4 ${tm?.kind === 'now' ? 'bg-accent/5' : ''} ${
                          past ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="w-14 shrink-0 text-right">
                          {e.allDay ? (
                            <span className="text-xs font-medium text-content-muted">{t('events.allDay')}</span>
                          ) : (
                            <>
                              <span className="block text-sm font-semibold tabular-nums">{time(e.start)}</span>
                              {e.end && <span className="block text-xs text-content-muted tabular-nums">{time(e.end)}</span>}
                            </>
                          )}
                        </div>
                        <span
                          aria-hidden
                          className={`w-1 rounded-full shrink-0 ${tm ? 'bg-brand-solid' : 'bg-surface-border'}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="font-medium leading-snug break-words">{e.title}</p>
                            {tm?.kind === 'now' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-brand-solid text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden />
                                {t('events.now')}
                              </span>
                            )}
                            {tm?.kind === 'soon' && (
                              <span className="rounded-full bg-accent/10 text-accent text-[11px] font-semibold px-2 py-0.5">
                                {t('events.inMin').replace('{n}', String(tm.min))}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-content-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {dur && <span>{dur}</span>}
                            {e.attendees > 1 && (
                              <span className="inline-flex items-center gap-1">
                                <Users size={12} /> {t('events.people').replace('{n}', String(e.attendees))}
                              </span>
                            )}
                            {place && (
                              <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                                <MapPin size={12} className="shrink-0" /> <span className="truncate">{place}</span>
                              </span>
                            )}
                          </p>
                          {/* Evento que ja acabou nao tem o que gravar nem onde entrar. */}
                          {!past && (
                            <div className="flex flex-wrap gap-2 mt-2.5">
                              <button
                                onClick={() => onRecord(e)}
                                className={`${tm ? 'btn-primary' : 'btn-outline'} h-8 px-3 text-xs`}
                              >
                                <Mic size={14} /> {t('events.record')}
                              </button>
                              {joinUrl && (
                                <a href={joinUrl} target="_blank" rel="noreferrer" className="btn-ghost h-8 px-3 text-xs">
                                  <ExternalLink size={14} /> {t('events.join')}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          {/* Chegou ao fim do mes: as setas de novo, sem precisar voltar ao topo. */}
          <div className="pt-2">{pager('bottom')}</div>
        </div>
      )}
    </div>
  )
}
