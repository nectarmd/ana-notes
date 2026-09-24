import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  HelpCircle,
  Info,
  LifeBuoy,
  MessageSquareHeart,
  Send,
  Wallet,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/api'
import type { SupportTicket, TicketTopic } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { AnaIcon } from '../components/AnaIcon'
import { AutoTextarea, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { useI18n } from '../lib/i18n'
import { isElectron } from '../lib/electron'
import { currentDevice } from '../lib/device'
import { APP_VERSION } from '../lib/version'
import { markKeysRead } from '../lib/inbox'
import { logSilentError } from '../lib/auditLog'
import { HelpAssistant } from './HelpAssistant'

const SUBJECT_MAX = 120
const MESSAGE_MAX = 2000

const TOPICS: { v: TicketTopic; key: string; icon: ReactNode }[] = [
  { v: 'tecnico', key: 'sup.t_tech', icon: <Wrench size={15} /> },
  { v: 'feedback', key: 'sup.t_feedback', icon: <MessageSquareHeart size={15} /> },
  { v: 'financeiro', key: 'sup.t_fin', icon: <Wallet size={15} /> },
  { v: 'outros', key: 'sup.t_other', icon: <HelpCircle size={15} /> },
]

/** Onde a pessoa esta: poupa a pergunta "voce usa o app ou o navegador?" em todo chamado. */
function deviceLabel(): string {
  if (isElectron()) return 'App Windows'
  try {
    if (Capacitor.isNativePlatform()) return `App ${Capacitor.getPlatform() === 'android' ? 'Android' : Capacitor.getPlatform()}`
  } catch {
    /* sem Capacitor */
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  const where = /iPhone|iPad|iPod/i.test(ua)
    ? 'iPhone/iPad'
    : /Android/i.test(ua)
      ? 'Android'
      : currentDevice() === 'mobile'
        ? 'Celular'
        : 'Computador'
  return `${where} (${standalone ? 'app instalado' : 'navegador'})`
}

function ticketMeta(lang: string): Record<string, string> {
  const meta: Record<string, string> = { site: APP_VERSION, device: deviceLabel(), lang }
  const app = isElectron() ? window.anaElectron?.appVersion : undefined
  if (app) meta.app = app
  return meta
}

function StatusBadge({ tk }: { tk: SupportTicket }) {
  const { t } = useI18n()
  if (tk.reply) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5">
        <CheckCircle2 size={11} /> {t('sup.st_replied')}
      </span>
    )
  }
  if (tk.status === 'resolvido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5">
        <CheckCircle2 size={11} /> {t('sup.st_resolved')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5">
      <Clock size={11} /> {t('sup.st_open')}
    </span>
  )
}

function TicketItem({ tk }: { tk: SupportTicket }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const long = tk.message.length > 220
  const topic = TOPICS.find((x) => x.v === tk.topic)
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary">
          {topic?.icon} {topic ? t(topic.key) : tk.topic}
        </span>
        <StatusBadge tk={tk} />
        <span className="ml-auto text-xs text-content-muted">{fmtDateTime(tk.created_at)}</span>
      </div>
      {tk.subject && <p className="font-medium text-sm mt-2 break-words">{tk.subject}</p>}
      <p className={`text-sm text-content-secondary whitespace-pre-line break-words mt-1 ${expanded || !long ? '' : 'line-clamp-3'}`}>
        {tk.message}
      </p>
      {long && (
        <button onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-accent mt-1">
          {expanded ? t('common.seeLess') : t('common.seeMore')}
        </button>
      )}
      {tk.reply && (
        <div className="mt-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent mb-1">
            <LifeBuoy size={12} /> {t('sup.reply')}
            {tk.replied_at && <span className="font-normal normal-case tracking-normal text-content-muted">· {fmtDateTime(tk.replied_at)}</span>}
          </p>
          <p className="text-sm whitespace-pre-line break-words">{tk.reply}</p>
        </div>
      )}
    </li>
  )
}

