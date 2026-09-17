import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  SearchX,
  Link2,
  Mic,
  NotebookPen,
  MessageSquare,
  ChevronRight,
  SlidersHorizontal,
  Check,
  Smartphone,
  Monitor,
  Video,
  StickyNote,
  Folder as FolderIcon,
  Clock,
  Image as ImageIcon,
  RefreshCw,
  Lightbulb,
  X,
} from 'lucide-react'
import { AnaIcon } from '../components/AnaIcon'
import { logSilentError } from '../lib/auditLog'
import { isElectron } from '../lib/electron'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/api'
import type { Note, Folder, Tip } from '../lib/types'
import { tipsEnabled, listActiveTips } from '../lib/tips'
import { useAppSettings } from '../app/SettingsProvider'
import { fmtDate, fmtDuration, fmtTime } from '../lib/format'
import { Avatar, EmptyState, Chip, NoteCardSkeleton, PriorityBadge, ConfirmDialog } from '../components/ui'
import { ThemeToggle } from '../components/ThemeToggle'
import { Logo } from '../components/Logo'
import { NewNoteSheet } from '../components/NewNoteSheet'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { AskNotesSheet } from './AskNotesSheet'
import { FolderSheet } from './FolderSheet'
import { getNotifPrefs, notify } from '../lib/notifications'
import { UpcomingEvents } from './UpcomingEvents'
import { HelpAssistant } from './HelpAssistant'
import { useT } from '../lib/i18n'
import { useToast } from '../components/Toast'
import { SwipeRow } from '../components/SwipeRow'
import { audioDaysLeft, EXPIRY_WARN_DAYS, retentionOf } from '../lib/retention'

/** Icone de origem: diferencia como a nota foi criada. */
function sourceIcon(n: Note): React.ReactNode {
  if (n.type === 'video') return <Video size={18} />
  if (n.type === 'image') return <ImageIcon size={18} />
  if (n.type === 'file') return <StickyNote size={18} />
  if (n.type === 'link') return <Link2 size={18} />
  // audio (recording/upload/call): mostra o dispositivo de origem quando conhecido
  if (n.device === 'mobile') return <Smartphone size={18} />
  if (n.device === 'desktop') return <Monitor size={18} />
  return <Mic size={18} /> // origem desconhecida (notas antigas)
}

type SortKey = 'recent' | 'longest' | 'shortest' | 'prioDesc' | 'prioAsc'

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: 'recent', labelKey: 'home.sortRecent' },
  { key: 'longest', labelKey: 'home.sortLongest' },
  { key: 'shortest', labelKey: 'home.sortShortest' },
  { key: 'prioDesc', labelKey: 'home.sortPrioDesc' },
  { key: 'prioAsc', labelKey: 'home.sortPrioAsc' },
]

/** alta > media > baixa. Notas SEM prioridade ficam sempre por ultimo. */
const PRIO_RANK: Record<string, number> = { alta: 3, media: 2, baixa: 1 }
const prioOf = (n: Note) => (n.priority ? PRIO_RANK[n.priority] ?? 0 : 0)

const TIPS_DISMISSED_KEY = 'tailor.tips.dismissed'

