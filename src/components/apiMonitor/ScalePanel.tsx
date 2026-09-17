import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { fmtAudio, periodDays, projectMonth, type Period, type UsageReport } from '../../lib/apiUsage'
import type { AppSettings } from '../../lib/types'
import { Section, StatusTag, statusOf } from './ui'

/**
 * "Quanto vou gastar com N usuarios, e quando os planos gratuitos deixam de dar conta?"
 *
 * Projecao LINEAR a partir do uso medio de quem usou no periodo. E o numero que falta para decidir
 * a escala: com 10 usuarios o Groq ja passou do limite gratuito em horario de pico (112% numa hora
 * em 27/08/2026), entao com 25 isso deixa de ser excecao.
 */
export function ScalePanel({
  report,
  period,
  settings,
  fmtMoney,
}: {
  report: UsageReport
  period: Period
  settings: AppSettings
  fmtMoney: (usd: number) => string
}) {
  const [target, setTarget] = useState(25)
  const active = report.totals.users
  if (active === 0) return null

  const factor = target / active
  const days = periodDays(period)
  const prov = (p: string) => report.by_provider.find((r) => r.provider === p)

  const realMonth = projectMonth(report.totals.cost_real, period) * factor
  const listMonth = projectMonth(report.totals.cost_list, period) * factor

  const lim = settings.provider_limits ?? {}
  const groqFree = settings.provider_billing?.groq === 'free'
  const asd = lim.groq?.audio_seconds_day ?? 0
  const ash = lim.groq?.audio_seconds_hour ?? 0
  const groqDayAvg = ((prov('groq')?.audio_seconds ?? 0) / days) * factor
  const groqPeakDay = report.lifetime.groq_peak_day_seconds_30d * factor
  const groqPeakHour = report.lifetime.groq_peak_hour_seconds_30d * factor

  const aCredit = lim.assemblyai?.credit_usd ?? 0
  const aLeft = Math.max(0, aCredit - report.lifetime.assemblyai_cost_list)
  const aBurnDay = ((prov('assemblyai')?.cost_list ?? 0) / days) * factor
  const aDaysLeft = aBurnDay > 0 ? aLeft / aBurnDay : null

  const bal = lim.anthropic?.balance_usd ?? 0
  const balLeft = Math.max(0, bal - report.lifetime.anthropic_real_since_balance)
  const anBurnDay = ((prov('anthropic')?.cost_real ?? 0) / days) * factor
  const anDaysLeft = bal > 0 && anBurnDay > 0 ? balLeft / anBurnDay : null

  const daysText = (d: number | null) => (d === null ? '—' : d > 365 ? 'mais de 1 ano' : `${Math.floor(d)} dias`)

  return (
    <Section
      title="Simulador de escala"
      subtitle={`Projeção linear a partir de ${active} ${active === 1 ? 'usuário ativo' : 'usuários ativos'} no período. Cada pessoa usa de um jeito: trate como ordem de grandeza.`}
      icon={<TrendingUp size={16} />}
    >
      <div className="flex items-center gap-3 mb-4">
        <label htmlFor="scale-users" className="text-sm font-medium">
          Usuários ativos
        </label>
        <input
          id="scale-users"
          type="number"
          min="1"
          max="10000"
          className="input h-10 py-0 w-24"
          value={target}
          onChange={(e) => setTarget(Math.max(1, Math.round(Number(e.target.value) || 1)))}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-surface-elevated/60 border border-surface-border p-3">
          <p className="text-[11px] text-content-muted">Gasto real por mês</p>
          <p className="font-display text-xl font-bold tabular-nums">{fmtMoney(realMonth)}</p>
          <p className="text-[11px] text-content-muted">{fmtMoney(realMonth / target)} por usuário</p>
        </div>
        <div className="rounded-xl bg-surface-elevated/60 border border-surface-border p-3">
          <p className="text-[11px] text-content-muted">Se todos os provedores cobrarem</p>
          <p className="font-display text-xl font-bold tabular-nums">{fmtMoney(listMonth)}</p>
          <p className="text-[11px] text-content-muted">quando sair dos planos gratuitos</p>
        </div>
      </div>

      <ul className="space-y-2.5 text-sm">
        {groqFree && asd > 0 && (
          <>
            <Row
              label="Groq — áudio num dia médio"
              value={`${fmtAudio(groqDayAvg)} de ${fmtAudio(asd)}`}
              pct={(groqDayAvg / asd) * 100}
            />
            <Row
              label="Groq — dia de pico"
              value={`${fmtAudio(groqPeakDay)} de ${fmtAudio(asd)}`}
              pct={(groqPeakDay / asd) * 100}
            />
            {ash > 0 && (
              <Row
                label="Groq — hora de pico"
                value={`${fmtAudio(groqPeakHour)} de ${fmtAudio(ash)}`}
                pct={(groqPeakHour / ash) * 100}
              />
            )}
          </>
        )}
        {settings.provider_billing?.assemblyai === 'free' && aCredit > 0 && (
          <li className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-content-secondary">AssemblyAI — crédito acaba em</span>
            <span className="font-medium tabular-nums">{daysText(aDaysLeft)}</span>
          </li>
        )}
        {bal > 0 && (
          <li className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-content-secondary">Anthropic — saldo carregado acaba em</span>
            <span className="font-medium tabular-nums">{daysText(anDaysLeft)}</span>
          </li>
        )}
      </ul>
      {groqFree && (
        <p className="text-[11px] text-content-muted mt-3">
          Quando o Groq chega perto do limite gratuito, o app manda o áudio para o AssemblyAI sozinho — ninguém fica sem transcrição, mas o crédito dele passa a ser consumido.
        </p>
      )}
    </Section>
  )
}

function Row({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-content-secondary">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{value}</span>
        <StatusTag status={statusOf(pct)} label={`${Math.round(pct)}%`} />
      </span>
    </li>
  )
}
