import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Home,
  Settings as SettingsIcon,
  Mic,
  ListChecks,
  CalendarDays,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Users,
  Share2,
  Plug,
  BarChart3,
  Video,
  Link2,
  FileText,
  Heart,
} from 'lucide-react'
import { AnaIcon } from '../components/AnaIcon'
import { useAuth } from '../auth/AuthProvider'
import { Logo } from '../components/Logo'
import { Avatar } from '../components/ui'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { UpdateBanner } from '../components/UpdateBanner'
import { NewNoteSheet } from '../components/NewNoteSheet'
import { NavTag } from '../components/NavTag'
import { startCalendarReminders } from '../lib/calendarReminders'
import { retomarPendentes } from '../lib/noteJobs'
import { canReceiveSharedFiles, consumeSharedFile, onSharedFile, setPendingUpload } from '../lib/sharedFile'
import { useAppSettings } from '../app/SettingsProvider'
import { announcementActive } from '../lib/appSettings'
import { Maintenance } from '../pages/Maintenance'
import { HelpAssistant } from '../pages/HelpAssistant'
import { useT } from '../lib/i18n'
import { db } from '../lib/api'
import { fmtRelative } from '../lib/format'
import { FAVORITES_CHANGED_EVENT } from '../lib/favorites'
import type { RecentNote } from '../lib/types'

const HIDE_MOBILE_NAV_ON = ['/nota/', '/capturar']

/**
 * Telas de grade (cards) que usam a largura toda em monitor grande -- no app Windows em tela
 * cheia o max-w-6xl deixava faixas vazias enormes dos lados (pedido de 17/09/2026). Telas de
 * leitura (nota, configuracoes, termos...) continuam com largura limitada.
 */
const WIDE_ROUTES = ['/', '/admin', '/amigos', '/compartilhados']

interface Item {
  to: string
  icon: React.ReactNode
  labelKey: string
  adminOnly?: boolean
  tagKey?: string
  tagVariant?: 'muted' | 'accent'
}

/** Menu da sidebar (desktop). "Config" nao entra aqui: virou a engrenagem no rodape. */
const ITEMS: Item[] = [
  { to: '/', icon: <Home size={20} />, labelKey: 'nav.notes' },
  { to: '/tarefas', icon: <ListChecks size={20} />, labelKey: 'nav.tasks' },
  { to: '/agenda', icon: <CalendarDays size={20} />, labelKey: 'nav.agenda' },
]

/**
 * Mesma secao "Mais funcoes" que existe no Config, atalhada na sidebar do desktop.
 * Discador e Gerente/Senior sairam em 17/09/2026 (pedido do administrador): so a interface foi
 * removida, as tabelas do banco continuam.
 */
const MORE_ITEMS: Item[] = [
  { to: '/amigos', icon: <Users size={20} />, labelKey: 'settings.friends' },
  { to: '/compartilhados', icon: <Share2 size={20} />, labelKey: 'settings.sharedWithMe' },
  { to: '/conectores', icon: <Plug size={20} />, labelKey: 'settings.connectors', tagKey: 'nav.soon' },
  { to: '/analytics', icon: <BarChart3 size={20} />, labelKey: 'settings.analytics', tagKey: 'nav.soon' },
]

