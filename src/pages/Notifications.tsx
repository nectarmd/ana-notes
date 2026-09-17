import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getNotifPrefs, setNotifPrefs, ensureNotifPermission, notifSupported, type NotifPrefs } from '../lib/notifications'
import { useT } from '../lib/i18n'

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`h-6 w-11 rounded-full relative shrink-0 transition-colors ${on ? 'bg-brand-solid' : 'bg-surface-border'}`}>
      <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </span>
  )
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const t = useT()
  const [prefs, setPrefs] = useState<NotifPrefs>(getNotifPrefs())

  async function toggle(key: keyof NotifPrefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    if (next[key]) await ensureNotifPermission()
    setPrefs(next)
    setNotifPrefs(next)
  }

  const items: { key: keyof NotifPrefs; label: string; desc: string; soon?: boolean }[] = [
    { key: 'shared', label: t('notif.sharedT'), desc: t('notif.sharedD') },
    { key: 'announcements', label: t('notif.annT'), desc: t('notif.annD') },
    { key: 'calendar', label: t('notif.calT'), desc: t('notif.calD') },
  ]

  return (
    <div className="px-5 safe-top">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/config')} className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border" aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold">{t('notif.title')}</h1>
      </header>

      {!notifSupported() && (
        <div className="text-sm text-content-muted bg-surface-elevated border border-surface-border rounded-xl px-4 py-3 mb-4 max-w-xl">
          {t('notif.unsupported')}
        </div>
      )}

      <div className="card divide-y divide-surface-border max-w-xl">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => !it.soon && toggle(it.key)}
            disabled={it.soon}
            className="w-full flex items-center gap-3 px-4 py-4 text-left disabled:opacity-60"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium flex items-center gap-2">
                {it.label}
                {it.soon && <span className="text-[10px] uppercase bg-surface-elevated border border-surface-border px-1.5 py-0.5 rounded">{t('notif.soon')}</span>}
              </p>
              <p className="text-sm text-content-muted mt-0.5">{it.desc}</p>
            </div>
            <Toggle on={prefs[it.key]} />
          </button>
        ))}
      </div>
    </div>
  )
}