function readDismissedTips(): string[] {
  try {
    const raw = localStorage.getItem(TIPS_DISMISSED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** Dicas publicadas pelo admin (/admin/dicas). Duas formas de avancar: normalmente mostra uma
 *  por vez na ordem de criacao e so troca quando o usuario dispensa; com "rotacao automatica"
 *  ligada (Admin > Avisos e Dicas), a dica muda sozinha a cada N dias -- a MESMA pra todo mundo
 *  naquele periodo, calculada pela data (sem precisar de estado no servidor). Dispensar sempre
 *  guarda o id em localStorage; se a rotacao trouxer essa dica de volta depois, ela e pulada.*/
function HomeTip() {
  const t = useT()
  const { settings } = useAppSettings()
  const [tips, setTips] = useState<Tip[] | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(readDismissedTips)

  useEffect(() => {
    if (!tipsEnabled()) return
    let alive = true
    listActiveTips()
      .then((t) => alive && setTips(t))
      .catch(() => alive && setTips([]))
    return () => {
      alive = false
    }
  }, [])

  const eligible = (tips ?? []).filter((t) => !t.electron_only || isElectron())

  let next: Tip | undefined
  if (settings?.tips_rotate_enabled && eligible.length > 0) {
    const hours = Math.max(1, settings.tips_rotate_hours || 72)
    const slot = Math.floor(Date.now() / 3_600_000 / hours) % eligible.length
    const candidate = eligible[slot]
    next = dismissed.includes(candidate.id) ? undefined : candidate
  } else {
    next = eligible.find((t) => !dismissed.includes(t.id))
  }

  if (!next) return null

  function dismiss() {
    if (!next) return
    const list = [...dismissed, next.id]
    setDismissed(list)
    try {
      localStorage.setItem(TIPS_DISMISSED_KEY, JSON.stringify(list))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-2.5 mb-3">
      <Lightbulb size={16} className="text-accent shrink-0" />
      <p className="flex-1 min-w-0 text-sm text-content-secondary">
        {next.title && <span className="font-medium text-content-primary">{next.title}: </span>}
        {next.body}
      </p>
      <button
        onClick={dismiss}
        aria-label={t('home.tip.dismiss')}
        className="shrink-0 text-content-muted hover:text-content-primary"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function Home() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const t = useT()
  const toast = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement | null>(null)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [folderList, setFolderList] = useState<Folder[]>([])
  const [folderOpen, setFolderOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null)
  const [pendingLeave, setPendingLeave] = useState<Note | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updatePercent, setUpdatePercent] = useState<number | null>(null)
  // So os instaladores novos (a partir desta versao) tem essa API no preload -- quem ainda esta
  // num instalador antigo (site atualiza sozinho, o wrapper nativo nao) cai no fallback de antes.
  // `checkForUpdates` em si so existe a partir de um instalador mais velho ainda que introduziu o
  // recurso de auto-update -- quem tem um instalador anterior a ISSO (bem mais raro, mas
  // aconteceu: gerou 40 erros "checkForUpdates is not a function" no audit_log de um usuario)
  // nem esse metodo tem, entao o botao de atualizar so aparece se o preload realmente o suporta.
  const supportsCheckForUpdates = isElectron() && typeof window.anaElectron!.checkForUpdates === 'function'
  const supportsUpdateStatus = supportsCheckForUpdates && typeof window.anaElectron!.onUpdateStatus === 'function'

  const retention = retentionOf(profile)

  /** Exclusao sempre passa pela confirmacao. Vai para a lixeira (7 dias para desfazer). */
  async function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    try {
      await db.deleteNote(target.id)
      setNotes((prev) => (prev ? prev.filter((x) => x.id !== target.id) : prev))
      toast(t('home.deleted'))
    } catch (err) {
      logSilentError('client:Home.confirmDelete', err)
      toast(t('common.error'), 'error')
    }
  }

  /** So pra nota compartilhada comigo: sai da lista de quem ve, sem tocar na nota do dono. */
  async function confirmLeave() {
    const target = pendingLeave
    if (!target) return
    try {
      await db.leaveSharedNote(target.id)
      setNotes((prev) => (prev ? prev.filter((x) => x.id !== target.id) : prev))
      toast(t('home.left'))
    } catch (err) {
      logSilentError('client:Home.confirmLeave', err)
      toast(t('common.error'), 'error')
    }
  }

  useEffect(() => {
    if (!profile) return
    db.listNotes(profile.id).then((ns) => {
      setNotes(ns)
      // Notifica novas notas compartilhadas comigo (se habilitado).
      try {
        if (getNotifPrefs().shared) {
          // Copias recebidas (0037) chegam com user_id meu; o marcador e shared_by.
          const sharedIds = ns.filter((n) => n.shared_by).map((n) => n.id)
          const raw = localStorage.getItem('tailor.seenShared')
          const seen = new Set<string>(raw ? JSON.parse(raw) : [])
          const fresh = sharedIds.filter((id) => !seen.has(id))
          if (raw !== null && fresh.length) {
            notify('Nova transcrição compartilhada', `Você recebeu ${fresh.length} nota(s).`)
          }
          localStorage.setItem('tailor.seenShared', JSON.stringify(sharedIds))
        }
      } catch {
        /* ignore */
      }
    }).catch((err) => {
      setNotes([])
      logSilentError('client:Home.listNotes', err)
      toast(t('common.error'), 'error')
    })
    db.listFolders(profile.id).then(setFolderList).catch(() => {})
  }, [profile])

  // Fecha o menu de ordenacao ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!sortOpen) return
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSortOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [sortOpen])

  // App Windows (Electron): reage ao status real da checagem/download de atualizacao em vez
  // de so mostrar um toast fixo "verificando..." que nunca sabia se de fato terminou.
  useEffect(() => {
    if (!supportsUpdateStatus) return
    return window.anaElectron!.onUpdateStatus((payload) => {
      if (payload.status === 'checking') {
        setUpdateBusy(true)
        setUpdatePercent(null)
      } else if (payload.status === 'available') {
        toast(`Nova versão ${payload.version} encontrada, baixando...`)
      } else if (payload.status === 'not-available') {
        setUpdateBusy(false)
        toast('Você já está com a versão mais recente.')
      } else if (payload.status === 'downloading') {
        setUpdateBusy(true)
        setUpdatePercent(Math.round(payload.percent))
      } else if (payload.status === 'downloaded') {
        setUpdateBusy(false)
        setUpdatePercent(null)
        toast(`Atualização ${payload.version} baixada. Reinicie para instalar.`)
      } else if (payload.status === 'error') {
        setUpdateBusy(false)
        setUpdatePercent(null)
        toast('Não foi possível verificar atualizações agora.', 'error')
      } else if (payload.status === 'cancelled') {
        setUpdateBusy(false)
        setUpdatePercent(null)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const folderName = (id: string | null) => folderList.find((f) => f.id === id)?.name
  const folderColor = (id: string | null) => folderList.find((f) => f.id === id)?.color ?? null

  const filtered = useMemo(() => {
    if (!notes) return []
    const q = query.trim().toLowerCase()
    const arr = notes.filter((n) => {
      if (folderFilter !== 'all' && n.folder_id !== folderFilter) return false
      if (!q) return true
      return (
        n.title.toLowerCase().includes(q) ||
        n.transcript.toLowerCase().includes(q) ||
        (n.summary ?? '').toLowerCase().includes(q)
      )
    })
    const byRecent = (a: Note, b: Note) => Date.parse(b.created_at) - Date.parse(a.created_at)
    arr.sort((a, b) => {
      if (sort === 'longest') return (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0) || byRecent(a, b)
      if (sort === 'shortest') return (a.duration_seconds ?? 0) - (b.duration_seconds ?? 0) || byRecent(a, b)
      if (sort === 'prioDesc') return prioOf(b) - prioOf(a) || byRecent(a, b)
      if (sort === 'prioAsc') {
        // Sem prioridade (0) vai para o fim tambem na ordem crescente.
        const ra = prioOf(a) || Infinity
        const rb = prioOf(b) || Infinity
        return ra - rb || byRecent(a, b)
      }
      return byRecent(a, b)
    })
    return arr
  }, [notes, query, folderFilter, sort])

  const hasFilters = query.trim() !== '' || folderFilter !== 'all'


  return (
    <div className="px-5 safe-top">
      <header className="mb-4">
        {/* Mobile: logo ANA + "AI NOTES ADVISOR" embaixo (a esquerda); "by [Tailor]" no canto superior direito */}
        <div className="md:hidden flex items-start justify-between gap-3 mb-3">
          <div>
            <Logo part="anaonly" heightClass="h-[19px]" />
            <span className="block text-brand-400 text-[9px] font-semibold uppercase tracking-[0.22em] leading-none mt-1">
              AI NOTES ADVISOR
            </span>
          </div>
          {/* Caixa de 19px = altura da logo ANA. items-end alinha as duas pela BASE
              (a Tailor tem 17px, um pouco menor). */}
          <div className="flex items-end h-[19px] shrink-0">
            <Logo part="tailor" heightClass="h-[17px]" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl sm:text-3xl font-bold whitespace-nowrap">{t('home.title')}</h1>
          {/* No desktop, os controles vao para o canto superior direito da tela */}
          <div className="flex items-center gap-2 md:fixed md:top-5 md:right-8 md:z-40">
            <button
              onClick={() => setFolderOpen(true)}
              aria-label="Pastas"
              className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border text-content-secondary hover:text-content-primary"
            >
              <FolderIcon size={18} />
            </button>
            {supportsCheckForUpdates && (
              <button
                onClick={() => {
                  if (supportsUpdateStatus) {
                    if (updateBusy) return
                    setUpdateBusy(true)
                  } else {
                    toast('Verificando atualizações...')
                  }
                  window.anaElectron!.checkForUpdates()
                }}
                disabled={supportsUpdateStatus && updateBusy}
                aria-label="Buscar atualizações"
                title={updatePercent !== null ? `Baixando atualização... ${updatePercent}%` : 'Buscar atualizações'}
                className="relative grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border text-content-secondary hover:text-content-primary disabled:opacity-70"
              >
                <RefreshCw size={18} className={supportsUpdateStatus && updateBusy ? 'animate-spin' : undefined} />
                {updatePercent !== null && (
                  <span className="absolute -bottom-1 -right-1 text-[9px] font-semibold bg-brand-solid text-white rounded-full min-w-[18px] h-[18px] grid place-items-center px-0.5">
                    {updatePercent}
                  </span>
                )}
              </button>
            )}
            <ThemeToggle />
            {/* No desktop o perfil ja esta na sidebar (foto do usuario). Aqui e so mobile. */}
            <button onClick={() => navigate('/config')} aria-label="Perfil" className="md:hidden">
              {profile && <Avatar first={profile.first_name} last={profile.last_name} url={profile.avatar_url} />}
            </button>
          </div>
        </div>
      </header>

      {/* So no desktop: no mobile (PWA/APK inclusive), aviso+dica aqui em cima empurravam
          "conversar com todas as reuniões" pra baixo e atrapalhavam o layout -- versao mobile
          fica reposicionada depois daquele botao (abaixo). */}
      <div className="hidden md:block">
        <HomeTip />
      </div>

      <button
        onClick={() => setAskOpen(true)}
        className="card-featured w-full flex items-center gap-3 bg-surface-card border rounded-2xl px-4 py-2.5 mb-3 text-left transition-colors"
      >
        <span className="grid place-items-center h-9 w-9 rounded-xl bg-brand-solid text-white shrink-0">
          <MessageSquare size={18} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-medium text-sm">{t('home.chatAll')}</span>
          <span className="block text-xs text-content-muted">{t('home.chatAllSub')}</span>
        </span>
        <ChevronRight size={18} className="text-content-muted shrink-0" />
      </button>

      {/* Versao mobile do aviso+dica (ver comentario acima). */}
      <div className="md:hidden">
        <AnnouncementBanner />
        <HomeTip />
      </div>

      <UpcomingEvents />

      {/* Busca + filtro de ordenacao (icone a direita, dentro do proprio card) */}
      <div className="relative mb-3" ref={sortRef}>
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          className="input pl-11 pr-12"
          placeholder={t('home.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => setSortOpen((v) => !v)}
          aria-label={t('home.sortBy')}
          aria-expanded={sortOpen}
          title={t('home.sortBy')}
          className={`absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-9 w-9 rounded-lg transition-colors ${
            sortOpen || sort !== 'recent'
              ? 'text-accent bg-accent/10'
              : 'text-content-muted hover:text-content-primary'
          }`}
        >
          <SlidersHorizontal size={18} />
        </button>

        {sortOpen && (
          <div className="absolute right-0 top-full mt-2 z-30 w-64 card p-1.5 shadow-float">
            <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              {t('home.sortBy')}
            </p>
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => {
                  setSort(o.key)
                  setSortOpen(false)
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${
                  sort === o.key ? 'text-accent bg-accent/10' : 'text-content-secondary hover:bg-surface-elevated'
                }`}
              >
                {t(o.labelKey)}
                {sort === o.key && <Check size={16} className="shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {folderList.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
          <Chip active={folderFilter === 'all'} onClick={() => setFolderFilter('all')}>
            {t('home.all')}
          </Chip>
          {folderList.map((f) => (
            <Chip key={f.id} active={folderFilter === f.id} onClick={() => setFolderFilter(f.id)}>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: f.color }} />
                {f.name}
              </span>
            </Chip>
          ))}
        </div>
      )}

      {notes && filtered.length > 0 && (
        <div className="flex items-center justify-between mb-2 px-1">
          {/* A ordenacao vive no icone de filtro dentro da busca. */}
          <span className="text-xs text-content-muted">
            {filtered.length} {filtered.length === 1 ? t('home.noteOne') : t('home.noteMany')}
          </span>
        </div>
      )}

      <div className="pb-2">
      {notes === null ? (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <NoteCardSkeleton />
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<SearchX size={40} />}
            title={t('home.noResultTitle')}
            subtitle={t('home.noResultSub')}
            action={
              <button
                className="btn-outline"
                onClick={() => {
                  setQuery('')
                  setFolderFilter('all')
                }}
              >
                {t('home.clearFilters')}
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<NotebookPen size={40} />}
            title={t('home.emptyTitle')}
            subtitle={t('home.emptySub')}
            action={
              <button className="btn-primary" onClick={() => setNewOpen(true)}>
                {t('home.newNote')}
              </button>
            }
          />
        )
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-2">
          {filtered.map((n) => {
            const fc = folderColor(n.folder_id)
            const daysLeft = audioDaysLeft(n, retention)
            const expiring = daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS
            // A RLS so deixa o DONO excluir. Sem isto, uma nota compartilhada comigo sumiria
            // da tela e o banco nao mudaria nada.
            const mine = n.user_id === profile?.id
            // Faixa colorida a esquerda (so no mobile): cor da pasta, ou o vermelho da marca.
            const card = (
              <button
                onClick={() => navigate(`/nota/${n.id}`)}
                style={fc ? ({ '--stripe': fc } as React.CSSProperties) : undefined}
                className="note-card card w-full h-full text-left px-4 py-3.5 hover:shadow-hover transition-all"
              >
                {/* Topo: data + prioridade + icone de origem (na cor da pasta, se houver) */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-content-muted shrink-0">{fmtDate(n.created_at)}</span>
                    {n.priority && <PriorityBadge level={n.priority} />}
                  </div>
                  <span
                    className={`grid place-items-center h-8 w-8 rounded-xl shrink-0 ${
                      fc ? '' : 'bg-accent/10 text-accent'
                    }`}
                    style={fc ? { color: fc, background: `${fc}1a` } : undefined}
                  >
                    {sourceIcon(n)}
                  </span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="flex-1 min-w-0 font-semibold truncate">{n.title}</h3>
                  {n.status === 'processing' && (
                    <span className="text-[10px] uppercase tracking-wide bg-brand-solid text-white px-1.5 py-0.5 rounded shrink-0">
                      {t('home.processing')}
                    </span>
                  )}
                </div>
                {/* Abaixo do titulo: horario (+ duracao/pasta) */}
                <p className="text-sm text-content-muted mt-1">
                  {fmtTime(n.created_at)}
                  {n.duration_seconds ? ` • ${fmtDuration(n.duration_seconds)}` : ''}
                  {folderName(n.folder_id) ? ` • ${folderName(n.folder_id)}` : ''}
                </p>

                {/* Aviso de auto-delete: so nos ultimos dias, e so se nao estiver marcada para manter. */}
                {expiring && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-accent">
                    <Clock size={12} className="shrink-0" />
                    {daysLeft === 0
                      ? t('home.expiresToday')
                      : t(daysLeft === 1 ? 'home.expiresDay' : 'home.expiresDays').replace(
                          '{n}',
                          String(daysLeft),
                        )}
                  </p>
                )}
              </button>
            )
            return (
              <li key={n.id}>
                {mine ? (
                  <SwipeRow label={t('home.delete')} onDelete={() => setPendingDelete(n)}>
                    {card}
                  </SwipeRow>
                ) : (
                  <SwipeRow label={t('home.leave')} onDelete={() => setPendingLeave(n)}>
                    {card}
                  </SwipeRow>
                )}
              </li>
            )
          })}
        </ul>
      )}
      </div>

      {/* FAB da ANA (MOBILE): no desktop a ANA fica no shell, global e com balao. */}
      <button
        onClick={() => setHelpOpen(true)}
        aria-label={t('sidebar.talkAna')}
        className="md:hidden fixed right-5 fab-above-nav z-50 grid place-items-center h-16 w-16 rounded-full shadow-float
                   bg-surface-elevated text-accent border-2 border-brand-solid
                   transition-opacity hover:opacity-90"
      >
        <AnaIcon size={30} />
      </button>

      {askOpen && <AskNotesSheet open={askOpen} onClose={() => setAskOpen(false)} notes={notes ?? []} />}
      {helpOpen && <HelpAssistant open={helpOpen} onClose={() => setHelpOpen(false)} />}

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('home.deleteTitle')}
        message={t('home.deleteConfirm').replace('{title}', pendingDelete?.title ?? '')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={!!pendingLeave}
        title={t('home.leaveTitle')}
        message={t('home.leaveConfirm').replace('{title}', pendingLeave?.title ?? '')}
        confirmLabel={t('home.leave')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmLeave}
        onClose={() => setPendingLeave(null)}
      />

      {folderOpen && profile && (
        <FolderSheet
          open={folderOpen}
          onClose={() => setFolderOpen(false)}
          userId={profile.id}
          mode="manage"
          onChanged={() => db.listFolders(profile.id).then(setFolderList)}
        />
      )}

      {newOpen && <NewNoteSheet open={newOpen} onClose={() => setNewOpen(false)} />}
    </div>
  )
}