function SidebarLink({ item, label, tag }: { item: Item; label: string; tag?: string }) {
  return (
    <NavLink
      to={item.to}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors border ${
          isActive
            ? 'bg-accent/10 border-accent/25 text-accent'
            : 'border-transparent text-content-secondary hover:bg-surface-elevated hover:text-content-primary'
        }`
      }
    >
      {/* shrink-0: uma etiqueta larga demais (era "COMING SOON"/"PROXIMAMENTE") espremia o icone ate
          sumir. As etiquetas agora sao curtas (SOON, PRONTO, EM BREVE) e cabem ao lado do nome. */}
      <span className="shrink-0 grid place-items-center">{item.icon}</span>
      <span className="flex-1 min-w-0">{label}</span>
      {tag && <NavTag variant={item.tagVariant ?? 'muted'}>{tag}</NavTag>}
    </NavLink>
  )
}

/**
 * Favoritas no rodape do menu (17/09/2026): a metade de baixo da barra vivia vazia e voltar a uma
 * nota exigia ir para a tela inicial e procurar. Comecou listando as mais recentes; virou favoritas
 * porque quem volta sempre nas mesmas notas nao as encontra pela ordem de criacao. Consulta leve
 * (sem transcricao), refeita ao trocar de tela -- no maximo uma a cada 30 s -- e assim que alguem
 * mexe num coracao.
 */
function SidebarFavorites() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const t = useT()
  const [notes, setNotes] = useState<RecentNote[] | null>(null)
  const lastFetch = useRef(0)

  const load = useCallback(() => {
    if (!profile) return
    lastFetch.current = Date.now()
    db.listFavoriteNotes(profile.id, 6)
      .then(setNotes)
      .catch(() => setNotes((prev) => prev ?? []))
  }, [profile])

  useEffect(() => {
    if (!profile) return
    // Nao refaz a consulta a cada navegacao: no maximo uma a cada 30 s. A checagem da lista atual
    // e necessaria porque, sem ela, a dupla execucao do modo de desenvolvimento gastava a unica
    // busca permitida e a lista nascia vazia.
    if (notes && Date.now() - lastFetch.current < 30_000) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, location.pathname])

  // Coracao clicado na tela inicial: a lista daqui muda na hora, sem esperar os 30 s.
  useEffect(() => {
    const onChanged = () => load()
    window.addEventListener(FAVORITES_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, onChanged)
  }, [load])

  if (!profile || !notes) return null

  return (
    <div className="px-3 pb-2">
      <p className="px-3 mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
        <Heart size={12} className="shrink-0" />
        {t('sidebar.favorites')}
      </p>
      {notes.length === 0 ? (
        <p className="px-3 text-[11px] leading-snug text-content-muted">{t('sidebar.favoritesEmpty')}</p>
      ) : (
      <ul className="space-y-0.5">
        {notes.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => navigate(`/nota/${n.id}`)}
              title={n.title}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-content-secondary hover:bg-surface-elevated hover:text-content-primary transition-colors"
            >
              <span className="grid place-items-center h-7 w-7 rounded-lg bg-surface-elevated text-accent shrink-0">
                {n.type === 'video' ? (
                  <Video size={14} />
                ) : n.type === 'link' ? (
                  <Link2 size={14} />
                ) : n.type === 'file' || n.type === 'image' ? (
                  <FileText size={14} />
                ) : (
                  <Mic size={14} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate leading-tight">{n.title}</span>
                <span className="block text-[11px] text-content-muted leading-tight">
                  {n.status === 'processing' ? t('home.processing') : fmtRelative(n.created_at)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}

/* ---------- Desktop sidebar (SaaS layout) ---------- */
function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const { isAdmin, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const t = useT()
  const [newOpen, setNewOpen] = useState(false)

  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 flex-col overflow-y-auto border-r border-surface-border bg-surface-sidebar z-40">
      <button
        onClick={onCollapse}
        aria-label={t('sidebar.hide')}
        title={t('sidebar.hide')}
        className="absolute top-3 right-3 grid place-items-center h-8 w-8 rounded-lg text-content-muted hover:bg-surface-elevated hover:text-content-primary transition-colors"
      >
        <PanelLeftClose size={18} />
      </button>

      <div className="px-4 pt-7 pb-6 flex justify-center">
        <Logo part="ana" heightClass="h-10" />
      </div>

      <button
        onClick={() => setNewOpen(true)}
        className="btn-primary mx-4 mb-6 py-2.5 text-sm rounded-xl shadow-float"
      >
        <Mic size={17} />
        {t('sidebar.newNote')}
      </button>

      {/* Duas secoes: o menu principal e as "Mais funcoes" (as mesmas do Config). O nav em si
          nao tem rolagem propria (cabe com folga na maioria das telas); a rolagem-fallback e
          da propria <aside> acima, para o rodape (perfil/config/sair) nunca ficar inacessivel
          quando a altura util encolhe (barra de tarefas do Windows, zoom, tela pequena). */}
      <nav className="flex-1 px-3">
        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
          {t('sidebar.menu')}
        </p>
        <div className="space-y-1">
          {ITEMS.filter((i) => !i.adminOnly || isAdmin).map((i) => (
            <SidebarLink key={i.to} item={i} label={t(i.labelKey)} tag={i.tagKey ? t(i.tagKey) : undefined} />
          ))}
        </div>

        <p className="px-3 mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
          {t('settings.more')}
        </p>
        <div className="space-y-1 pb-2">
          {MORE_ITEMS.filter((i) => !i.adminOnly || isAdmin).map((i) => (
            <SidebarLink key={i.to} item={i} label={t(i.labelKey)} tag={i.tagKey ? t(i.tagKey) : undefined} />
          ))}
        </div>
      </nav>

      <SidebarFavorites />

      <div className="p-3 border-t border-surface-border flex items-center gap-2">
        {/* A foto leva direto para "Editar perfil"; a engrenagem ao lado abre o Config. */}
        <button
          onClick={() => navigate('/perfil')}
          title={t('settings.editProfile')}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          {profile && <Avatar first={profile.first_name} last={profile.last_name} size={36} url={profile.avatar_url} />}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {profile?.first_name} {profile?.last_name}
            </p>
            <p className="text-xs text-content-muted truncate">{profile?.email}</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/config')}
          aria-label={t('nav.config')}
          title={t('nav.config')}
          className="grid place-items-center h-9 w-9 rounded-xl text-content-secondary hover:bg-surface-elevated hover:text-content-primary transition-colors shrink-0"
        >
          <SettingsIcon size={18} />
        </button>
        <button
          onClick={signOut}
          aria-label={t('settings.logout')}
          title={t('settings.logout')}
          className="grid place-items-center h-9 w-9 rounded-xl text-content-secondary hover:bg-accent/10 hover:text-accent transition-colors shrink-0"
        >
          <LogOut size={18} />
        </button>
      </div>

      {newOpen && <NewNoteSheet open={newOpen} onClose={() => setNewOpen(false)} />}
    </aside>
  )
}

/* ---------- Mobile bottom nav (com estrela central) ---------- */
function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center gap-1 flex-1 py-1.5 text-[11px] font-medium transition-colors ${
          isActive ? 'text-accent' : 'text-content-muted hover:text-content-secondary'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {icon}
          <span>{label}</span>
          {/* Ponto vermelho sob o item ativo (referencia de design) */}
          <span
            aria-hidden
            className={`absolute -bottom-0.5 h-1 w-1 rounded-full bg-accent ${isActive ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      )}
    </NavLink>
  )
}

