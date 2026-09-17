import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Info,
  Layers,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Users,
  XCircle,
} from 'lucide-react'
import { db } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, ConfirmDialog, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { fmtDateTime } from '../lib/format'
import { periodRange, type PeriodKey } from '../lib/apiUsage'
import {
  getAuditSummary,
  listAuditOccurrences,
  logSilentError,
  resolveAuditGroup,
  resolveAuditLog,
  unresolveAuditLog,
  type AuditCategory,
  type AuditGroup,
  type AuditLogFilters,
  type AuditLogRow,
  type AuditSeverity,
  type AuditSummary,
} from '../lib/auditLog'
import { codeInfo, OWNER_LABEL } from '../lib/errorCodes'
import { Kpi, Segmented, Toggle } from '../components/apiMonitor/ui'
import type { Profile } from '../lib/types'

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'custom', label: 'Período' },
]

const CATEGORIES: AuditCategory[] = ['system', 'silent', 'user', 'security']

// Cores da paleta de STATUS (a mesma do painel de custos), sempre com icone + rotulo.
const SEVERITY: Record<AuditSeverity, { label: string; color: string; icon: React.ReactNode }> = {
  critical: { label: 'Crítico', color: '#d03b3b', icon: <AlertOctagon size={14} /> },
  error: { label: 'Erro', color: '#ec835a', icon: <XCircle size={14} /> },
  warning: { label: 'Aviso', color: '#fab219', icon: <AlertTriangle size={14} /> },
  info: { label: 'Info', color: 'currentColor', icon: <Info size={14} /> },
}

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  system: 'Sistema',
  silent: 'Silencioso',
  user: 'Usuário',
  security: 'Segurança',
}

function SeverityTag({ severity }: { severity: AuditSeverity }) {
  const s = SEVERITY[severity]
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-content-secondary whitespace-nowrap">
      <span style={{ color: s.color }} className="shrink-0 text-content-muted">
        {s.icon}
      </span>
      {s.label}
    </span>
  )
}

