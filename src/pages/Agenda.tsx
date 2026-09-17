import { CalendarDays } from 'lucide-react'
import { UpcomingEvents } from './UpcomingEvents'
import { useT } from '../lib/i18n'

/** Agenda: eventos do Google Calendar + atalho para gravar a reuniao do evento. */
export function Agenda() {
  const t = useT()
  return (
    <div className="px-5 safe-top pb-8 max-w-3xl mx-auto">
      <header className="flex items-center gap-3 mb-5">
        <span className="grid place-items-center h-10 w-10 rounded-full bg-brand-solid text-white shrink-0">
          <CalendarDays size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t('nav.agenda')}</h1>
          <p className="text-sm text-content-muted">{t('events.pageSub')}</p>
        </div>
      </header>

      <UpcomingEvents mode="page" />
    </div>
  )
}