/**
 * Sempre 2 itens de cada lado do microfone, para TODO usuario. Antes o segundo slot da esquerda
 * era o Discador (admin-only): quem nao e admin via um menu de 4 itens com o microfone fora do
 * centro e um "buraco" ao lado de Notas -- parecia icone faltando (relato de 2026-09-04, PWA
 * iPhone). O Discador foi removido de vez em 17/09/2026.
 */
function BottomNav() {
  const t = useT()
  const [newOpen, setNewOpen] = useState(false)

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom nav-bg-bleed bg-surface-sidebar/95 backdrop-blur border-t border-surface-border">
      <div className="mx-auto max-w-2xl">
        <div className="relative flex items-center h-16 px-2">
          <NavItem to="/" icon={<Home size={20} />} label={t('nav.notes')} />
          <NavItem to="/tarefas" icon={<ListChecks size={20} />} label={t('nav.tasks')} />

          {/* Microfone central: abre TODAS as formas de criar nota (inclusive Gravacao inteligente) */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={() => setNewOpen(true)}
              aria-label={t('new.title')}
              className="mic-fab grid place-items-center h-14 w-14 -mt-8 rounded-full text-white transition-[filter]"
            >
              <Mic size={24} />
            </button>
          </div>

          <NavItem to="/agenda" icon={<CalendarDays size={20} />} label={t('nav.agenda')} />
          <NavItem to="/config" icon={<SettingsIcon size={20} />} label={t('nav.config')} />
        </div>
      </div>
      {newOpen && <NewNoteSheet open={newOpen} onClose={() => setNewOpen(false)} />}
    </nav>
  )
}

