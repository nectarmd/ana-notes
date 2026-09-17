import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, AudioLines, Coins, FileText, PiggyBank, RefreshCw, Users, Wallet } from 'lucide-react'
import { db } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import {
  PROVIDER_LABEL,
  PROVIDERS,
  cacheSavingsUsd,
  compactNum,
  fmtAudio,
  getUsageReport,
  listAdminAlerts,
  periodRange,
  projectMonth,
  resolveAdminAlert,
  type PeriodKey,
  type Provider,
  type UsageReport,
} from '../lib/apiUsage'
import { getUsdBrl, money, saveCurrency, savedCurrency, type Currency, type Rate } from '../lib/currency'
import { getAppSettings, updateAppSettings } from '../lib/appSettings'
import type { AdminAlert, AppSettings, Profile } from '../lib/types'
import { Kpi, Segmented, useProviderColor } from '../components/apiMonitor/ui'
import { AlertsPanel } from '../components/apiMonitor/AlertsPanel'
import { BrakePanel } from '../components/apiMonitor/BrakePanel'
import { DailyChart } from '../components/apiMonitor/DailyChart'
import { ProvidersPanel } from '../components/apiMonitor/ProvidersPanel'
import { ScalePanel } from '../components/apiMonitor/ScalePanel'
import { TasksPanel } from '../components/apiMonitor/TasksPanel'
import { UsersPanel } from '../components/apiMonitor/UsersPanel'
import { logSilentError } from '../lib/auditLog'

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'lastMonth', label: 'Mês passado' },
  { key: 'custom', label: 'Período' },
]

const CURRENCIES: { key: Currency; label: string }[] = [
  { key: 'USD', label: 'US$' },
  { key: 'BRL', label: 'R$' },
]

type ProviderFilter = 'all' | Provider

/**
 * Painel de custos das APIs (/admin/api), reescrito em 17/09/2026.
 *
 * Tudo sai de UM relatorio agregado no banco (RPC usage_report): mudar o periodo ou o provedor
 * refaz a consulta e TODOS os blocos mudam juntos -- antes o filtro de datas nao afetava tudo e os
 * numeros nao batiam entre si. O custo principal e o REAL (o que sai do caixa); o custo de TABELA
 * (quanto custaria se o provedor cobrasse) aparece ao lado, porque e ele que vira gasto quando o
 * uso passar dos planos gratuitos.
 */
