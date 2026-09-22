import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileLock2, HelpCircle, LifeBuoy, ScrollText, ShieldCheck, Trash2, Timer } from 'lucide-react'
import { Logo } from '../components/Logo'
import { APP_VERSION } from '../lib/version'
import { retentionOf } from '../lib/retention'
import { useAuth } from '../auth/AuthProvider'
import { FRIEND_CHAT_DAYS } from '../lib/types'
import { useT } from '../lib/i18n'

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="text-content-secondary shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium text-sm">{label}</p>
        <p className="text-sm text-content-muted leading-snug">{value}</p>
      </div>
    </div>
  )
}

export function About() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const t = useT()
  const days = retentionOf(profile)

  return (
    <div className="px-5 safe-top pb-10">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold">{t('about.title')}</h1>
      </header>

      <div className="card p-6 flex flex-col items-center text-center mb-6">
        <Logo part="ana" heightClass="h-12" />
        <p className="text-sm text-content-secondary mt-3">{t('about.tagline')}</p>
        <p className="mt-4 text-xs font-mono text-content-muted bg-surface-elevated border border-surface-border rounded-lg px-3 py-1.5">
          {t('about.version')} {APP_VERSION}
        </p>
      </div>

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('about.howItWorks')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <Fact
          icon={<Timer size={18} />}
          label={t('settings.autoDelete')}
          value={t('about.retention').replace('{n}', String(days))}
        />
        <Fact icon={<Trash2 size={18} />} label={t('settings.trash')} value={t('about.trash')} />
        <Fact icon={<ShieldCheck size={18} />} label={t('about.privacyTitle')} value={t('about.privacyBody')} />
        <Fact
          icon={<HelpCircle size={18} />}
          label={t('about.chatTitle')}
          value={t('about.chatBody').replace('{n}', String(FRIEND_CHAT_DAYS))}
        />
      </div>

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('about.legal')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <button onClick={() => navigate('/termos')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
          <ScrollText size={18} className="text-content-secondary" />
          <span className="font-medium text-sm">{t('settings.terms')}</span>
        </button>
        <button onClick={() => navigate('/privacidade')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
          <FileLock2 size={18} className="text-content-secondary" />
          <span className="font-medium text-sm">{t('settings.privacy')}</span>
        </button>
        <button onClick={() => navigate('/suporte')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
          <LifeBuoy size={18} className="text-content-secondary" />
          <span className="font-medium text-sm">{t('settings.contactSupport')}</span>
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 text-content-muted">
        <p className="text-xs">{t('about.copyright').replace('{y}', String(new Date().getFullYear()))}</p>
      </div>
    </div>
  )
}