const SIDEBAR_KEY = 'tailor.sidebar'

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const t = useT()
  const { isAdmin, profile } = useAuth()
  const { settings } = useAppSettings()
  const hideMobileNav = HIDE_MOBILE_NAV_ON.some((p) => location.pathname.startsWith(p))
  const showBanner = announcementActive(settings)
  const wide = WIDE_ROUTES.includes(location.pathname)

  const [helpOpen, setHelpOpen] = useState(false)

  // Sidebar recolhida (so no desktop). A escolha persiste entre sessoes.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
    } catch {
      return false
    }
  })
  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'open')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  // Lembretes de eventos do calendario (enquanto o app esta aberto).
  useEffect(() => startCalendarReminders(), [])

  // Gravacao que ficou pela metade (app fechado ou recarregado no meio do processamento): volta
  // para a fila sozinha. Fica aqui, e nao na tela de gravacao, porque quem reabre o app cai na
  // Home -- se dependesse de abrir /capturar, a nota ficaria "processando" para sempre.
  useEffect(() => {
    if (!profile) return
    void retomarPendentes(profile.id)
  }, [profile])

  // Share target (APK Android): audio/video compartilhado de outro app cai aqui.
  useEffect(() => {
    if (!canReceiveSharedFiles()) return
    let alive = true

    async function check() {
      const f = await consumeSharedFile()
      if (f && alive) {
        setPendingUpload(f)
        navigate('/capturar?mode=upload&shared=1')
      }
    }

    void check() // app aberto pelo compartilhamento
    let removeListener: (() => void) | undefined
    void onSharedFile(() => void check()).then((r) => {
      if (alive) removeListener = r
      else r()
    })

    return () => {
      alive = false
      removeListener?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Modo manutencao: bloqueia todos exceto admin.
  if (settings?.maintenance_enabled && !isAdmin) {
    return <Maintenance settings={settings} />
  }

  return (
    <div className="min-h-dvh bg-surface-bg">
      {!collapsed && <Sidebar onCollapse={toggleSidebar} />}

      {/* Com a sidebar recolhida, o botao de reabrir fica no canto superior esquerdo. */}
      {collapsed && (
        <button
          onClick={toggleSidebar}
          aria-label={t('sidebar.show')}
          title={t('sidebar.show')}
          className="hidden md:grid fixed top-5 left-3 z-50 place-items-center h-9 w-9 rounded-xl bg-surface-card border border-surface-border text-content-secondary hover:text-content-primary transition-colors"
        >
          <PanelLeft size={18} />
        </button>
      )}

      {/* Recolhida: o conteudo ocupa a pagina toda (so o respiro do botao de reabrir). */}
      <div className={collapsed ? 'md:pl-14' : 'md:pl-64'}>
        <main
          className={`mx-auto w-full ${wide ? 'max-w-none' : 'max-w-6xl'} overflow-x-hidden ${hideMobileNav ? '' : 'pb-nav'} ${
            showBanner ? 'has-announcement' : ''
          }`}
        >
          {/* Aviso fino de "atualizacao disponivel" -- so aparece no app Windows quando o
              instalador nativo esta atras da ultima versao (a propria UpdateBanner decide). */}
          <UpdateBanner />
          {/* So no DESKTOP: no mobile (PWA/APK inclusive), aviso e dica atrapalhavam o topo da
              Home (empurravam "conversar com todas as reunioes" pra baixo) -- Home.tsx cuida da
              versao mobile, reposicionada depois daquele botao. Quando ha aviso, e ELE quem
              precisa vencer o notch/status bar (fica visualmente no topo) -- por isso usa
              safe-top aqui. A pagina logo abaixo (Outlet) tambem tem safe-top no proprio
              container (convencao usada em quase toda pagina do app), o que dobraria o respiro
              do notch; a classe "has-announcement" (index.css, so em telas md+) neutraliza esse
              segundo respiro so quando o aviso esta mesmo visivel NESSA posicao. */}
          {!hideMobileNav && (
            <div className={`hidden md:block ${showBanner ? 'px-5 safe-top' : 'px-5 pt-4'}`}>
              <AnnouncementBanner />
            </div>
          )}
          <Outlet />
        </main>
      </div>
      {!hideMobileNav && <BottomNav />}

      {/* ANA global (DESKTOP): botao + balao "Falar com a ANA" ao lado. */}
      <div className="hidden md:flex fixed right-6 bottom-6 z-50 items-center gap-3">
        <span className="rounded-xl bg-surface-card border border-surface-border shadow-float px-3 py-1.5 text-sm font-medium text-content-secondary">
          {t('sidebar.talkAna')}
        </span>
        <button
          onClick={() => setHelpOpen(true)}
          aria-label={t('sidebar.talkAna')}
          className="grid place-items-center h-14 w-14 rounded-full shadow-float bg-surface-elevated text-accent border-2 border-brand-solid transition-opacity hover:opacity-90"
        >
          <AnaIcon size={26} />
        </button>
      </div>
      {helpOpen && <HelpAssistant open={helpOpen} onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