export function Support() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { t, lang } = useI18n()
  const [topic, setTopic] = useState<TicketTopic>('tecnico')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [anaOpen, setAnaOpen] = useState(false)

  function load() {
    if (!profile) return
    db.listMyTickets(profile.id)
      .then((list) => {
        setTickets(list)
        // Ver a resposta aqui ja conta como lida no sininho.
        const keys = list.filter((tk) => tk.replied_at).map((tk) => `ticket:${tk.id}:${Date.parse(tk.replied_at as string)}`)
        if (keys.length) markKeysRead(profile.id, keys).catch(() => {})
      })
      .catch((err) => {
        setTickets([])
        logSilentError('client:Support.load', err)
      })
  }
  useEffect(load, [profile])

  async function submit() {
    if (!profile || !message.trim()) return
    setSending(true)
    try {
      await db.createTicket({
        user_id: profile.id,
        topic,
        subject: subject.trim(),
        message: message.trim(),
        meta: ticketMeta(lang),
      })
      setSubject('')
      setMessage('')
      setSent(true)
      load()
    } catch (err) {
      logSilentError('client:Support.submit', err)
      toast(t('common.error'), 'error')
    } finally {
      setSending(false)
    }
  }

  const openCount = (tickets ?? []).filter((tk) => tk.status === 'aberto' && !tk.reply).length

  return (
    <div className="px-5 safe-top pb-16 max-w-5xl mx-auto">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label={t('common.back')}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t('sup.title')}</h1>
          <p className="text-sm text-content-muted">{t('sup.subtitle')}</p>
        </div>
      </header>

      {/* Resposta imediata antes de abrir chamado: a maioria das duvidas ja tem resposta. */}
      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('sup.before')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <button
          onClick={() => setAnaOpen(true)}
          className="card p-4 flex items-center gap-3 text-left hover:border-accent/40 transition-colors"
        >
          <span className="grid place-items-center h-10 w-10 rounded-xl bg-surface-elevated border-2 border-brand-solid text-accent shrink-0">
            <AnaIcon size={24} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-sm">{t('sup.askAna')}</span>
            <span className="block text-xs text-content-muted">{t('sup.askAnaSub')}</span>
          </span>
          <ChevronRight size={18} className="text-content-muted shrink-0" />
        </button>
        <button
          onClick={() => navigate('/ajuda')}
          className="card p-4 flex items-center gap-3 text-left hover:border-accent/40 transition-colors"
        >
          <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/10 text-accent shrink-0">
            <BookOpen size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-sm">{t('settings.helpCenter')}</span>
            <span className="block text-xs text-content-muted">{t('sup.helpSub')}</span>
          </span>
          <ChevronRight size={18} className="text-content-muted shrink-0" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="novo-chamado">
          <h2 id="novo-chamado" className="font-display font-semibold mb-3">
            {t('sup.new')}
          </h2>
          {sent ? (
            <div className="card p-6 text-center">
              <span className="grid place-items-center h-12 w-12 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mx-auto mb-3">
                <Check size={22} />
              </span>
              <p className="font-display font-semibold">{t('sup.sentTitle')}</p>
              <p className="text-sm text-content-muted mt-1">{t('sup.sentSub')}</p>
              <button onClick={() => setSent(false)} className="btn-outline h-10 px-4 text-sm mt-5">
                {t('sup.another')}
              </button>
            </div>
          ) : (
            <div className="card p-5">
              <label className="label">{t('sup.topic')}</label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {TOPICS.map((top) => (
                  <button
                    key={top.v}
                    onClick={() => setTopic(top.v)}
                    aria-pressed={topic === top.v}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border transition-colors text-left ${
                      topic === top.v
                        ? 'bg-brand-solid border-brand-solid text-white'
                        : 'bg-surface-elevated border-surface-border text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    {top.icon}
                    {t(top.key)}
                  </button>
                ))}
              </div>

              <label className="label">{t('sup.subject')}</label>
              <input
                className="input mb-4"
                maxLength={SUBJECT_MAX}
                placeholder={t('sup.subjectPh')}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />

              <div className="flex items-center justify-between">
                <label className="label">{t('sup.message')}</label>
                <span className={`text-[11px] tabular-nums ${MESSAGE_MAX - message.length <= 100 ? 'text-accent' : 'text-content-muted'}`}>
                  {MESSAGE_MAX - message.length}
                </span>
              </div>
              <AutoTextarea
                minRows={5}
                maxRows={14}
                maxLength={MESSAGE_MAX}
                className="leading-relaxed"
                placeholder={t('sup.messagePh')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              {topic === 'tecnico' && <p className="text-xs text-content-muted mt-2">{t('sup.techHint')}</p>}

              <p className="flex items-start gap-1.5 text-[11px] text-content-muted mt-3 mb-4">
                <Info size={12} className="shrink-0 mt-0.5" />
                <span>{t('sup.metaNote')}</span>
              </p>

              <button className="btn-primary w-full" onClick={submit} disabled={sending || !message.trim()}>
                {sending ? <Spinner /> : <Send size={17} />}
                {t('sup.send')}
              </button>
            </div>
          )}
        </section>

        <section aria-labelledby="meus-chamados">
          <h2 id="meus-chamados" className="font-display font-semibold mb-3 flex items-center gap-2">
            {t('sup.mine')}
            {openCount > 0 && (
              <span className="text-xs font-normal text-content-muted">
                ({t('sup.waiting').replace('{n}', String(openCount))})
              </span>
            )}
          </h2>
          {tickets === null ? (
            <div className="grid place-items-center py-8">
              <Spinner className="text-accent" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="card p-6 text-center">
              <LifeBuoy size={28} className="mx-auto text-content-muted mb-2" />
              <p className="text-sm text-content-muted">{t('sup.empty')}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {tickets.map((tk) => (
                <TicketItem key={tk.id} tk={tk} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {anaOpen && <HelpAssistant open={anaOpen} onClose={() => setAnaOpen(false)} />}
    </div>
  )
}
