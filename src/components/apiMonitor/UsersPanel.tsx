import { useMemo, useState } from 'react'
import { ChevronRight, Users } from 'lucide-react'
import { Avatar, Sheet } from '../ui'
import { PROVIDER_LABEL, compactNum, fmtAudio, taskLabel, type UsageReport } from '../../lib/apiUsage'
import type { Profile } from '../../lib/types'
import { HBar, Section, useProviderColor } from './ui'

interface UserRow {
  userId: string | null
  name: string
  email: string | null
  profile?: Profile
  calls: number
  real: number
  list: number
  audio: number
  notes: number
}

/**
 * TODOS os usuarios, nao so os 10 maiores: quem nao usou nada no periodo tambem aparece (no fim),
 * porque "nao usou" e um dado para decidir licenca e treinamento. Clicar abre o consumo da pessoa
 * por funcao e por provedor.
 */
export function UsersPanel({
  report,
  profiles,
  fmtMoney,
  basis,
}: {
  report: UsageReport
  profiles: Map<string, Profile>
  fmtMoney: (usd: number) => string
  basis: 'real' | 'list'
}) {
  const colorOf = useProviderColor()
  const [open, setOpen] = useState<UserRow | null>(null)
  const [showIdle, setShowIdle] = useState(false)

  const { active, idle } = useMemo(() => {
    const seen = new Set<string>()
    const act: UserRow[] = report.by_user.map((u) => {
      if (u.user_id) seen.add(u.user_id)
      const p = u.user_id ? profiles.get(u.user_id) : undefined
      return {
        userId: u.user_id,
        name: u.name ?? (p ? `${p.first_name} ${p.last_name}` : 'Conta excluída'),
        email: u.email ?? p?.email ?? null,
        profile: p,
        calls: u.calls,
        real: u.cost_real,
        list: u.cost_list,
        audio: u.audio_seconds,
        notes: u.notes,
      }
    })
    act.sort((a, b) => (basis === 'real' ? b.real - a.real || b.list - a.list : b.list - a.list))
    const idl: UserRow[] = [...profiles.values()]
      .filter((p) => !seen.has(p.id))
      .map((p) => ({
        userId: p.id,
        name: `${p.first_name} ${p.last_name}`,
        email: p.email,
        profile: p,
        calls: 0,
        real: 0,
        list: 0,
        audio: 0,
        notes: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { active: act, idle: idl }
  }, [report, profiles, basis])

  const max = Math.max(0, ...active.map((u) => (basis === 'real' ? u.real : u.list)))

  const detail = useMemo(() => {
    if (!open) return []
    const rows = report.by_user_task.filter((r) => r.user_id === open.userId)
    const byTask = new Map<string, { task: string; real: number; list: number; calls: number; rows: typeof rows }>()
    for (const r of rows) {
      const cur = byTask.get(r.task) ?? { task: r.task, real: 0, list: 0, calls: 0, rows: [] }
      cur.real += r.cost_real
      cur.list += r.cost_list
      cur.calls += r.calls
      cur.rows.push(r)
      byTask.set(r.task, cur)
    }
    return [...byTask.values()].sort((a, b) => b.real - a.real || b.list - a.list)
  }, [open, report])

  return (
    <Section
      title="Consumo por usuário"
      subtitle={`${active.length} com uso no período${idle.length ? ` · ${idle.length} sem uso` : ''} · toque para ver o detalhe`}
      icon={<Users size={16} />}
    >
      {active.length === 0 ? (
        <p className="text-sm text-content-muted">Ninguém usou funções pagas neste período.</p>
      ) : (
        <ul className="divide-y divide-surface-border -my-2">
          {active.map((u) => {
            const value = basis === 'real' ? u.real : u.list
            return (
              <li key={u.userId ?? 'excluida'}>
                <button onClick={() => setOpen(u)} className="w-full text-left py-3 flex items-center gap-3 group">
                  {u.profile ? (
                    <Avatar first={u.profile.first_name} last={u.profile.last_name} size={32} url={u.profile.avatar_url} />
                  ) : (
                    <span className="h-8 w-8 rounded-full bg-surface-elevated shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-sm truncate">{u.name}</span>
                      <span className="text-sm tabular-nums shrink-0">{fmtMoney(value)}</span>
                    </span>
                    <span className="block my-1">
                      <HBar value={value} max={max} />
                    </span>
                    <span className="block text-[11px] text-content-muted tabular-nums">
                      <span className="whitespace-nowrap">{u.notes} {u.notes === 1 ? 'nota' : 'notas'}</span>
                      {' · '}
                      <span className="whitespace-nowrap">{fmtAudio(u.audio)} de áudio</span>
                      {' · '}
                      <span className="whitespace-nowrap">{u.calls} chamadas</span>
                      {u.notes > 0 && u.real > 0 && (
                        <>
                          {' · '}
                          <span className="whitespace-nowrap">{fmtMoney(u.real / u.notes)}/nota</span>
                        </>
                      )}
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-content-muted shrink-0 group-hover:text-accent" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {idle.length > 0 && (
        <div className="mt-4 pt-3 border-t border-surface-border">
          <button onClick={() => setShowIdle((v) => !v)} className="text-xs font-medium text-content-secondary hover:text-accent">
            {showIdle ? 'Ocultar' : 'Mostrar'} {idle.length} {idle.length === 1 ? 'usuário' : 'usuários'} sem uso no período
          </button>
          {showIdle && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {idle.map((u) => (
                <li key={u.userId ?? u.name} className="text-xs text-content-muted bg-surface-elevated border border-surface-border rounded-full px-2.5 py-1">
                  {u.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Mini label="Gasto real" value={fmtMoney(open.real)} />
              <Mini label="Custo de tabela" value={fmtMoney(open.list)} />
              <Mini label="Notas" value={String(open.notes)} hint={open.notes && open.real ? `${fmtMoney(open.real / open.notes)} por nota` : undefined} />
              <Mini label="Áudio" value={fmtAudio(open.audio)} hint={`${open.calls} chamadas`} />
            </div>
            {open.email && <p className="text-xs text-content-muted -mt-2">{open.email}</p>}

            <div>
              <h3 className="font-display font-semibold text-sm mb-2">Por função</h3>
              {detail.length === 0 ? (
                <p className="text-sm text-content-muted">Sem uso neste período.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.map((d) => (
                    <li key={d.task} className="card p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-sm">{taskLabel(d.task)}</span>
                        <span className="text-sm tabular-nums">{d.real > 0 ? fmtMoney(d.real) : 'grátis'}</span>
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {d.rows.map((r) => (
                          <li key={r.provider} className="flex items-center gap-2 text-[11px] text-content-muted">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(r.provider) }} aria-hidden />
                            <span className="text-content-secondary">{PROVIDER_LABEL[r.provider] ?? r.provider}</span>
                            <span className="ml-auto tabular-nums whitespace-nowrap">
                              {r.calls} · {r.audio_seconds > 0 ? fmtAudio(r.audio_seconds) : `${compactNum(r.tokens)} tokens`} · tabela {fmtMoney(r.cost_list)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </Section>
  )
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-elevated border border-surface-border p-3 min-w-0">
      <p className="text-[11px] text-content-muted">{label}</p>
      <p className="font-display font-bold tabular-nums truncate">{value}</p>
      {hint && <p className="text-[11px] text-content-muted truncate">{hint}</p>}
    </div>
  )
}
