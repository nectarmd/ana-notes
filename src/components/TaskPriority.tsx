import { Flag } from 'lucide-react'
import type { TaskPriority } from '../lib/types'
import { useT } from '../lib/i18n'

/** Mesmas cores da bandeirinha de prioridade das notas: alta vermelha, normal amarela, baixa azul. */
export const PRIORITY_META: Record<TaskPriority, { key: string; color: string; rank: number }> = {
  high: { key: 'tasks.prioHigh', color: 'text-red-600 dark:text-red-500', rank: 0 },
  normal: { key: 'tasks.prioNormal', color: 'text-yellow-500 dark:text-yellow-400', rank: 1 },
  low: { key: 'tasks.prioLow', color: 'text-blue-500 dark:text-blue-400', rank: 2 },
}

export const PRIORITIES: TaskPriority[] = ['high', 'normal', 'low']

export function TaskFlag({ priority, withLabel = false, size = 14 }: { priority: TaskPriority; withLabel?: boolean; size?: number }) {
  const t = useT()
  const m = PRIORITY_META[priority]
  return (
    <span className={`inline-flex items-center gap-1 ${m.color}`}>
      <Flag size={size} fill="currentColor" strokeWidth={1.5} aria-hidden />
      {withLabel ? <span className="text-xs font-semibold">{t(m.key)}</span> : <span className="sr-only">{t(m.key)}</span>}
    </span>
  )
}

/** Tres botoes de bandeira para escolher a urgencia (formulario de criar/editar). */
export function PriorityPicker({ value, onChange }: { value: TaskPriority; onChange: (p: TaskPriority) => void }) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t('tasks.priority')} className="grid grid-cols-3 gap-2">
      {PRIORITIES.map((p) => {
        const active = value === p
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p)}
            className={`h-10 rounded-xl border flex items-center justify-center gap-1.5 text-sm font-medium transition-colors ${
              active ? 'border-brand-solid bg-accent/10 text-content-primary' : 'border-surface-border bg-surface-elevated text-content-secondary'
            }`}
          >
            <TaskFlag priority={p} />
            {t(PRIORITY_META[p].key)}
          </button>
        )
      })}
    </div>
  )
}
