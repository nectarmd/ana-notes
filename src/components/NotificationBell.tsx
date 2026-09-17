import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  Hand,
  Info,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Settings2,
  Share2,
  Sparkles,
  UserPlus,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useAppSettings } from '../app/SettingsProvider'
import {
  ANN_DISMISSED_EVENT,
  INBOX_CHANGED,
  announcementItem,
  inboxEnabled,
  loadInbox,
  markInboxRead,
  type InboxItem,
} from '../lib/inbox'
import { logSilentError } from '../lib/auditLog'
import { useI18n } from '../lib/i18n'
import { Avatar, Spinner } from './ui'
import { useToast } from './Toast'

const LOCALE: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }
/** Recarrega sozinho enquanto a tela esta aberta (e sempre que a janela volta ao foco). */
const POLL_MS = 120_000

function ago(iso: string, locale: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(0, 'minute')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

function ItemIcon({ item }: { item: InboxItem }) {
  if (item.person && item.kind !== 'ticket_new') {
    return (
      <span className="relative shrink-0">
        <Avatar first={item.person.first_name} last={item.person.last_name} size={36} url={item.person.avatar_url} />
        <span className="absolute -bottom-1 -right-1.5 grid place-items-center h-[18px] w-[18px] rounded-full bg-surface-card border border-surface-border text-accent">
          {item.kind === 'shared' ? (
            <Share2 size={10} />
          ) : item.kind === 'friend_request' ? (
            <UserPlus size={10} />
          ) : item.kind === 'poke' ? (
            <Hand size={10} />
          ) : (
            <MessageCircle size={10} />
          )}
        </span>
      </span>
    )
  }
  const tone =
    item.tone === 'alerta'
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : item.tone === 'manutencao'
        ? 'bg-accent/15 text-accent'
        : item.tone === 'novidade'
          ? 'bg-brand-solid text-white'
          : 'bg-surface-elevated text-content-secondary'
  const icon =
    item.kind === 'ticket_reply' || item.kind === 'ticket_new' ? (
      <LifeBuoy size={17} />
    ) : item.kind === 'admin_alert' ? (
      <Activity size={17} />
    ) : item.kind === 'announcement' ? (
      <Megaphone size={17} />
    ) : item.tone === 'alerta' ? (
      <AlertTriangle size={17} />
    ) : item.tone === 'manutencao' ? (
      <Wrench size={17} />
    ) : item.tone === 'novidade' ? (
      <Sparkles size={17} />
    ) : (
      <Info size={17} />
    )
  return <span className={`grid place-items-center h-9 w-9 rounded-full shrink-0 ${tone}`}>{icon}</span>
}

/**
 * Sininho ao lado da pasta (topo da Home). A bolinha conta o que ainda nao foi lido; cada aviso
 * pode ser marcado como lido (some da lista) ou clicado para ir direto ao destino.
 */
export function NotificationBell() {
  const { profile, isAdmin } = useAuth()
  const { settings } = useAppSettings()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const me = profile?.id ?? ''
  const locale = LOCALE[lang] ?? 'pt-BR'

  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Muda quando a faixa do topo e fechada, para o item dela sair daqui tambem.
  const [annTick, setAnnTick] = useState(0)
  /** Celular: o popup e fixo na largura da tela, logo abaixo do botao (medido ao abrir). */
  const [mobileTop, setMobileTop] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    if (!me || !inboxEnabled()) {
      setItems([])
      return
    }
    try {
      setItems(await loadInbox({ me, isAdmin, t }))
    } catch (err) {
      logSilentError('client:NotificationBell.load', err)
      setItems((prev) => prev ?? [])
    }
  }, [me, isAdmin, t])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    const onFocus = () => void refresh()
    const onAnn = () => setAnnTick((n) => n + 1)
    window.addEventListener('focus', onFocus)
    window.addEventListener(INBOX_CHANGED, onFocus)
    window.addEventListener(ANN_DISMISSED_EVENT, onAnn)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(INBOX_CHANGED, onFocus)
      window.removeEventListener(ANN_DISMISSED_EVENT, onAnn)
    }
  }, [refresh])

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const list = useMemo(() => {
    const ann = announcementItem(settings, t)
    const all = [...(ann ? [ann] : []), ...(items ?? [])]
    return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    // annTick: recalcula quando a faixa e fechada em outro lugar (localStorage nao avisa sozinho).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, settings, t, annTick])

  const count = list.length

  async function markRead(targets: InboxItem[]) {
    const keys = new Set(targets.map((i) => i.key))
    const before = items
    setItems((prev) => (prev ? prev.filter((i) => !keys.has(i.key)) : prev))
    try {
      await markInboxRead(me, targets)
      if (targets.some((i) => i.kind === 'announcement')) setAnnTick((n) => n + 1)
    } catch (err) {
      setItems(before)
      logSilentError('client:NotificationBell.markRead', err)
      toast(t('common.error'), 'error')
    }
  }

  function openItem(item: InboxItem) {
    if (!item.link) {
      setExpanded((cur) => (cur === item.key ? null : item.key))
      return
    }
    void markRead([item])
    setOpen(false)
    if (/^https?:\/\//i.test(item.link)) window.open(item.link, '_blank', 'noopener')
    else navigate(item.link)
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => {
          if (!open) {
            const r = boxRef.current?.getBoundingClientRect()
            setMobileTop(r && window.innerWidth < 768 ? Math.round(r.bottom + 8) : null)
            void refresh()
          }
          setOpen((v) => !v)
        }}
        aria-label={count > 0 ? `${t('inbox.title')} (${count})` : t('inbox.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('inbox.title')}
        className={`relative grid place-items-center h-10 w-10 rounded-full border transition-colors ${
          open
            ? 'bg-accent/10 border-accent/30 text-accent'
            : 'bg-surface-elevated border-surface-border text-content-secondary hover:text-content-primary'
        }`}
      >
        {count > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-solid text-white text-[10px] font-bold tabular-nums ring-2 ring-surface-bg">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('inbox.title')}
          style={mobileTop !== null ? { top: mobileTop } : undefined}
          className="fixed inset-x-3 top-24 z-50 md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[24rem] card shadow-float overflow-hidden animate-fade-in"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-surface-border">
            <p className="font-display font-semibold">
              {t('inbox.title')}
              {count > 0 && <span className="ml-1.5 text-xs font-normal text-content-muted tabular-nums">{count}</span>}
            </p>
            {count > 1 && (
              <button
                onClick={() => markRead(list)}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <CheckCheck size={14} /> {t('inbox.readAll')}
              </button>
            )}
          </div>

          <div className="max-h-[min(30rem,60dvh)] overflow-y-auto overscroll-contain">
            {items === null ? (
              <div className="grid place-items-center py-10">
                <Spinner className="text-accent" />
              </div>
            ) : count === 0 ? (
              <div className="flex flex-col items-center text-center px-6 py-10">
                <span className="grid place-items-center h-12 w-12 rounded-full bg-surface-elevated text-content-muted mb-3">
                  <Bell size={20} />
                </span>
                <p className="font-medium text-sm">{t('inbox.emptyTitle')}</p>
                <p className="text-xs text-content-muted mt-1">{t('inbox.emptySub')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-surface-border">
                {list.map((item) => {
                  const isOpen = expanded === item.key
                  return (
                    <li key={item.key} className="flex items-start gap-1 pl-4 pr-2 py-3 hover:bg-surface-elevated/60 transition-colors">
                      <button
                        onClick={() => openItem(item)}
                        className="flex items-start gap-3 flex-1 min-w-0 text-left"
                      >
                        <ItemIcon item={item} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug break-words">{item.title}</span>
                          {item.body && (
                            <span
                              className={`block text-xs text-content-secondary mt-0.5 break-words whitespace-pre-line ${
                                isOpen ? '' : 'line-clamp-2'
                              }`}
                            >
                              {item.body}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-[11px] text-content-muted mt-1">
                            {ago(item.at, locale)}
                            {item.link && (
                              <span className="inline-flex items-center text-accent font-medium">
                                <span className="mx-1 text-content-muted">·</span>
                                {t('inbox.open')}
                                <ChevronRight size={12} />
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => markRead([item])}
                        aria-label={t('inbox.markRead')}
                        title={t('inbox.markRead')}
                        className="grid place-items-center h-8 w-8 rounded-lg text-content-muted hover:text-accent hover:bg-surface-elevated shrink-0"
                      >
                        <Check size={16} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <button
            onClick={() => {
              setOpen(false)
              navigate('/notificacoes')
            }}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs text-content-muted hover:text-content-primary border-t border-surface-border"
          >
            <Settings2 size={13} /> {t('inbox.prefs')}
          </button>
        </div>
      )}
    </div>
  )
}
