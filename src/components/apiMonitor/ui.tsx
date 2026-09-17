// Pecas visuais do painel de custos (/admin/api). Regras seguidas (skill de dataviz):
//  - cor de provedor segue a ENTIDADE em ordem fixa, nunca a posicao no ranking;
//  - texto sempre em tokens de texto, nunca na cor da serie; a cor fica no marcador ao lado;
//  - toda barra tem o valor escrito ao lado (na paleta clara, AssemblyAI/OpenAI ficam abaixo de 3:1
//    de contraste -- o numero em texto e o que garante a leitura);
//  - cor de STATUS (ok/atencao/perto/acima) e reservada aos medidores e sempre vem com icone +
//    rotulo, nunca so a cor.

import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useTheme } from '../../theme/ThemeProvider'
import { PROVIDER_COLOR } from '../../lib/apiUsage'

export function useProviderColor() {
  const { theme } = useTheme()
  return (provider: string) => PROVIDER_COLOR[provider]?.[theme === 'dark' ? 'dark' : 'light'] ?? '#898781'
}

/** Grupo de opcoes em pilula (filtros). No celular quebra linha: rolar na horizontal escondia opcoes. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { key: T; label: string; dot?: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1 p-1 rounded-xl bg-surface-elevated border border-surface-border max-w-full">
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap px-3 h-8 rounded-lg text-sm font-medium transition-colors ${
              active ? 'bg-surface-card text-content-primary shadow-card' : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            {o.dot && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: o.dot }} aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Kpi({
  label,
  value,
  hint,
  icon,
  emphasis,
}: {
  label: string
  value: string
  hint?: React.ReactNode
  icon?: React.ReactNode
  emphasis?: boolean
}) {
  return (
    <div className={`card p-4 min-w-0 ${emphasis ? 'border-accent/40' : ''}`}>
      <div className="flex items-center gap-1.5 text-content-muted mb-1.5">
        {icon && <span className="text-accent shrink-0">{icon}</span>}
        <span className="text-xs font-medium truncate">{label}</span>
      </div>
      <p className="font-display text-xl sm:text-2xl font-bold tabular-nums truncate">{value}</p>
      {hint && <p className="text-[11px] text-content-muted mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

export function Section({
  title,
  subtitle,
  icon,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`card p-4 sm:p-5 min-w-0 ${className}`}>
      <header className="flex items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold flex items-center gap-2">
            {icon && <span className="text-accent shrink-0">{icon}</span>}
            {title}
          </h2>
          {subtitle && <p className="text-xs text-content-muted mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

/**
 * Barra horizontal proporcional ao maior valor da lista (ponta arredondada presa a base).
 * Sem `color`, usa tinta neutra: barra de UMA serie nao usa vermelho, que e cor de status critico.
 */
export function HBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 && value > 0 ? Math.max(1.5, (value / max) * 100) : 0
  return (
    <div className="h-2 rounded-full bg-surface-elevated overflow-hidden" aria-hidden>
      <div
        className={`h-full rounded-r-[4px] ${color ? '' : 'bg-content-secondary/70'}`}
        style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }}
      />
    </div>
  )
}

// ------------------------------------------------------------------------------ status

export type Status = 'good' | 'warning' | 'serious' | 'critical'

/** Paleta de status validada (skill de dataviz): reservada aos medidores. */
const STATUS: Record<Status, { color: string; label: string; icon: React.ReactNode }> = {
  good: { color: '#0ca30c', label: 'Folgado', icon: <CheckCircle2 size={14} /> },
  warning: { color: '#fab219', label: 'Atenção', icon: <Info size={14} /> },
  serious: { color: '#ec835a', label: 'Perto do limite', icon: <AlertTriangle size={14} /> },
  critical: { color: '#d03b3b', label: 'No limite', icon: <AlertOctagon size={14} /> },
}

export function statusOf(pct: number): Status {
  if (pct >= 100) return 'critical'
  if (pct >= 85) return 'serious'
  if (pct >= 60) return 'warning'
  return 'good'
}

export function StatusTag({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status]
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary whitespace-nowrap">
      <span style={{ color: s.color }} className="shrink-0">
        {s.icon}
      </span>
      {label ?? s.label}
    </span>
  )
}

/** Medidor de uso contra um limite (tier gratuito, credito, saldo, teto do freio). */
export function Gauge({
  label,
  used,
  limit,
  format,
  note,
}: {
  label: string
  used: number
  limit: number
  format: (n: number) => string
  note?: string
}) {
  const pct = limit > 0 ? (used / limit) * 100 : 0
  const status = statusOf(pct)
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm text-content-secondary truncate">{label}</span>
        <StatusTag status={status} />
      </div>
      <div className="h-2 rounded-full bg-surface-elevated overflow-hidden" aria-hidden>
        <div
          className="h-full rounded-r-[4px]"
          style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct))}%`, background: STATUS[status].color }}
        />
      </div>
      <p className="text-[11px] text-content-muted mt-1 tabular-nums">
        {format(used)} de {format(limit)} ({Math.round(pct)}%){note ? ` · ${note}` : ''}
      </p>
    </div>
  )
}

/** Interruptor acessivel (mesmo visual do resto do app). */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`h-6 w-11 rounded-full transition-colors relative shrink-0 ${on ? 'bg-brand-solid' : 'bg-surface-border'}`}
    >
      <span
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}
