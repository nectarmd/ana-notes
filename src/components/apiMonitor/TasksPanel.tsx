import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { PROVIDER_LABEL, compactNum, fmtAudio, taskLabel, type UsageReport } from '../../lib/apiUsage'
import { HBar, Section, useProviderColor } from './ui'

/**
 * Gasto por funcao, com o detalhe de QUAL provedor atendeu cada uma. Antes "transcription" era uma
 * linha so somando Groq, AssemblyAI e AssemblyAI com diarizacao -- sem dizer qual custava o que.
 */
export function TasksPanel({
  report,
  fmtMoney,
  basis,
}: {
  report: UsageReport
  fmtMoney: (usd: number) => string
  /** Qual custo ordena e dimensiona as barras. */
  basis: 'real' | 'list'
}) {
  const colorOf = useProviderColor()

  const tasks = useMemo(() => {
    const map = new Map<
      string,
      { task: string; calls: number; real: number; list: number; audio: number; tokens: number; rows: UsageReport['by_task'] }
    >()
    for (const r of report.by_task) {
      const cur = map.get(r.task) ?? { task: r.task, calls: 0, real: 0, list: 0, audio: 0, tokens: 0, rows: [] }
      cur.calls += r.calls
      cur.real += r.cost_real
      cur.list += r.cost_list
      cur.audio += r.audio_seconds
      cur.tokens += r.input_tokens + r.output_tokens
      cur.rows.push(r)
      map.set(r.task, cur)
    }
    const list = [...map.values()]
    list.sort((a, b) => (basis === 'real' ? b.real - a.real || b.list - a.list : b.list - a.list))
    return list
  }, [report, basis])

  const max = Math.max(0, ...tasks.map((t) => (basis === 'real' ? t.real : t.list)))
  const totalReal = tasks.reduce((a, t) => a + t.real, 0)

  return (
    <Section
      title="Por função"
      subtitle={basis === 'real' ? 'Ordenado pelo gasto real' : 'Ordenado pelo custo de tabela'}
      icon={<Layers size={16} />}
    >
      {tasks.length === 0 ? (
        <p className="text-sm text-content-muted">Sem uso neste período.</p>
      ) : (
        <ul className="space-y-4">
          {tasks.map((t) => {
            const value = basis === 'real' ? t.real : t.list
            const share = totalReal > 0 ? Math.round((t.real / totalReal) * 100) : 0
            return (
              <li key={t.task}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-medium text-sm truncate">{taskLabel(t.task)}</span>
                  <span className="text-sm tabular-nums shrink-0">
                    {fmtMoney(value)}
                    {basis === 'real' && share > 0 && <span className="text-content-muted text-xs"> · {share}%</span>}
                  </span>
                </div>
                <HBar value={value} max={max} />
                <ul className="mt-2 space-y-1">
                  {t.rows
                    .slice()
                    .sort((a, b) => b.calls - a.calls)
                    .map((r) => (
                      <li key={`${r.provider}-${r.model}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-content-muted">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(r.provider) }} aria-hidden />
                        <span className="text-content-secondary">
                          {PROVIDER_LABEL[r.provider] ?? r.provider}
                          <span className="text-content-muted"> · {r.model.replace('claude-', '').replace('-20251001', '')}</span>
                        </span>
                        <span className="ml-auto tabular-nums whitespace-nowrap">
                          {r.calls} {r.calls === 1 ? 'chamada' : 'chamadas'}
                          {r.audio_seconds > 0 ? ` · ${fmtAudio(r.audio_seconds)}` : ''}
                          {r.input_tokens + r.output_tokens > 0 ? ` · ${compactNum(r.input_tokens + r.output_tokens)} tokens` : ''}
                          {' · '}
                          {r.cost_real > 0 ? fmtMoney(r.cost_real) : `grátis (tabela ${fmtMoney(r.cost_list)})`}
                        </span>
                      </li>
                    ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
