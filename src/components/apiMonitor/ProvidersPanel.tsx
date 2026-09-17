import { useEffect, useState } from 'react'
import { Check, ExternalLink, Server } from 'lucide-react'
import { ConfirmDialog } from '../ui'
import {
  PROVIDER_LABEL,
  PROVIDERS,
  compactNum,
  fmtAudio,
  setProviderBilling,
  type Provider,
  type UsageReport,
} from '../../lib/apiUsage'
import type { AppSettings } from '../../lib/types'
import { Gauge, Section, useProviderColor } from './ui'

const CONSOLE: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  groq: 'https://console.groq.com/settings/billing',
  assemblyai: 'https://www.assemblyai.com/app/account',
  openai: 'https://platform.openai.com/settings/organization/billing',
}

/**
 * Um cartao por provedor: modo de cobranca (pago x gratuito), gasto real x de tabela e os LIMITES
 * que dizem quando sera preciso pagar -- tier gratuito do Groq, credito do AssemblyAI, saldo pre-pago
 * da Anthropic. Os provedores nao expoem saldo por API; o que da para medir, medimos aqui.
 */
export function ProvidersPanel({
  report,
  settings,
  fmtMoney,
  onSettings,
  onBillingChanged,
}: {
  report: UsageReport
  settings: AppSettings
  fmtMoney: (usd: number) => string
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
  onBillingChanged: () => void
}) {
  const colorOf = useProviderColor()
  const [pending, setPending] = useState<{ provider: Provider; mode: 'paid' | 'free' } | null>(null)
  const [since, setSince] = useState('')
  const [saving, setSaving] = useState(false)

  const used = new Set(report.by_provider.map((p) => p.provider))
  const list = PROVIDERS.filter((p) => used.has(p) || p !== 'openai')

  async function confirmBilling() {
    if (!pending) return
    setSaving(true)
    try {
      await setProviderBilling(pending.provider, pending.mode, since || null)
      setPending(null)
      setSince('')
      onBillingChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Provedores" subtitle="Cobrança, limites do plano e quando vai ser preciso pagar" icon={<Server size={16} />}>
      <div className="grid md:grid-cols-2 gap-3">
        {list.map((p) => {
          const row = report.by_provider.find((r) => r.provider === p)
          const mode = settings.provider_billing?.[p] ?? 'paid'
          const lim = settings.provider_limits ?? {}
          return (
            <div key={p} className="rounded-xl border border-surface-border bg-surface-elevated/40 p-4 min-w-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ background: colorOf(p) }} aria-hidden />
                <span className="font-display font-semibold flex-1 truncate">{PROVIDER_LABEL[p]}</span>
                <button
                  onClick={() => setPending({ provider: p, mode: mode === 'paid' ? 'free' : 'paid' })}
                  className={`text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                    mode === 'paid'
                      ? 'border-accent/40 text-accent bg-accent/10'
                      : 'border-surface-border text-content-secondary bg-surface-card'
                  }`}
                  title="Trocar modo de cobrança"
                >
                  {mode === 'paid' ? 'Pago' : 'Gratuito'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                <div>
                  <p className="text-[11px] text-content-muted">Gasto real</p>
                  <p className="font-semibold tabular-nums">{fmtMoney(row?.cost_real ?? 0)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-content-muted">Custo de tabela</p>
                  <p className="font-semibold tabular-nums">{fmtMoney(row?.cost_list ?? 0)}</p>
                </div>
              </div>
              <p className="text-[11px] text-content-muted mb-3">
                {row ? `${row.calls} chamadas` : 'Sem uso no período'}
                {row && row.audio_seconds > 0 ? ` · ${fmtAudio(row.audio_seconds)} de áudio` : ''}
                {row && row.tokens > 0 ? ` · ${compactNum(row.tokens)} tokens` : ''}
              </p>

              <div className="space-y-3">
                {p === 'groq' && mode === 'free' && lim.groq && (
                  <>
                    <Gauge
                      label="Áudio na última hora"
                      used={report.lifetime.groq_audio_seconds_last_hour}
                      limit={lim.groq.audio_seconds_hour ?? 0}
                      format={fmtAudio}
                    />
                    <Gauge label="Áudio hoje" used={report.lifetime.groq_audio_seconds_today} limit={lim.groq.audio_seconds_day ?? 0} format={fmtAudio} />
                    <Gauge
                      label="Pico de 1 hora (30 dias)"
                      used={report.lifetime.groq_peak_hour_seconds_30d}
                      limit={lim.groq.audio_seconds_hour ?? 0}
                      format={fmtAudio}
                      note="acima de 85% o áudio vai para o AssemblyAI"
                    />
                    <Gauge label="Pico de 1 dia (30 dias)" used={report.lifetime.groq_peak_day_seconds_30d} limit={lim.groq.audio_seconds_day ?? 0} format={fmtAudio} />
                    <Gauge label="Requisições hoje" used={report.lifetime.groq_requests_today} limit={lim.groq.requests_day ?? 0} format={(n) => String(Math.round(n))} />
                  </>
                )}

                {p === 'assemblyai' && mode === 'free' && (
                  <CreditEditor
                    label="Crédito gratuito"
                    used={report.lifetime.assemblyai_cost_list}
                    amount={lim.assemblyai?.credit_usd ?? 50}
                    fmtMoney={fmtMoney}
                    onSave={(v) =>
                      onSettings({ provider_limits: { ...lim, assemblyai: { ...lim.assemblyai, credit_usd: v } } })
                    }
                  />
                )}

                {p === 'anthropic' && (
                  <BalanceEditor
                    balance={lim.anthropic?.balance_usd ?? null}
                    setAt={lim.anthropic?.balance_set_at ?? null}
                    usedSince={report.lifetime.anthropic_real_since_balance}
                    fmtMoney={fmtMoney}
                    onSave={(balance, setAt) =>
                      onSettings({ provider_limits: { ...lim, anthropic: { ...lim.anthropic, balance_usd: balance, balance_set_at: setAt } } })
                    }
                  />
                )}
              </div>

              <a href={CONSOLE[p]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-accent mt-3">
                Abrir console do {PROVIDER_LABEL[p]} <ExternalLink size={12} />
              </a>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending ? `Marcar ${PROVIDER_LABEL[pending.provider]} como ${pending.mode === 'paid' ? 'PAGO' : 'GRATUITO'}?` : ''}
        message={
          <div className="space-y-3 text-left">
            <p>
              {pending?.mode === 'paid'
                ? 'O custo deste provedor passa a contar como gasto real — inclusive para os freios de gasto.'
                : 'O custo deste provedor deixa de contar como gasto real e para de pesar nos freios de gasto.'}
            </p>
            <div>
              <label className="label">Corrigir o histórico desde (opcional)</label>
              <input type="date" className="input w-full min-w-0 px-2" value={since} onChange={(e) => setSince(e.target.value)} />
              <p className="text-xs text-content-muted mt-1">Em branco: vale só daqui para frente.</p>
            </div>
          </div>
        }
        confirmLabel={saving ? 'Salvando...' : 'Confirmar'}
        cancelLabel="Cancelar"
        onConfirm={confirmBilling}
        onClose={() => {
          setPending(null)
          setSince('')
        }}
      />
    </Section>
  )
}

function CreditEditor({
  label,
  used,
  amount,
  fmtMoney,
  onSave,
}: {
  label: string
  used: number
  amount: number
  fmtMoney: (usd: number) => string
  onSave: (v: number) => Promise<void>
}) {
  const [draft, setDraft] = useState(String(amount))
  useEffect(() => setDraft(String(amount)), [amount])
  const dirty = draft !== String(amount) && Number(draft) > 0
  return (
    <div>
      <Gauge label={label} used={used} limit={amount} format={fmtMoney} note={`restam ~${fmtMoney(Math.max(0, amount - used))}`} />
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[11px] text-content-muted whitespace-nowrap">Crédito total (US$)</span>
        <input type="number" min="0" step="1" className="input h-8 py-0 px-2 text-sm flex-1 min-w-0" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button onClick={() => onSave(Number(draft))} disabled={!dirty} className="btn-primary h-8 w-8 p-0 rounded-lg disabled:opacity-40" aria-label="Salvar crédito">
          <Check size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Saldo pre-pago da Anthropic. A API nao informa o saldo: o admin diz quanto carregou e quando, e
 * daqui em diante descontamos o gasto real medido. Foi a falta disto que deixou os creditos
 * acabarem sem aviso em 26/08 e 16/09/2026 -- o cron diario alerta abaixo de 20%.
 */
function BalanceEditor({
  balance,
  setAt,
  usedSince,
  fmtMoney,
  onSave,
}: {
  balance: number | null
  setAt: string | null
  usedSince: number
  fmtMoney: (usd: number) => string
  onSave: (balance: number | null, setAt: string | null) => Promise<void>
}) {
  const [amount, setAmount] = useState(balance ? String(balance) : '')
  const [date, setDate] = useState(setAt ? setAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
  useEffect(() => {
    setAmount(balance ? String(balance) : '')
    setDate(setAt ? setAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
  }, [balance, setAt])
  const dirty = Number(amount) > 0 && (Number(amount) !== balance || date !== (setAt ?? '').slice(0, 10))

  return (
    <div>
      {balance && setAt ? (
        <Gauge
          label="Saldo carregado usado"
          used={usedSince}
          limit={balance}
          format={fmtMoney}
          note={`restam ~${fmtMoney(Math.max(0, balance - usedSince))} desde ${setAt.slice(8, 10)}/${setAt.slice(5, 7)}`}
        />
      ) : (
        <p className="text-xs text-content-muted">
          Informe quanto você carregou de crédito para ser avisado <strong className="text-content-secondary">antes</strong> de acabar.
        </p>
      )}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 mt-2 items-center">
        <input
          type="number"
          min="0"
          step="1"
          placeholder="Valor (US$)"
          className="input h-8 py-0 px-2 text-sm min-w-0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input type="date" className="input h-8 py-0 px-2 text-sm w-[132px]" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          onClick={() => onSave(Number(amount), new Date(`${date}T00:00:00`).toISOString())}
          disabled={!dirty}
          className="btn-primary h-8 w-8 p-0 rounded-lg disabled:opacity-40"
          aria-label="Salvar saldo"
        >
          <Check size={14} />
        </button>
      </div>
    </div>
  )
}
