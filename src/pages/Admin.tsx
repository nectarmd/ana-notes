import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  LifeBuoy,
  Megaphone,
  Mic,
  NotebookPen,
  Pencil,
  RotateCcw,
  ScrollText,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  Volume2,
  Wrench,
} from 'lucide-react'
import { db } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { useAppSettings } from '../app/SettingsProvider'
import type { AdminUserRow, Profile, SupportTicket, TicketTopic } from '../lib/types'
import { AutoTextarea, Avatar, Chip, ConfirmDialog, Sheet, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { fmtRelative, fmtDateTime } from '../lib/format'
import { MaintenanceForm } from './AdminSettings'
import { getUsageReport, periodRange } from '../lib/apiUsage'
import { getAuditSummary, logSilentError } from '../lib/auditLog'
import { adminListNotices, noticeStatus } from '../lib/notices'
import { money } from '../lib/currency'

const USERS_PER_PAGE = 8
/** "Ativo" no KPI = teve atividade nos ultimos N dias. */
const ACTIVE_DAYS = 7

const TOPIC_LABEL: Record<TicketTopic, string> = {
  financeiro: 'Financeiro',
  tecnico: 'Técnico',
  feedback: 'Feedback',
  outros: 'Outros',
}

const META_LABEL: Record<string, string> = {
  site: 'Site',
  app: 'App Windows',
  device: 'Dispositivo',
  lang: 'Idioma',
}

type Ticket = SupportTicket & { profile?: Profile }
type SortKey = 'activity' | 'notes' | 'name'
type TicketFilter = 'aberto' | 'resolvido' | 'todos'
/** undefined = carregando; null = falhou (mostra "—", sem inventar numero). */
type Stat<T> = T | null | undefined

function StatCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-center gap-2 text-content-muted mb-2 min-w-0">
        <span className="text-accent shrink-0">{icon}</span>
        <span className="text-xs uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className="font-display text-2xl font-bold tabular-nums">{value.toLocaleString('pt-BR')}</p>
      {hint && <p className="text-xs text-content-muted mt-0.5 truncate">{hint}</p>}
    </div>
  )
}

function ToolCard({
  icon,
  title,
  desc,
  stat,
  alert,
  onClick,
}: {
  icon: ReactNode
  title: string
  desc: string
  stat: ReactNode
  alert?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="card p-4 h-full flex flex-col gap-3 text-left hover:border-accent/40 hover:shadow-hover transition-all"
    >
      <span className="flex items-center gap-3 w-full">
        <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/10 text-accent shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-sm">{title}</span>
          <span className="block text-xs text-content-muted truncate">{desc}</span>
        </span>
        <ChevronRight size={18} className="text-content-muted shrink-0" />
      </span>
      <span
        className={`mt-auto flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
          alert ? 'bg-accent/10 text-accent' : 'bg-surface-elevated text-content-secondary'
        }`}
      >
        {stat}
      </span>
    </button>
  )
}

const loadingStat = <span className="text-content-muted">Carregando…</span>

