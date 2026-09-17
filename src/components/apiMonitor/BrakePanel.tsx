import { useEffect, useState } from 'react'
import { Check, ChevronDown, ShieldCheck, Unplug } from 'lucide-react'
import { PROVIDER_LABEL } from '../../lib/apiUsage'
import type { AppSettings } from '../../lib/types'
import { Gauge, Section, Toggle } from './ui'

/** Campo numerico com botao de salvar: evita gravar a cada tecla. */
function LimitField({
  label,
  help,
  value,
  step,
  suffix,
  onSave,
}: {
  label: string
  help: string
  value: number
  step: string
  suffix: string
  onSave: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const n = Number(draft)
  const dirty = draft !== String(value) && draft.trim() !== '' && Number.isFinite(n) && n > 0

  return (
    <div className="min-w-0">
      <label className="block text-sm font-medium mb-0.5">{label}</label>
      <p className="text-[11px] text-content-muted mb-1.5 leading-snug">{help}</p>
      <div className="flex gap-2 items-center">
        <input type="number" min="0" step={step} className="input h-10 py-0 flex-1 min-w-0" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <span className="text-xs text-content-muted whitespace-nowrap w-16">{suffix}</span>
        <button
          onClick={() => onSave(n)}
          disabled={!dirty}
          className="btn-primary h-10 w-10 rounded-xl p-0 shrink-0 disabled:opacity-40"
          aria-label={`Salvar ${label}`}
        >
          <Check size={16} />
        </button>
      </div>
    </div>
  )
}

/**
 * Freios de gasto, aplicados no SERVIDOR antes de qualquer chamada paga. Desde 17/09/2026 os valores
 * em dolar sao de gasto REAL; antes contavam o custo de tabela do Groq/AssemblyAI gratuitos e o teto
 * mensal de US$ 10 estava a dois dias de bloquear o app inteiro com US$ 2 gastos de verdade.
 *
 * "Chamadas por minuto" virou protecao anti-abuso (avancado): uma nota sao 3 ou 4 chamadas, entao o
 * numero nao dizia nada a quem administra. As unidades de decisao agora sao notas e minutos.
 */
export function BrakePanel({
  settings,
  monthRealUsd,
  fmtMoney,
  onSettings,
  onBreakerReleased,
}: {
  settings: AppSettings
  monthRealUsd: number | null
  fmtMoney: (usd: number) => string
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
  /** Chamado depois de liberar o disjuntor, para fechar o alerta do mesmo codigo. */
  onBreakerReleased?: (code: string) => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const openBreakers = Object.entries(settings.ai_breaker ?? {}).filter(([, b]) => b?.until && Date.parse(b.until) > Date.now())

  async function releaseBreaker(provider: string, code: string) {
    const rest = { ...(settings.ai_breaker ?? {}) }
    delete rest[provider]
    await onSettings({ ai_breaker: rest })
    onBreakerReleased?.(code)
  }

  return (
    <Section
      title="Freios de gasto"
      subtitle="Aplicados no servidor antes de cada chamada paga, inclusive fora do app. Valores em dólar são de gasto real."
      icon={<ShieldCheck size={16} />}
    >
      {openBreakers.map(([provider, b]) => (
        <div key={provider} className="alert-error mb-4 flex flex-wrap items-center gap-3">
          <Unplug size={18} className="shrink-0 text-accent" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">
              {PROVIDER_LABEL[provider] ?? provider} bloqueado até{' '}
              {new Date(b.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-content-secondary">
              Código {b.code}. As chamadas voltam o erro na hora, sem ir ao provedor. Depois do prazo, a próxima chamada testa sozinha.
            </p>
          </div>
          <button onClick={() => void releaseBreaker(provider, b.code)} className="btn-outline h-9 px-3 text-sm shrink-0">
            Já resolvi, liberar agora
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-surface-elevated/60 border border-surface-border">
        <Toggle on={settings.ai_enabled} onChange={() => void onSettings({ ai_enabled: !settings.ai_enabled })} label="Funções de IA ativas" />
        <div className="min-w-0">
          <p className="font-medium text-sm">Funções de IA {settings.ai_enabled ? 'ativas' : 'pausadas'}</p>
          <p className="text-xs text-content-muted">Freio de emergência: desligar bloqueia todas as chamadas pagas na hora.</p>
        </div>
      </div>

      {monthRealUsd !== null && (
        <div className="mb-5">
          <Gauge label="Gasto real deste mês x teto" used={monthRealUsd} limit={settings.ai_monthly_usd_global} format={fmtMoney} />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
        <LimitField
          label="Teto mensal da empresa"
          help="Atingido, a IA para para todos até o próximo mês e você recebe um alerta."
          value={settings.ai_monthly_usd_global}
          step="5"
          suffix="US$/mês"
          onSave={(v) => void onSettings({ ai_monthly_usd_global: v })}
        />
        <LimitField
          label="Limite diário por usuário"
          help="Gasto real de uma pessoa no dia. Atingido, ela só volta a usar amanhã."
          value={settings.ai_daily_usd_per_user}
          step="0.5"
          suffix="US$/dia"
          onSave={(v) => void onSettings({ ai_daily_usd_per_user: v })}
        />
        <LimitField
          label="Notas por hora, por usuário"
          help="Quantas notas uma pessoa pode processar em 1 hora. Barra rajadas e reenvios em série."
          value={settings.ai_notes_per_hour_per_user}
          step="1"
          suffix="notas/h"
          onSave={(v) => void onSettings({ ai_notes_per_hour_per_user: Math.round(v) })}
        />
        <LimitField
          label="Minutos de áudio por dia, por usuário"
          help="Protege o limite gratuito do Groq e o crédito do AssemblyAI. 480 min = 8 h de reunião."
          value={settings.ai_audio_minutes_per_day_per_user}
          step="30"
          suffix="min/dia"
          onSave={(v) => void onSettings({ ai_audio_minutes_per_day_per_user: Math.round(v) })}
        />
        <LimitField
          label="Alerta de gasto do dia"
          help="Se o gasto real de um dia passar disto, o resumo diário gera um alerta."
          value={settings.ai_daily_alert_usd}
          step="1"
          suffix="US$/dia"
          onSave={(v) => void onSettings({ ai_daily_alert_usd: v })}
        />
      </div>

      <button onClick={() => setAdvanced((v) => !v)} className="mt-5 flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-accent">
        <ChevronDown size={14} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} /> Avançado
      </button>
      {advanced && (
        <div className="mt-3 md:w-1/2">
          <LimitField
            label="Proteção anti-abuso"
            help="Máximo de chamadas por minuto de um usuário. Cada nota usa 3 ou 4; só serve para barrar uso automatizado."
            value={settings.ai_rate_per_min}
            step="5"
            suffix="chamadas/min"
            onSave={(v) => void onSettings({ ai_rate_per_min: Math.round(v) })}
          />
        </div>
      )}
    </Section>
  )
}
