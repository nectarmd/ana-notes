import { BellRing, Check } from 'lucide-react'
import type { AdminAlert } from '../../lib/types'
import { StatusTag, type Status } from './ui'

const SEVERITY_STATUS: Record<AdminAlert['severity'], Status> = {
  critical: 'critical',
  error: 'serious',
  warning: 'warning',
}
const SEVERITY_LABEL: Record<AdminAlert['severity'], string> = {
  critical: 'Crítico',
  error: 'Erro',
  warning: 'Atenção',
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * Problemas que SO o administrador resolve, agregados por codigo: em vez de 66 linhas de "credit
 * balance" no log, um alerta com "33 ocorrencias, 6 usuarios, desde 18:01". Some da lista sozinho
 * quando o provedor volta a responder (o disjuntor fecha e resolve o alerta).
 */
export function AlertsPanel({ alerts, onResolve }: { alerts: AdminAlert[]; onResolve: (id: string) => void }) {
  if (alerts.length === 0) return null
  return (
    <section className="card p-4 sm:p-5 border-accent/40">
      <h2 className="font-display font-semibold flex items-center gap-2 mb-1">
        <BellRing size={16} className="text-accent" /> Precisa da sua atenção
      </h2>
      <p className="text-xs text-content-muted mb-3">Problemas que só você resolve. Os usuários recebem uma mensagem simples e ficam sem insistir.</p>
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li key={a.id} className="rounded-xl border border-surface-border bg-surface-elevated/40 p-3 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                <StatusTag status={SEVERITY_STATUS[a.severity]} label={SEVERITY_LABEL[a.severity]} />
                <code className="text-[11px] text-content-muted">{a.code}</code>
              </div>
              <p className="text-sm leading-snug">{a.title}</p>
              <p className="text-[11px] text-content-muted mt-1 tabular-nums">
                {a.occurrences} {a.occurrences === 1 ? 'ocorrência' : 'ocorrências'}
                {a.affected_users.length > 0 && ` · ${a.affected_users.length} ${a.affected_users.length === 1 ? 'usuário afetado' : 'usuários afetados'}`}
                {' · '}desde {fmtWhen(a.first_seen_at)}
                {a.occurrences > 1 && ` · última ${fmtWhen(a.last_seen_at)}`}
              </p>
            </div>
            <button onClick={() => onResolve(a.id)} className="btn-outline h-8 px-3 text-xs shrink-0">
              <Check size={14} /> Resolvido
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