const fmtShort = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Uma ocorrencia dentro do grupo: quando, quem, onde, e o detalhe tecnico sob demanda. */
function OccurrenceRow({
  row,
  person,
  busy,
  onToggleResolved,
}: {
  row: AuditLogRow
  person?: Profile
  busy: boolean
  onToggleResolved: (row: AuditLogRow) => void
}) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!row.detail && Object.keys(row.detail).length > 0
  const resolved = !!row.resolved_at

  return (
    <li className={`py-2.5 ${resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-content-muted">
            <span className="tabular-nums font-medium text-content-secondary">{fmtDateTime(row.created_at)}</span>
            {person ? (
              <span className="inline-flex items-center gap-1">
                <Avatar first={person.first_name} last={person.last_name} size={16} url={person.avatar_url} />
                {person.first_name} {person.last_name}
              </span>
            ) : row.user_id ? (
              <span>usuário removido</span>
            ) : (
              <span>sem usuário</span>
            )}
            <span className="font-mono">{row.source}</span>
            {row.route && <span className="font-mono">{row.route}</span>}
            {resolved && <span>resolvido {fmtShort(row.resolved_at!)}</span>}
          </div>
          <p className="text-xs text-content-secondary mt-1 break-words line-clamp-3">{row.message}</p>
          {hasDetail && (
            <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[11px] font-medium text-content-muted hover:text-accent inline-flex items-center gap-0.5">
              <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> Detalhe técnico
            </button>
          )}
        </div>
        <button
          onClick={() => onToggleResolved(row)}
          disabled={busy}
          className="shrink-0 grid place-items-center h-8 w-8 rounded-lg border border-surface-border bg-surface-elevated text-content-muted hover:text-content-primary"
          aria-label={resolved ? 'Reabrir esta ocorrência' : 'Marcar esta ocorrência como resolvida'}
          title={resolved ? 'Reabrir' : 'Resolver só esta'}
        >
          {busy ? <Spinner size={14} /> : resolved ? <RotateCcw size={14} /> : <Check size={14} />}
        </button>
      </div>
      {open && hasDetail && (
        <pre className="mt-2 p-2.5 rounded-lg bg-surface-elevated text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
          {JSON.stringify(row.detail, null, 2)}
        </pre>
      )}
    </li>
  )
}

/** Um PROBLEMA: codigo, o que significa, o que fazer, quantas vezes e quem foi afetado. */
function GroupCard({
  group,
  filters,
  people,
  onResolveGroup,
}: {
  group: AuditGroup
  filters: AuditLogFilters
  people: Map<string, Profile>
  onResolveGroup: (g: AuditGroup, resolve: boolean) => void
}) {
  const toast = useToast()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AuditLogRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const info = codeInfo(group.code, group.sample)
  const known = group.code !== 'SEM_CODIGO'
  const allResolved = group.open === 0

  useEffect(() => {
    if (!open || rows) return
    listAuditOccurrences(group, filters)
      .then(setRows)
      .catch((err) => {
        logSilentError('client:AuditLog.occurrences', err)
        setRows([])
        toast('Não consegui carregar as ocorrências', 'error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function toggleRow(row: AuditLogRow) {
    if (!profile || !rows) return
    setBusyId(row.id)
    try {
      if (row.resolved_at) {
        await unresolveAuditLog([row.id])
        setRows(rows.map((r) => (r.id === row.id ? { ...r, resolved_at: null, resolved_by: null } : r)))
      } else {
        await resolveAuditLog([row.id], profile.id)
        setRows(
          filters.includeResolved
            ? rows.map((r) => (r.id === row.id ? { ...r, resolved_at: new Date().toISOString(), resolved_by: profile.id } : r))
            : rows.filter((r) => r.id !== row.id),
        )
      }
    } catch (err) {
      logSilentError('client:AuditLog.toggleRow', err)
      toast('Não consegui atualizar', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <li className={`card p-4 min-w-0 ${allResolved ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
        <SeverityTag severity={group.severity} />
        {known && <code className="text-[11px] text-content-muted break-all">{group.code}</code>}
        <span className="text-[11px] text-content-muted">· {OWNER_LABEL[info.owner]}</span>
      </div>

      <h3 className="font-medium leading-snug break-words">{known ? info.title : group.sample}</h3>
      {info.action && <p className="text-sm text-content-secondary mt-1 leading-snug">{info.action}</p>}

      <p className="text-[11px] text-content-muted mt-2 tabular-nums">
        <strong className="text-content-secondary font-semibold">
          {group.occurrences} {group.occurrences === 1 ? 'ocorrência' : 'ocorrências'}
        </strong>
        {group.users > 0 && ` · ${group.users} ${group.users === 1 ? 'usuário' : 'usuários'}`}
        {group.occurrences > 1 ? ` · de ${fmtShort(group.first_at)} a ${fmtShort(group.last_at)}` : ` · ${fmtShort(group.last_at)}`}
        {filters.includeResolved && group.open < group.occurrences && ` · ${group.occurrences - group.open} resolvidas`}
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button onClick={() => setOpen((o) => !o)} className="btn-outline h-8 px-3 text-xs" aria-expanded={open}>
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          {open ? 'Ocultar ocorrências' : 'Ver ocorrências'}
        </button>
        {allResolved ? (
          <button onClick={() => onResolveGroup(group, false)} className="btn-ghost h-8 px-3 text-xs">
            <RotateCcw size={14} /> Reabrir
          </button>
        ) : (
          <button onClick={() => onResolveGroup(group, true)} className="btn-ghost h-8 px-3 text-xs">
            <Check size={14} /> {group.open > 1 ? `Resolver as ${group.open}` : 'Resolver'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 border-t border-surface-border">
          {rows === null ? (
            <div className="grid place-items-center py-6">
              <Spinner size={18} className="text-accent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-content-muted py-3">Nenhuma ocorrência em aberto.</p>
          ) : (
            <>
              <ul className="divide-y divide-surface-border">
                {rows.map((r) => (
                  <OccurrenceRow
                    key={r.id}
                    row={r}
                    person={r.user_id ? people.get(r.user_id) : undefined}
                    busy={busyId === r.id}
                    onToggleResolved={toggleRow}
                  />
                ))}
              </ul>
              {rows.length >= 100 && <p className="text-[11px] text-content-muted pt-2">Mostrando as 100 mais recentes.</p>}
            </>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Log de auditoria (/admin/audit), reorganizado em 17/09/2026: agrupado por PROBLEMA, com o que
 * significa e o que fazer, numeros calculados no banco sobre o periodo inteiro, e filtros num card so.
 */
export function AuditLogPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [period, setPeriod] = useState<PeriodKey>('7d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [severity, setSeverity] = useState<'all' | 'problems' | AuditSeverity>('all')
  const [category, setCategory] = useState<'all' | AuditCategory>('all')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [includeResolved, setIncludeResolved] = useState(false)
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState<Map<string, Profile>>(new Map())
  const [pending, setPending] = useState<{ group: AuditGroup; resolve: boolean } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const customIncomplete = period === 'custom' && (!from || !to)
  const range = useMemo(() => periodRange(period, { from, to }), [period, from, to])

  const filters = useMemo<AuditLogFilters>(
    () => ({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      severities: severity === 'all' ? undefined : severity === 'problems' ? ['critical', 'error'] : [severity],
      categories: category === 'all' ? undefined : [category],
      search: search || undefined,
      includeResolved,
    }),
    [range, severity, category, search, includeResolved],
  )

  // Busca so depois de uma pausa na digitacao: cada tecla nao vira uma consulta.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchDraft.trim()), 400)
    return () => clearTimeout(id)
  }, [searchDraft])

  useEffect(() => {
    db.listProfiles()
      .then((all) => setPeople(new Map(all.map((p) => [p.id, p]))))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (customIncomplete) return
    setLoading(true)
    try {
      setSummary(await getAuditSummary(filters))
    } catch (err) {
      logSilentError('client:AuditLog.summary', err)
      toast('Não consegui carregar o log de auditoria', 'error')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, customIncomplete])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  async function confirmResolve() {
    if (!pending) return
    try {
      const n = await resolveAuditGroup(pending.group, filters, pending.resolve)
      toast(pending.resolve ? `${n} ${n === 1 ? 'ocorrência resolvida' : 'ocorrências resolvidas'}` : `${n} reabertas`)
      setReloadKey((k) => k + 1)
    } catch (err) {
      logSilentError('client:AuditLog.resolveGroup', err)
      toast('Não consegui atualizar', 'error')
    }
  }

  const t = summary?.totals
  const groups = summary?.groups ?? []

  return (
    <div className="px-4 sm:px-5 safe-top pb-16 max-w-5xl mx-auto">
      <header className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/admin')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2 flex-1 min-w-0">
          <ScrollText size={20} className="text-accent shrink-0" /> <span className="truncate">Log de auditoria</span>
        </h1>
        <button onClick={() => void load()} className="btn-ghost h-10 w-10 p-0 rounded-xl" aria-label="Atualizar" title="Atualizar">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* Todos os filtros num card, acima do que controlam. */}
      <div className="card p-3 mb-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <Segmented ariaLabel="Período" value={period} onChange={setPeriod} options={PERIODS} />
          <Segmented
            ariaLabel="Gravidade"
            value={severity}
            onChange={setSeverity}
            options={[
              { key: 'all', label: 'Tudo' },
              { key: 'problems', label: 'Erros e críticos' },
              { key: 'warning', label: 'Avisos' },
              { key: 'info', label: 'Info' },
            ]}
          />
        </div>

        {period === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="min-w-0">
              <span className="block text-[11px] text-content-muted mb-1">De</span>
              <input type="date" className="input w-full min-w-0 px-2" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="min-w-0">
              <span className="block text-[11px] text-content-muted mb-1">Até</span>
              <input type="date" className="input w-full min-w-0 px-2" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
            <input
              type="search"
              className="input w-full h-10 py-0 pl-9"
              placeholder="Buscar por mensagem ou código"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </div>
          <select
            className="input h-10 py-0 sm:w-56"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'all' | AuditCategory)}
            aria-label="Categoria"
          >
            <option value="all">Todas as categorias</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-content-secondary whitespace-nowrap">
            <Toggle on={includeResolved} onChange={() => setIncludeResolved((v) => !v)} label="Mostrar resolvidos" />
            Mostrar resolvidos
          </label>
        </div>
      </div>

      {customIncomplete ? (
        <div className="card p-8 text-center text-content-muted text-sm">Escolha as duas datas do período.</div>
      ) : !summary || !t ? (
        <div className="grid place-items-center py-20">
          <Spinner size={24} className="text-accent" />
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={<Layers size={15} />} label="Problemas distintos" value={String(groups.length)} hint={`${t.events} ${t.events === 1 ? 'evento' : 'eventos'} no período`} />
            <Kpi icon={<XCircle size={15} />} label="Erros e críticos" value={String(t.errors)} hint={t.critical ? `${t.critical} críticos` : 'nenhum crítico'} />
            <Kpi
              icon={<AlertOctagon size={15} />}
              label="Para você resolver"
              value={String(groups.filter((g) => g.open > 0 && codeInfo(g.code, g.sample).owner === 'admin').length)}
              hint="problemas em aberto"
            />
            <Kpi icon={<Users size={15} />} label="Usuários afetados" value={String(t.users)} />
          </div>

          <p className="text-xs text-content-muted">
            {range.from.toLocaleDateString('pt-BR')} a {range.to.toLocaleDateString('pt-BR')} · agrupado por problema, mais graves primeiro
          </p>

          {groups.length === 0 ? (
            <div className="card p-8 text-center text-content-muted text-sm">
              {includeResolved ? 'Nenhum evento registrado neste filtro.' : 'Nada em aberto neste filtro.'}
            </div>
          ) : (
            <ul className="space-y-3">
              {groups.map((g) => (
                <GroupCard
                  key={`${g.code}|${g.pattern ?? ''}|${filters.from}|${filters.to}|${includeResolved}`}
                  group={g}
                  filters={filters}
                  people={people}
                  onResolveGroup={(group, resolve) => setPending({ group, resolve })}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        title={pending?.resolve ? 'Resolver este problema?' : 'Reabrir este problema?'}
        message={
          pending &&
          (pending.resolve
            ? `As ${pending.group.open} ocorrências em aberto no período saem da lista. Se o problema voltar, as novas aparecem normalmente.`
            : 'As ocorrências resolvidas no período voltam para a lista.')
        }
        confirmLabel={pending?.resolve ? 'Resolver' : 'Reabrir'}
        onConfirm={() => void confirmResolve()}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
