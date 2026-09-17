import { useMemo, useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { PROVIDER_LABEL, PROVIDERS, fmtAudio, type Period, type UsageReport } from '../../lib/apiUsage'
import { Section, Segmented, useProviderColor } from './ui'

type Metric = 'real' | 'list' | 'audio'

function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Colunas empilhadas por dia, uma cor por provedor (ordem fixa). Um eixo so: a metrica e escolhida
 * no seletor (custo real, custo de tabela ou audio), nunca duas escalas no mesmo grafico.
 */
export function DailyChart({
  report,
  period,
  fmtMoney,
}: {
  report: UsageReport
  period: Period
  fmtMoney: (usd: number) => string
}) {
  const colorOf = useProviderColor()
  const [metric, setMetric] = useState<Metric>('real')
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const { days, providers, max } = useMemo(() => {
    // Todos os dias da janela, inclusive os sem uso: um dia vazio e informacao, nao ruido.
    const list: string[] = []
    const cursor = new Date(period.from)
    cursor.setHours(0, 0, 0, 0)
    const end = new Date(period.to)
    let guard = 0
    while (cursor <= end && guard++ < 400) {
      list.push(dayKey(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    const value = (r: UsageReport['by_day'][number]) =>
      metric === 'real' ? r.cost_real : metric === 'list' ? r.cost_list : r.audio_seconds
    const byDay = new Map<string, Record<string, number>>()
    for (const r of report.by_day) {
      const cur = byDay.get(r.day) ?? {}
      cur[r.provider] = (cur[r.provider] ?? 0) + value(r)
      byDay.set(r.day, cur)
    }
    const present = PROVIDERS.filter((p) => report.by_day.some((r) => r.provider === p && value(r) > 0))
    const rows = list.map((day) => {
      const vals = byDay.get(day) ?? {}
      const total = present.reduce((acc, p) => acc + (vals[p] ?? 0), 0)
      return { day, vals, total }
    })
    return { days: rows, providers: present, max: Math.max(0, ...rows.map((r) => r.total)) }
  }, [report, period, metric])

  const fmt = (n: number) => (metric === 'audio' ? fmtAudio(n) : fmtMoney(n))
  const labelEvery = days.length > 45 ? 10 : days.length > 20 ? 5 : days.length > 10 ? 2 : 1
  const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

  if (days.length < 2) return null

  return (
    <Section
      title="Evolução por dia"
      subtitle={metric === 'real' ? 'Gasto que sai do caixa' : metric === 'list' ? 'Quanto custaria se todos os provedores cobrassem' : 'Minutos de áudio transcritos'}
      icon={<BarChart3 size={16} />}
      action={
        <button
          onClick={() => setAsTable((v) => !v)}
          className="btn-ghost h-8 px-2.5 text-xs shrink-0"
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 size={14} /> : <Table2 size={14} />}
          {asTable ? 'Gráfico' : 'Tabela'}
        </button>
      }
    >
      <div className="mb-4">
        <Segmented
          ariaLabel="Métrica do gráfico"
          value={metric}
          onChange={setMetric}
          options={[
            { key: 'real', label: 'Custo real' },
            { key: 'list', label: 'Custo de tabela' },
            { key: 'audio', label: 'Áudio' },
          ]}
        />
      </div>

      {providers.length === 0 ? (
        <p className="text-sm text-content-muted py-6 text-center">
          {metric === 'real' ? 'Nenhum gasto real neste período (só provedores em plano gratuito).' : 'Sem dados neste período.'}
        </p>
      ) : asTable ? (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-content-muted">
                <th className="font-medium py-1.5 px-1">Dia</th>
                {providers.map((p) => (
                  <th key={p} className="font-medium py-1.5 px-1 text-right whitespace-nowrap">{PROVIDER_LABEL[p]}</th>
                ))}
                <th className="font-medium py-1.5 px-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {days
                .filter((d) => d.total > 0)
                .reverse()
                .map((d) => (
                  <tr key={d.day} className="border-t border-surface-border">
                    <td className="py-1.5 px-1 whitespace-nowrap">{shortDay(d.day)}</td>
                    {providers.map((p) => (
                      <td key={p} className="py-1.5 px-1 text-right text-content-secondary">{d.vals[p] ? fmt(d.vals[p]) : '—'}</td>
                    ))}
                    <td className="py-1.5 px-1 text-right font-medium">{fmt(d.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="relative">
            {/* Eixo recessivo: so o topo e a metade, em tinta apagada. */}
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-surface-border" aria-hidden />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-surface-border" aria-hidden />
            <span className="absolute -top-2 left-0 text-[10px] text-content-muted bg-surface-card pr-1">{fmt(max)}</span>

            <div className="flex items-end gap-[3px] h-44 pt-3" onMouseLeave={() => setHover(null)}>
              {days.map((d, i) => (
                <button
                  key={d.day}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onClick={() => setHover((h) => (h === i ? null : i))}
                  aria-label={`${shortDay(d.day)}: ${fmt(d.total)}`}
                  className="relative flex-1 min-w-0 h-full flex flex-col justify-end group"
                >
                  {/* Area de toque maior que a marca: a coluna inteira responde. */}
                  <div
                    className={`w-full flex flex-col-reverse gap-[2px] transition-opacity ${hover !== null && hover !== i ? 'opacity-50' : ''}`}
                    style={{ height: max > 0 ? `${(d.total / max) * 100}%` : '0%' }}
                  >
                    {providers.map((p, idx) => {
                      const v = d.vals[p] ?? 0
                      if (v <= 0) return null
                      const isTop = providers.slice(idx + 1).every((q) => !(d.vals[q] > 0))
                      return (
                        <div
                          key={p}
                          className={isTop ? 'rounded-t-[4px]' : ''}
                          style={{ flexGrow: v, flexBasis: 0, minHeight: 2, background: colorOf(p) }}
                        />
                      )
                    })}
                  </div>
                  {d.total === 0 && <div className="w-full h-[2px] bg-surface-border" aria-hidden />}
                </button>
              ))}
            </div>

            {hover !== null && days[hover] && (
              <div
                className="absolute z-10 -top-2 pointer-events-none card px-3 py-2 text-xs shadow-float min-w-[150px]"
                style={{
                  left: `clamp(0px, calc(${((hover + 0.5) / days.length) * 100}% - 75px), calc(100% - 150px))`,
                }}
              >
                <p className="font-semibold mb-1">{shortDay(days[hover].day)}</p>
                {providers.map((p) => (
                  <p key={p} className="flex items-center gap-1.5 text-content-secondary tabular-nums">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(p) }} aria-hidden />
                    <span className="flex-1">{PROVIDER_LABEL[p]}</span>
                    <span>{days[hover].vals[p] ? fmt(days[hover].vals[p]) : '—'}</span>
                  </p>
                ))}
                <p className="flex justify-between border-t border-surface-border mt-1 pt-1 font-medium tabular-nums">
                  <span>Total</span>
                  <span>{fmt(days[hover].total)}</span>
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-[3px] mt-1.5" aria-hidden>
            {days.map((d, i) => (
              <span key={d.day} className="flex-1 min-w-0 text-center text-[10px] text-content-muted overflow-visible whitespace-nowrap">
                {i % labelEvery === 0 || i === days.length - 1 ? d.day.slice(8, 10) : ''}
              </span>
            ))}
          </div>

          {/* Legenda sempre presente (identidade nunca so pela cor). */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {providers.map((p) => (
              <span key={p} className="flex items-center gap-1.5 text-xs text-content-secondary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(p) }} aria-hidden />
                {PROVIDER_LABEL[p]}
              </span>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}
