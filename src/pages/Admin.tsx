import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Users,
  Mic,
  FileText,
  Sparkles,
  Search,
  Volume2,
  NotebookPen,
  Pencil,
  Trash2,
  LifeBuoy,
  Activity,
  ScrollText,
  Lightbulb,
} from 'lucide-react'
import { db } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import type { AdminUserRow, Profile, SupportTicket } from '../lib/types'
import { Avatar, ConfirmDialog, Sheet, Spinner } from '../components/ui'
import { fmtRelative, fmtDateTime } from '../lib/format'
import { AdminSettings } from './AdminSettings'

const USERS_PER_PAGE = 3

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-content-muted mb-2">
        <span className="text-accent">{icon}</span>
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-display text-2xl font-bold">{value}</p>
    </div>
  )
}

export function Admin() {
  const navigate = useNavigate()
  const { profile: me } = useAuth()
  const [rows, setRows] = useState<AdminUserRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tickets, setTickets] = useState<(SupportTicket & { profile?: Profile })[] | null>(null)

  function load() {
    db.adminRows().then(setRows)
    db.listTickets().then(setTickets).catch(() => setTickets([]))
  }
  useEffect(load, [])

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
      load()
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
      load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Falha ao excluir.')
    }
  }

  const totals = useMemo(() => {
    if (!rows) return { users: 0, notes: 0, recordings: 0, transcriptions: 0, ai: 0, tts: 0 }
    return rows.reduce(
      (acc, r) => ({
        users: acc.users + 1,
        notes: acc.notes + r.notesCount,
        recordings: acc.recordings + r.recordings,
        transcriptions: acc.transcriptions + r.transcriptions,
        ai: acc.ai + r.aiSuggestions,
        tts: acc.tts + r.ttsCount,
      }),
      { users: 0, notes: 0, recordings: 0, transcriptions: 0, ai: 0, tts: 0 },
    )
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        `${r.profile.first_name} ${r.profile.last_name}`.toLowerCase().includes(q) ||
        r.profile.email.toLowerCase().includes(q),
    )
  }, [rows, query])

  // Lista de usuarios paginada: 3 por pagina, para nao virar uma pagina unica gigante.
  const pageCount = Math.max(1, Math.ceil(filtered.length / USERS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(safePage * USERS_PER_PAGE, safePage * USERS_PER_PAGE + USERS_PER_PAGE)

  useEffect(() => {
    setPage(0) // uma busca nova sempre volta para a primeira pagina
  }, [query])

  return (
    <div className="px-5 safe-top">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold">Administrador</h1>
          <p className="text-sm text-content-muted">Uso da plataforma por usuário</p>
        </div>
      </header>

      {rows === null ? (
        <div className="grid place-items-center py-20">
          <Spinner size={24} className="text-accent" />
        </div>
      ) : (
        <>
          {/* Manutencao e KPIs dividem a largura da pagina meio a meio (empilha no mobile) --
              tudo que da uma visao geral rapida do estado do app junto, sem apertar nenhum
              dos dois lados. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <AdminSettings />
            <div className="grid grid-cols-3 gap-3 content-start">
              <StatCard icon={<Users size={16} />} label="Usuarios" value={totals.users} />
              <StatCard icon={<NotebookPen size={16} />} label="Notas" value={totals.notes} />
              <StatCard icon={<Mic size={16} />} label="Gravações" value={totals.recordings} />
              <StatCard icon={<FileText size={16} />} label="Transcrições" value={totals.transcriptions} />
              <StatCard icon={<Sparkles size={16} />} label="Sugestões IA" value={totals.ai} />
              <StatCard icon={<Volume2 size={16} />} label="Narracoes" value={totals.tts} />
            </div>
          </div>

          {/* Atalhos de admin logo abaixo dos KPIs -- tamanho compacto pra caber lado a lado
              nessa mesma largura, em vez de cards largos e altos la embaixo da pagina. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
            <button
              onClick={() => navigate('/admin/api')}
              className="card p-4 flex items-center gap-3 text-left hover:border-accent/40 transition-colors"
            >
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/10 text-accent shrink-0">
                <Activity size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">Monitoramento da API</span>
                <span className="block text-xs text-content-muted truncate">Tokens, custo e KPIs</span>
              </span>
            </button>

            <button
              onClick={() => navigate('/admin/audit')}
              className="card p-4 flex items-center gap-3 text-left hover:border-accent/40 transition-colors"
            >
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/10 text-accent shrink-0">
                <ScrollText size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">Log de auditoria</span>
                <span className="block text-xs text-content-muted truncate">Erros gerais e de segurança</span>
              </span>
            </button>

            <button
              onClick={() => navigate('/admin/dicas')}
              className="card p-4 flex items-center gap-3 text-left hover:border-accent/40 transition-colors"
            >
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/10 text-accent shrink-0">
                <Lightbulb size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">Avisos e Dicas</span>
                <span className="block text-xs text-content-muted truncate">Faixa de avisos e dicas da Home</span>
              </span>
            </button>
          </div>

          <div className="relative mb-4">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              className="input pl-11"
              placeholder="Buscar usuário por nome ou e-mail"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Table (desktop) */}
          <div className="hidden md:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated text-content-muted">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-3 py-3 font-medium text-center">Notas</th>
                  <th className="px-3 py-3 font-medium text-center">Gravacoes</th>
                  <th className="px-3 py-3 font-medium text-center">Transcricoes</th>
                  <th className="px-3 py-3 font-medium text-center">Sugestões IA</th>
                  <th className="px-3 py-3 font-medium text-center">Narracoes</th>
                  <th className="px-4 py-3 font-medium">Última atividade</th>
                  <th className="px-3 py-3 font-medium text-center">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {paged.map((r) => (
                  <tr key={r.profile.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar first={r.profile.first_name} last={r.profile.last_name} size={34} />
                        <div className="min-w-0">
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
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums">{r.notesCount}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{r.recordings}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{r.transcriptions}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{r.aiSuggestions}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{r.ttsCount}</td>
                    <td className="px-4 py-3 text-content-muted">{fmtRelative(r.lastActivity)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(r.profile)}
                          className="grid place-items-center h-8 w-8 rounded-lg text-content-secondary hover:bg-surface-elevated"
                          aria-label="Editar"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setPendingDelete(r.profile)}
                          disabled={r.profile.id === me?.id}
                          className="grid place-items-center h-8 w-8 rounded-lg text-content-secondary hover:bg-brand-solid hover:text-white disabled:opacity-30"
                          aria-label="Excluir"
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

          {/* Cards (mobile) */}
          <div className="md:hidden space-y-3">
            {paged.map((r) => (
              <div key={r.profile.id} className="card p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar first={r.profile.first_name} last={r.profile.last_name} size={40} />
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
                  <Metric label="Transcr." value={r.transcriptions} />
                  <Metric label="Sug. IA" value={r.aiSuggestions} />
                  <Metric label="Narracoes" value={r.ttsCount} />
                  <div>
                    <p className="text-[11px] text-content-muted">Atividade</p>
                    <p className="text-xs font-medium mt-1">{fmtRelative(r.lastActivity)}</p>
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
                Anterior
              </button>
              <span className="text-sm text-content-muted tabular-nums">
                {safePage + 1} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="btn-outline h-9 px-3 text-sm disabled:opacity-40"
              >
                Proxima
              </button>
            </div>
          )}

          <ConfirmDialog
            open={!!pendingDelete}
            title="Excluir usuário?"
            message={
              pendingDelete
                ? `${pendingDelete.first_name} ${pendingDelete.last_name} (${pendingDelete.email}). Isso remove também as notas e dados dele. Não pode ser desfeito.`
                : undefined
            }
            confirmLabel="Excluir"
            cancelLabel="Cancelar"
            danger
            onConfirm={() => pendingDelete && deleteUser(pendingDelete)}
            onClose={() => setPendingDelete(null)}
          />

          {/* Chamados de suporte recebidos (somente admin) */}
          <div className="mt-8 mb-10">
            <h2 className="flex items-center gap-2 font-display font-semibold mb-3">
              <LifeBuoy size={18} className="text-accent" /> Chamados recebidos
              {tickets && tickets.length > 0 && (
                <span className="text-xs font-normal text-content-muted">({tickets.length})</span>
              )}
            </h2>
            {tickets === null ? (
              <div className="grid place-items-center py-8"><Spinner className="text-accent" /></div>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-content-muted">Nenhum chamado recebido.</p>
            ) : (
              <ul className="space-y-3 max-w-2xl">
                {tickets.map((tk) => (
                  <li key={tk.id} className="card p-4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide bg-brand-solid text-white px-2 py-0.5 rounded-full shrink-0">{tk.topic}</span>
                      {tk.subject && <span className="font-medium text-sm truncate min-w-0 flex-1">{tk.subject}</span>}
                      <span className="text-xs text-content-muted ml-auto shrink-0">{fmtDateTime(tk.created_at)}</span>
                    </div>
                    <p className="text-sm text-content-secondary whitespace-pre-line">{tk.message}</p>
                    {tk.profile && (
                      <p className="text-xs text-content-muted mt-2">
                        {tk.profile.first_name} {tk.profile.last_name} • {tk.profile.email}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Editar usuário">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nome</label>
              <input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Sobrenome</label>
              <input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">E-mail</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          {actionError && (
            <div className="alert-error">
              {actionError}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button className="btn-outline flex-1" onClick={() => setEditing(null)}>Cancelar</button>
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
    <div className="bg-surface-elevated rounded-xl py-2">
      <p className="font-display font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-content-muted">{label}</p>
    </div>
  )
}
