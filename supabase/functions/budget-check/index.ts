// Edge Function: alertas de orcamento e de limite dos provedores (executada diariamente pelo
// pg_cron, 03:30 UTC). Protegida por header x-cron-secret == CRON_SECRET. Deploy com
// --no-verify-jwt (chamada de cron nao tem sessao de usuario).
//
// O que verifica, e por que:
//  1. Gasto REAL de ontem acima de app_settings.ai_daily_alert_usd -> budget_alerts (historico) +
//     admin_alerts. Antes somava o custo de TABELA, inflado pelo Groq/AssemblyAI gratuitos.
//  2. Credito do AssemblyAI (US$ 50 de cadastro) abaixo de 20% -> alerta ANTES de acabar.
//  3. Saldo pre-pago da Anthropic (se o admin informou) abaixo de 20% -> alerta ANTES de acabar.
//     Os creditos acabaram em 26/08 e 16/09/2026 e o administrador so soube pelos usuarios.
//  4. Groq em tier gratuito: pico de audio por hora de ontem acima de 85% do limite -> alerta de
//     que a escala esta chegando no teto do plano.

// @ts-nocheck  (ambiente Deno)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, isServiceCall } from '../_shared/guard.ts'

async function alert(admin, code: string, severity: 'warning' | 'error' | 'critical', title: string, detail: unknown) {
  try {
    await admin.rpc('raise_admin_alert', { p_code: code, p_severity: severity, p_title: title, p_detail: detail, p_user: null })
  } catch (_) {
    /* um alerta que falha nao derruba os outros */
  }
}

Deno.serve(async (req) => {
  if (!isServiceCall(req)) {
    return new Response(JSON.stringify({ error: 'nao autorizado' }), { status: 401 })
  }
  const admin = adminClient()
  if (!admin) return new Response(JSON.stringify({ error: 'sem service role' }), { status: 500 })

  // Janela de ontem, em UTC.
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end.getTime() - 86400000)
  const day = start.toISOString().slice(0, 10)

  const { data: s } = await admin
    .from('app_settings')
    .select('ai_daily_alert_usd, provider_billing, provider_limits')
    .limit(1)
    .single()
  const threshold = Number(s?.ai_daily_alert_usd ?? 10)
  const billing = (s?.provider_billing ?? {}) as Record<string, string>
  const limits = (s?.provider_limits ?? {}) as Record<string, Record<string, unknown>>
  const report: Record<string, unknown> = { day }

  // 1) gasto real de ontem
  const { data: yRows, error } = await admin
    .from('api_usage')
    .select('real_cost_usd, provider, audio_seconds, created_at')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const spend = (yRows ?? []).reduce((acc, r) => acc + Number(r.real_cost_usd), 0)
  report.spend_real = spend
  if (spend >= threshold) {
    // `day` e unique: rodar duas vezes no mesmo dia nao duplica o alerta.
    await admin.from('budget_alerts').upsert({ day, spend_usd: spend, threshold_usd: threshold }, { onConflict: 'day' })
    await alert(admin, 'BUDGET_DAILY_ALERT', 'warning',
      `Gasto real de ${day} (US$ ${spend.toFixed(2)}) passou do limiar de alerta (US$ ${threshold.toFixed(2)}).`,
      { day, spend, threshold })
  }

  // 2) credito do AssemblyAI (quando esta em modo gratuito/credito)
  const aCredit = Number(limits.assemblyai?.credit_usd ?? 0)
  if (billing.assemblyai === 'free' && aCredit > 0) {
    const { data: aRows } = await admin.from('api_usage').select('cost_usd').eq('provider', 'assemblyai')
    const used = (aRows ?? []).reduce((acc, r) => acc + Number(r.cost_usd), 0)
    const left = aCredit - used
    report.assemblyai = { credit: aCredit, used, left }
    if (left <= aCredit * 0.2) {
      await alert(admin, 'PROVIDER_ASSEMBLYAI_CREDIT_LOW', left <= aCredit * 0.05 ? 'critical' : 'error',
        `Credito do AssemblyAI acabando: estimativa de US$ ${Math.max(left, 0).toFixed(2)} de US$ ${aCredit.toFixed(2)}. Quando acabar, arquivos grandes e diarizacao param de transcrever.`,
        { credit: aCredit, used, left })
    }
  }

  // 3) saldo pre-pago da Anthropic (se o admin informou quanto carregou e quando)
  const aBal = Number(limits.anthropic?.balance_usd ?? 0)
  const aSince = limits.anthropic?.balance_set_at as string | undefined
  if (aBal > 0 && aSince) {
    const { data: anRows } = await admin
      .from('api_usage')
      .select('real_cost_usd')
      .eq('provider', 'anthropic')
      .gte('created_at', aSince)
    const used = (anRows ?? []).reduce((acc, r) => acc + Number(r.real_cost_usd), 0)
    const left = aBal - used
    report.anthropic = { balance: aBal, used, left }
    if (left <= aBal * 0.2) {
      await alert(admin, 'PROVIDER_ANTHROPIC_BALANCE_LOW', left <= aBal * 0.05 ? 'critical' : 'error',
        `Saldo da Anthropic acabando: estimativa de US$ ${Math.max(left, 0).toFixed(2)} de US$ ${aBal.toFixed(2)} carregados. Quando acabar, resumo, detalhado e chat param para todos.`,
        { balance: aBal, used, left, since: aSince })
    }
  }

  // 4) Groq no tier gratuito: pico por hora de ontem
  const ash = Number(limits.groq?.audio_seconds_hour ?? 0)
  const asd = Number(limits.groq?.audio_seconds_day ?? 0)
  if (billing.groq === 'free' && ash > 0) {
    const perHour = new Map<string, number>()
    let dayTotal = 0
    for (const r of yRows ?? []) {
      if (r.provider !== 'groq') continue
      const h = String(r.created_at).slice(0, 13)
      perHour.set(h, (perHour.get(h) ?? 0) + Number(r.audio_seconds))
      dayTotal += Number(r.audio_seconds)
    }
    const peak = Math.max(0, ...perHour.values())
    report.groq = { peak_hour_seconds: peak, day_seconds: dayTotal, ash, asd }
    if (peak >= ash * 0.85 || (asd > 0 && dayTotal >= asd * 0.85)) {
      await alert(admin, 'PROVIDER_GROQ_FREE_TIER_NEAR_LIMIT', 'warning',
        `Groq perto do limite do plano gratuito em ${day}: pico de ${Math.round(peak / 60)} min de audio numa hora (limite ${Math.round(ash / 60)} min) e ${Math.round(dayTotal / 60)} min no dia (limite ${Math.round(asd / 60)} min). Acima disso as transcricoes vao para o AssemblyAI.`,
        report.groq)
    }
  }

  return new Response(JSON.stringify({ ok: true, ...report }), { headers: { 'content-type': 'application/json' } })
})