function TicketStatusBadge({ tk }: { tk: Ticket }) {
  if (tk.status === 'resolvido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5">
        <CheckCircle2 size={11} /> {tk.reply ? 'Respondido' : 'Resolvido'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5">
      Aberto
    </span>
  )
}

function TicketCard({ tk, adminId, onChanged }: { tk: Ticket; adminId: string; onChanged: () => void }) {
  const toast = useToast()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState<'reply' | 'status' | null>(null)
  const name = tk.profile ? `${tk.profile.first_name} ${tk.profile.last_name}`.trim() : 'Usuário removido'
  const meta = tk.meta
    ? Object.entries(tk.meta)
        .filter(([, v]) => v)
        .map(([k, v]) => `${META_LABEL[k] ?? k}: ${v}`)
        .join(' · ')
    : ''

  async function sendReply() {
    if (!reply.trim()) return
    setBusy('reply')
    try {
      await db.replyTicket(tk.id, reply, adminId)
      toast('Resposta enviada')
      onChanged()
    } catch (err) {
      logSilentError('client:Admin.replyTicket', err)
      toast('Não foi possível enviar a resposta', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(status: 'aberto' | 'resolvido') {
    setBusy('status')
    try {
      await db.setTicketStatus(tk.id, status)
      toast(status === 'resolvido' ? 'Chamado resolvido' : 'Chamado reaberto')
      onChanged()
    } catch (err) {
      logSilentError('client:Admin.setTicketStatus', err)
      toast('Não foi possível atualizar o chamado', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        {tk.profile ? (
          <Avatar first={tk.profile.first_name} last={tk.profile.last_name} size={36} url={tk.profile.avatar_url} />
        ) : (
          <span className="h-9 w-9 rounded-full bg-surface-elevated shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-sm truncate max-w-full">{name}</span>
            <span className="text-[10px] uppercase tracking-wide bg-surface-elevated border border-surface-border text-content-secondary px-2 py-0.5 rounded-full">
              {TOPIC_LABEL[tk.topic] ?? tk.topic}
            </span>
            <TicketStatusBadge tk={tk} />
          </div>
          <p className="text-xs text-content-muted mt-0.5 truncate">
            {tk.profile?.email ? `${tk.profile.email} · ` : ''}
            {fmtDateTime(tk.created_at)}
          </p>
          {tk.subject && <p className="font-medium text-sm mt-2 break-words">{tk.subject}</p>}
          <p className="text-sm text-content-secondary whitespace-pre-line break-words mt-1">{tk.message}</p>
          {meta && <p className="text-[11px] text-content-muted mt-2 break-words">{meta}</p>}

          {tk.reply && (
            <div className="mt-3 rounded-xl bg-surface-elevated border border-surface-border p-3">
              <p className="text-[11px] uppercase tracking-wide text-content-muted mb-1">
                Resposta enviada{tk.replied_at ? ` · ${fmtDateTime(tk.replied_at)}` : ''}
              </p>
              <p className="text-sm whitespace-pre-line break-words">{tk.reply}</p>
            </div>
          )}

          {tk.status === 'aberto' && !tk.reply && (
            <div className="mt-3">
              <AutoTextarea
                minRows={2}
                maxRows={8}
                className="text-sm"
                placeholder="Escreva a resposta. A pessoa vê em Suporte e recebe um aviso no sininho."
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="flex flex-wrap gap-2 mt-2">
                <button onClick={sendReply} disabled={!reply.trim() || !!busy} className="btn-primary h-9 px-3 text-sm">
                  {busy === 'reply' ? <Spinner size={14} /> : <Send size={14} />} Responder e resolver
                </button>
                <button onClick={() => setStatus('resolvido')} disabled={!!busy} className="btn-ghost h-9 px-3 text-sm">
                  {busy === 'status' ? <Spinner size={14} /> : <CheckCircle2 size={14} />} Resolver sem responder
                </button>
              </div>
            </div>
          )}

          {tk.status === 'resolvido' && (
            <button
              onClick={() => setStatus('aberto')}
              disabled={!!busy}
              className="btn-ghost h-8 px-2.5 text-xs mt-2 text-content-muted"
            >
              {busy === 'status' ? <Spinner size={12} /> : <RotateCcw size={12} />} Reabrir
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function Admin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile: me } = useAuth()
  const { settings } = useAppSettings()
  const [rows, setRows] = useState<AdminUserRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('activity')
  const [page, setPage] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('aberto')
  const [maintOpen, setMaintOpen] = useState(false)

  const [monthCost, setMonthCost] = useState<Stat<number>>(undefined)
  const [openProblems, setOpenProblems] = useState<Stat<number>>(undefined)
  const [activeNotices, setActiveNotices] = useState<Stat<number>>(undefined)

  function loadUsers() {
    db.adminRows()
      .then(setRows)
      .catch((err) => {
        logSilentError('client:Admin.adminRows', err)
        setRows([])
      })
  }
  function loadTickets() {
    db.listTickets()
      .then(setTickets)
      .catch(() => setTickets([]))
  }

  useEffect(() => {
    loadUsers()
    loadTickets()
    // Numeros dos atalhos: cada um independente -- um que falhe nao segura os outros.
    getUsageReport(periodRange('month'), null)
      .then((r) => setMonthCost(r.totals.cost_real))
      .catch(() => setMonthCost(null))
    getAuditSummary({
      from: new Date(Date.now() - 7 * 86400000).toISOString(),
      to: new Date().toISOString(),
      severities: ['error', 'critical'],
    })
      .then((s) => setOpenProblems(s.groups.length))
      .catch(() => setOpenProblems(null))
    adminListNotices()
      .then((list) => setActiveNotices(list.filter((n) => noticeStatus(n) === 'active').length))
      .catch(() => setActiveNotices(null))
  }, [])

  // Vindo do sininho ("Novo chamado de suporte"): rola ate os chamados quando eles carregam.
  useEffect(() => {
    if (location.hash === '#chamados' && tickets) {
      document.getElementById('chamados')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash, tickets])

  function openEdit(p: Profile) {
    setActionError(null)
    setForm({ first_name: p.first_name, last_name: p.last_name, email: p.email })
    setEditing(p)
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(true)
    setActionError(null)
    try {
      await db.adminUpdateUser(editing.id, form)
      setEditing(null)
      loadUsers()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteUser(p: Profile) {
    try {
      await db.adminDeleteUser(p.id)
      setPendingDelete(null)
      loadUsers()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Falha ao excluir.')
    }
  }

  const totals = useMemo(() => {
    const zero = { users: 0, active: 0, notes: 0, recordings: 0, transcriptions: 0, ai: 0, tts: 0 }
    if (!rows) return zero
    const since = Date.now() - ACTIVE_DAYS * 86400000
    return rows.reduce(
      (acc, r) => ({
        users: acc.users + 1,
        active: acc.active + (r.lastActivity && Date.parse(r.lastActivity) >= since ? 1 : 0),
        notes: acc.notes + r.notesCount,
        recordings: acc.recordings + r.recordings,
        transcriptions: acc.transcriptions + r.transcriptions,
        ai: acc.ai + r.aiSuggestions,
        tts: acc.tts + r.ttsCount,
      }),
      zero,
    )
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    const list = q
      ? rows.filter(
          (r) =>
            `${r.profile.first_name} ${r.profile.last_name}`.toLowerCase().includes(q) ||
            r.profile.email.toLowerCase().includes(q),
        )
      : [...rows]
    list.sort((a, b) => {
      if (sort === 'notes') return b.notesCount - a.notesCount
      if (sort === 'name')
        return `${a.profile.first_name} ${a.profile.last_name}`.localeCompare(`${b.profile.first_name} ${b.profile.last_name}`, 'pt-BR')
      return (b.lastActivity ? Date.parse(b.lastActivity) : 0) - (a.lastActivity ? Date.parse(a.lastActivity) : 0)
    })
    return list
  }, [rows, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / USERS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(safePage * USERS_PER_PAGE, safePage * USERS_PER_PAGE + USERS_PER_PAGE)

  useEffect(() => {
    setPage(0) // busca ou ordenacao nova sempre volta para a primeira pagina
  }, [query, sort])

  const openTickets = (tickets ?? []).filter((tk) => tk.status === 'aberto').length
  const resolvedTickets = (tickets ?? []).length - openTickets
  const shownTickets = (tickets ?? []).filter((tk) => ticketFilter === 'todos' || tk.status === ticketFilter)

  const maintenanceOn = !!settings?.maintenance_enabled

  return (
    <div className="px-5 safe-top pb-16">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">Painel de administrador</h1>
          <p className="text-sm text-content-muted">Ferramentas, uso da plataforma, chamados e usuários</p>
        </div>
      </header>

      {/* 1) Ferramentas: cada atalho ja mostra o numero que decide se vale abrir agora. */}
      <h2 className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">Ferramentas</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 mb-8">
        <ToolCard
          icon={<Activity size={18} />}
          title="Custos das APIs"
          desc="Gasto real, limites e alertas"
          onClick={() => navigate('/admin/api')}
          stat={
            monthCost === undefined
              ? loadingStat
              : monthCost === null
                ? '—'
                : `${money(monthCost, 'USD', null)} neste mês`
          }
        />
        <ToolCard
          icon={<ScrollText size={18} />}
          title="Log de auditoria"
          desc="Erros agrupados por problema"
          onClick={() => navigate('/admin/audit')}
          alert={!!openProblems}
          stat={
            openProblems === undefined
              ? loadingStat
              : openProblems === null
                ? '—'
                : openProblems === 0
                  ? 'Nenhum problema aberto em 7 dias'
                  : `${openProblems} ${openProblems === 1 ? 'problema aberto' : 'problemas abertos'} em 7 dias`
          }
        />
        <ToolCard
          icon={<Megaphone size={18} />}
          title="Avisos e dicas"
          desc="Sininho, faixa do topo e dicas da Home"
          onClick={() => navigate('/admin/dicas')}
          stat={
            activeNotices === undefined
              ? loadingStat
              : activeNotices === null
                ? '—'
                : activeNotices === 0
                  ? 'Nenhum aviso ativo no sininho'
                  : `${activeNotices} ${activeNotices === 1 ? 'aviso ativo' : 'avisos ativos'} no sininho`
          }
        />
        <ToolCard
          icon={<Wrench size={18} />}
          title="Modo manutenção"
          desc="Bloqueia o app para os usuários"
          onClick={() => setMaintOpen(true)}
          alert={maintenanceOn}
          stat={
            <>
              <span className={`h-2 w-2 rounded-full ${maintenanceOn ? 'bg-brand-solid animate-pulse' : 'bg-emerald-500'}`} />
              {maintenanceOn ? 'Ativo: app bloqueado' : 'Desligado'}
            </>
          }
        />
      </div>

      {rows === null ? (
        <div className="grid place-items-center py-20">
          <Spinner size={24} className="text-accent" />
        </div>
      ) : (
        <>
          {/* 2) Visao geral */}
          <h2 className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">Visão geral</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
            <StatCard
              icon={<Users size={16} />}
              label="Usuários"
              value={totals.users}
              hint={`${totals.active} ${totals.active === 1 ? 'ativo' : 'ativos'} em ${ACTIVE_DAYS} dias`}
            />
            <StatCard icon={<NotebookPen size={16} />} label="Notas" value={totals.notes} />
            <StatCard icon={<Mic size={16} />} label="Gravações" value={totals.recordings} />
            <StatCard icon={<FileText size={16} />} label="Transcrições" value={totals.transcriptions} />
            <StatCard icon={<Sparkles size={16} />} label="Sugestões de IA" value={totals.ai} />
            <StatCard icon={<Volume2 size={16} />} label="Narrações" value={totals.tts} />
          </div>

          {/* 3) Usuarios e chamados lado a lado em tela bem larga; empilhados no resto. */}
          <div className="grid grid-cols-1 gap-8 2xl:grid-cols-[minmax(0,1fr)_30rem] 2xl:items-start">
            <section aria-labelledby="usuarios">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h2 id="usuarios" className="flex items-center gap-2 font-display font-semibold">
                  <UserCheck size={18} className="text-accent" /> Usuários
                  <span className="text-xs font-normal text-content-muted">({filtered.length})</span>
                </h2>
                <span className="flex-1" />
                <label className="flex items-center gap-2 text-xs text-content-muted">
                  Ordenar por
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="input h-9 py-0 px-2 w-auto text-sm"
                  >
                    <option value="activity">Atividade recente</option>
                    <option value="notes">Mais notas</option>
                    <option value="name">Nome</option>
                  </select>
                </label>
              </div>

              <div className="relative mb-3">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
                <input
                  className="input pl-11"
                  placeholder="Buscar usuário por nome ou e-mail"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {filtered.length === 0 ? (
                <p className="text-sm text-content-muted py-6 text-center">Nenhum usuário encontrado.</p>
              ) : (
                <>
                  {/* Tabela (desktop) */}
                  <div className="hidden md:block card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-elevated text-content-muted">
                        <tr className="text-left">
                          <th className="px-4 py-3 font-medium">Usuário</th>
                          <th className="px-3 py-3 font-medium text-center">Notas</th>
                          <th className="px-3 py-3 font-medium text-center">Gravações</th>
                          <th className="px-3 py-3 font-medium text-center">Transcrições</th>
                          <th className="px-3 py-3 font-medium text-center">Sugestões de IA</th>
                          <th className="px-3 py-3 font-medium text-center">Narrações</th>
                          <th className="px-4 py-3 font-medium whitespace-nowrap">Última atividade</th>
                          <th className="px-3 py-3 font-medium text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-border">
                        {paged.map((r) => (
                          <tr key={r.profile.id} className="hover:bg-surface-elevated/50">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <Avatar first={r.profile.first_name} last={r.profile.last_name} size={34} url={r.profile.avatar_url} />
                                <div className="min-w-0">
                                  <p className="font-medium flex items-center gap-2 min-w-0">
                                    <span className="truncate min-w-0">
                                      {r.profile.first_name} {r.profile.last_name}
                                    </span>
                                    {r.profile.role === 'admin' && (
                                      <span className="text-[10px] uppercase bg-brand-solid text-white px-1.5 py-0.5 rounded shrink-0">
                                        admin
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-content-muted text-xs truncate">{r.profile.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center tabular-nums">{r.notesCount}</td>
                            <td className="px-3 py-3 text-center tabular-nums">{r.recordings}</td>
                            <td className="px-3 py-3 text-center tabular-nums">{r.transcriptions}</td>
                            <td className="px-3 py-3 text-center tabular-nums">{r.aiSuggestions}</td>
                            <td className="px-3 py-3 text-center tabular-nums">{r.ttsCount}</td>
                            <td className="px-4 py-3 text-content-muted whitespace-nowrap">{fmtRelative(r.lastActivity)}</td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => openEdit(r.profile)}
                                  className="grid place-items-center h-8 w-8 rounded-lg text-content-secondary hover:bg-surface-elevated"
                                  aria-label="Editar"
                                  title="Editar"
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  onClick={() => setPendingDelete(r.profile)}
                                  disabled={r.profile.id === me?.id}
                                  className="grid place-items-center h-8 w-8 rounded-lg text-content-secondary hover:bg-brand-solid hover:text-white disabled:opacity-30"
                                  aria-label="Excluir"
                                  title="Excluir"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Cartoes (mobile) */}
                  <div className="md:hidden space-y-3">
                    {paged.map((r) => (
                      <div key={r.profile.id} className="card p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <Avatar first={r.profile.first_name} last={r.profile.last_name} size={40} url={r.profile.avatar_url} />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium flex items-center gap-2 min-w-0">
                              <span className="truncate min-w-0 flex-1">
                                {r.profile.first_name} {r.profile.last_name}
                              </span>
                              {r.profile.role === 'admin' && (
                                <span className="text-[10px] uppercase bg-brand-solid text-white px-1.5 py-0.5 rounded shrink-0">
                                  admin
                                </span>
                              )}
                            </p>
                            <p className="text-content-muted text-xs truncate">{r.profile.email}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <Metric label="Notas" value={r.notesCount} />
                          <Metric label="Gravações" value={r.recordings} />
                          <Metric label="Transcrições" value={r.transcriptions} />
                          <Metric label="Sugestões IA" value={r.aiSuggestions} />
                          <Metric label="Narrações" value={r.ttsCount} />
                          <div className="bg-surface-elevated rounded-xl py-2 px-1">
                            <p className="text-xs font-medium leading-tight">{fmtRelative(r.lastActivity)}</p>
                            <p className="text-[11px] text-content-muted">Atividade</p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => openEdit(r.profile)} className="btn-outline flex-1 h-9 text-sm">
                            <Pencil size={15} /> Editar
                          </button>
                          <button
                            onClick={() => setPendingDelete(r.profile)}
                            disabled={r.profile.id === me?.id}
                            className="btn-outline h-9 text-sm text-accent disabled:opacity-30"
                          >
                            <Trash2 size={15} /> Excluir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {pageCount > 1 && (
                    <div className="flex items-center justify-center gap-3 mt-4">
                      <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                        className="btn-outline h-9 px-3 text-sm disabled:opacity-40"
                      >
                        <ChevronLeft size={16} /> Anterior
                      </button>
                      <span className="text-sm text-content-muted tabular-nums">
                        {safePage + 1} / {pageCount}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                        disabled={safePage >= pageCount - 1}
                        className="btn-outline h-9 px-3 text-sm disabled:opacity-40"
                      >
                        Próxima <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* 4) Chamados de suporte (o sininho do admin aponta para ca) */}
            <section id="chamados" aria-labelledby="chamados-titulo" className="scroll-mt-6">
              <h2 id="chamados-titulo" className="flex items-center gap-2 font-display font-semibold mb-3">
                <LifeBuoy size={18} className="text-accent" /> Chamados de suporte
              </h2>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Chip active={ticketFilter === 'aberto'} onClick={() => setTicketFilter('aberto')}>
                  Abertos ({openTickets})
                </Chip>
                <Chip active={ticketFilter === 'resolvido'} onClick={() => setTicketFilter('resolvido')}>
                  Resolvidos ({resolvedTickets})
                </Chip>
                <Chip active={ticketFilter === 'todos'} onClick={() => setTicketFilter('todos')}>
                  Todos
                </Chip>
              </div>
              {tickets === null ? (
                <div className="grid place-items-center py-8">
                  <Spinner className="text-accent" />
                </div>
              ) : shownTickets.length === 0 ? (
                <div className="card p-6 text-center text-sm text-content-muted">
                  {ticketFilter === 'aberto' ? 'Nenhum chamado aberto. Tudo em dia.' : 'Nenhum chamado aqui.'}
                </div>
              ) : (
                <ul className="space-y-3">
                  {shownTickets.map((tk) => (
                    <TicketCard key={tk.id} tk={tk} adminId={me?.id ?? ''} onChanged={loadTickets} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir usuário?"
        message={
          pendingDelete
            ? `${pendingDelete.first_name} ${pendingDelete.last_name} (${pendingDelete.email}). Isso remove também as notas e os dados dessa pessoa. Não pode ser desfeito.`
            : undefined
        }
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        onConfirm={() => pendingDelete && deleteUser(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />

      <Sheet open={maintOpen} onClose={() => setMaintOpen(false)} title="Modo manutenção">
        <MaintenanceForm onDone={() => setMaintOpen(false)} />
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Editar usuário">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="label">Nome</label>
              <input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div className="min-w-0">
              <label className="label">Sobrenome</label>
              <input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">E-mail</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          {actionError && <div className="alert-error">{actionError}</div>}
          <div className="flex gap-3 pt-1">
            <button className="btn-outline flex-1" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="btn-primary flex-1" onClick={saveEdit} disabled={busy}>
              {busy ? <Spinner /> : 'Salvar'}
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-elevated rounded-xl py-2 px-1 min-w-0">
      <p className="font-display font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-content-muted truncate">{label}</p>
    </div>
  )
}