export function ApiMonitor() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  const colorOf = useProviderColor()

  const [periodKey, setPeriodKey] = useState<PeriodKey>('30d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [provider, setProvider] = useState<ProviderFilter>('all')
  const [report, setReport] = useState<UsageReport | null>(null)
  const [monthReal, setMonthReal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [alerts, setAlerts] = useState<AdminAlert[]>([])
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [currency, setCurrency] = useState<Currency>(savedCurrency)
  const [rate, setRate] = useState<Rate | null>(null)

  const period = useMemo(() => periodRange(periodKey, { from, to }), [periodKey, from, to])
  const customIncomplete = periodKey === 'custom' && (!from || !to)

  const load = useCallback(async () => {
    if (customIncomplete) return
    setLoading(true)
    try {
      const r = await getUsageReport(period, provider === 'all' ? null : provider)
      setReport(r)
    } catch (err) {
      logSilentError('client:ApiMonitor.report', err)
      toast('Não consegui carregar o consumo das APIs', 'error')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, provider, customIncomplete])

  useEffect(() => {
    void load()
  }, [load])

  // Independentes do filtro: carregam uma vez.
  useEffect(() => {
    getAppSettings().then(setSettings).catch(() => {})
    listAdminAlerts().then(setAlerts).catch(() => {})
    db.listProfiles()
      .then((all) => setProfiles(new Map(all.map((p) => [p.id, p]))))
      .catch(() => {})
    // Gasto real do mes corrente, para o medidor do teto no freio (vale seja qual for o filtro).
    getUsageReport(periodRange('month'), null)
      .then((r) => setMonthReal(r.totals.cost_real))
      .catch(() => setMonthReal(null))
  }, [])

  useEffect(() => {
    if (currency === 'BRL' && !rate) getUsdBrl().then(setRate)
  }, [currency, rate])

  function switchCurrency(c: Currency) {
    setCurrency(c)
    saveCurrency(c)
  }

  const fmtMoney = useCallback((usd: number) => money(usd, currency, currency === 'BRL' ? rate?.value ?? null : null), [currency, rate])

  async function saveSettings(patch: Partial<AppSettings>) {
    try {
      setSettings(await updateAppSettings(patch))
      toast('Configuração salva')
    } catch (err) {
      logSilentError('client:ApiMonitor.saveSettings', err)
      toast('Não consegui salvar', 'error')
    }
  }

  async function resolveAlert(id: string) {
    if (!profile) return
    try {
      await resolveAdminAlert(id, profile.id)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      logSilentError('client:ApiMonitor.resolveAlert', err)
      toast('Não consegui marcar o alerta', 'error')
    }
  }

  // Com nada pago no periodo (ex.: filtro so do Groq gratuito), barras e rankings usam o custo de
  // tabela -- senao tudo seria zero e o painel nao diria nada.
  const basis: 'real' | 'list' = report && report.totals.cost_real > 0 ? 'real' : 'list'

  const t = report?.totals
  const notes = report?.notes
  const savings = report ? cacheSavingsUsd(report) : 0

  return (
    <div className="px-4 sm:px-5 safe-top pb-16 max-w-6xl mx-auto">
      <header className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/admin')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2 flex-1 min-w-0">
          <Activity size={20} className="text-accent shrink-0" /> <span className="truncate">Custos das APIs</span>
        </h1>
        <button onClick={() => void load()} className="btn-ghost h-10 w-10 p-0 rounded-xl shrink-0" aria-label="Atualizar" title="Atualizar">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* Filtros num card so, acima de tudo que eles controlam. */}
      <div className="card p-3 mb-4 flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-3">
        <Segmented ariaLabel="Período" value={periodKey} onChange={setPeriodKey} options={PERIODS} />
        <Segmented
          ariaLabel="Provedor"
          value={provider}
          onChange={setProvider}
          options={[{ key: 'all', label: 'Todos' }, ...PROVIDERS.filter((p) => p !== 'openai').map((p) => ({ key: p, label: PROVIDER_LABEL[p], dot: colorOf(p) }))]}
        />
        <div className="lg:ml-auto">
          <Segmented ariaLabel="Moeda" value={currency} onChange={switchCurrency} options={CURRENCIES} />
        </div>
      </div>

      {periodKey === 'custom' && (
        <div className="card p-3 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      <p className="text-xs text-content-muted mb-4">
        {period.from.toLocaleDateString('pt-BR')} a {period.to.toLocaleDateString('pt-BR')}
        {provider !== 'all' && ` · só ${PROVIDER_LABEL[provider]}`}
        {currency === 'BRL' &&
          (rate
            ? ` · US$ 1 = R$ ${rate.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} (${rate.source}, ${rate.at}), só para visualizar: os provedores cobram em dólar`
            : ' · não consegui buscar a cotação agora, valores em dólar')}
      </p>

      <div className="space-y-4">
        <AlertsPanel alerts={alerts} onResolve={resolveAlert} />

        {customIncomplete ? (
          <div className="card p-8 text-center text-content-muted text-sm">Escolha as duas datas do período.</div>
        ) : !report || !t || !notes ? (
          <div className="grid place-items-center py-20">
            <Spinner size={24} className="text-accent" />
          </div>
        ) : (
          <>
            <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <Kpi
                emphasis
                icon={<Wallet size={15} />}
                label="Gasto real"
                value={fmtMoney(t.cost_real)}
                hint={`De tabela: ${fmtMoney(t.cost_list)}`}
              />
              <Kpi
                icon={<Wallet size={15} />}
                label={periodKey === 'month' ? 'Fechamento do mês' : 'Projeção de 30 dias'}
                value={fmtMoney(projectMonth(t.cost_real, period))}
                hint={`De tabela: ${fmtMoney(projectMonth(t.cost_list, period))}`}
              />
              <Kpi
                icon={<Users size={15} />}
                label="Custo por usuário/mês"
                value={t.users ? fmtMoney(projectMonth(t.cost_real, period) / t.users) : '—'}
                hint={`${t.users} ${t.users === 1 ? 'usuário ativo' : 'usuários ativos'}`}
              />
              <Kpi
                icon={<FileText size={15} />}
                label="Custo real por nota"
                value={notes.count ? fmtMoney(t.cost_real / notes.count) : '—'}
                hint={notes.count ? `De tabela: ${fmtMoney(t.cost_list / notes.count)}` : undefined}
              />
              <Kpi icon={<FileText size={15} />} label="Notas criadas" value={String(notes.count)} hint={`${notes.users} ${notes.users === 1 ? 'pessoa' : 'pessoas'}`} />
              <Kpi
                icon={<AudioLines size={15} />}
                label="Áudio transcrito"
                value={fmtAudio(t.audio_seconds)}
                hint={notes.with_audio ? `${fmtAudio(notes.audio_seconds / notes.with_audio)} por nota com áudio` : undefined}
              />
              <Kpi
                icon={<Coins size={15} />}
                label="Tokens de IA"
                value={compactNum(t.input_tokens + t.output_tokens)}
                hint={`${compactNum(t.cache_read_tokens)} lidos do cache`}
              />
              <Kpi
                icon={<PiggyBank size={15} />}
                label="Economia do cache"
                value={fmtMoney(savings)}
                hint="entrada reaproveitada entre resumo, itens e chat"
              />
            </div>

            <DailyChart report={report} period={period} fmtMoney={fmtMoney} />

            <div className="grid lg:grid-cols-2 gap-4 items-start">
              <TasksPanel report={report} fmtMoney={fmtMoney} basis={basis} />
              <UsersPanel report={report} profiles={profiles} fmtMoney={fmtMoney} basis={basis} />
            </div>

            {settings && provider === 'all' && <ScalePanel report={report} period={period} settings={settings} fmtMoney={fmtMoney} />}

            {settings && (
              <ProvidersPanel
                report={report}
                settings={settings}
                fmtMoney={fmtMoney}
                onSettings={saveSettings}
                onBillingChanged={() => {
                  toast('Modo de cobrança atualizado')
                  getAppSettings().then(setSettings).catch(() => {})
                  void load()
                }}
              />
            )}
          </>
        )}

        {settings && (
          <BrakePanel
            settings={settings}
            monthRealUsd={monthReal}
            fmtMoney={fmtMoney}
            onSettings={saveSettings}
            onBreakerReleased={(code) => alerts.filter((a) => a.code === code).forEach((a) => void resolveAlert(a.id))}
          />
        )}
      </div>
    </div>
  )
}
