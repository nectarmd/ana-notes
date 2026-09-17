// Freio de gasto e resposta de erro compartilhados pelas edge functions que chamam APIs pagas.
// Ordem das checagens: kill switch -> teto global do mes -> cota diaria do usuario -> minutos de
// audio do dia -> notas por hora -> rajada anti-abuso.
//
// A contabilidade (api_usage) e escrita DEPOIS da chamada, entao o guard sempre olha o
// consumo ja registrado. Um usuario pode estourar a cota na ultima chamada; o excedente
// e limitado ao custo de uma unica chamada, e a proxima ja e barrada.
//
// Desde 17/09/2026 o freio usa o custo REAL (api_usage.real_cost_usd), nao o custo de tabela.
// Antes, o gasto "fantasma" do Groq e do AssemblyAI (tier gratuito) contava para o teto mensal:
// em 16/09 o acumulado estava em US$ 8,50 de US$ 10 com gasto real de US$ 2,00 -- o app inteiro
// seria bloqueado para todos por volta de 19/09 sem motivo nenhum.

// @ts-nocheck  (ambiente Deno)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ERRORS } from './errors.ts'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Confirma de verdade se o token e valido, perguntando ao proprio servidor de autenticacao
 * do Supabase (`auth.getUser`) — em vez de so ler o campo `sub` do token sem checar a
 * assinatura, como este codigo fazia antes.
 *
 * Isto e uma SEGUNDA trava (defesa em profundidade): o gateway do Supabase ja verifica o JWT
 * antes da requisicao chegar aqui, mas essa protecao depende de uma flag de deploy
 * (verify_jwt) que pode ser desligada por engano numa function futura — e ja aconteceu neste
 * projeto (o google-oauth rodava assim ate este mesmo commit). Sem esta segunda checagem,
 * desligar a flag deixaria qualquer um forjar um token com qualquer `sub` e se passar por
 * outro usuario, drenando o limite diario dele ou sujando a contabilidade de uso.
 *
 * Custo: uma chamada de rede ao servidor de autenticacao a cada requisicao. Irrelevante perto
 * do tempo que as proprias chamadas de IA/transcricao ja levam (segundos).
 */
export async function callerId(req: Request): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const admin = adminClient()
  if (!admin) return null // sem service role nao da pra confirmar nada: trata como nao autenticado
  try {
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data?.user) return null
    return data.user.id
  } catch {
    return null
  }
}

/** Chamada de servico (cron / ferramenta do admin), autenticada pelo CRON_SECRET. */
export function isServiceCall(req: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  return !!secret && req.headers.get('x-cron-secret') === secret
}

/**
 * Nunca deixa a contabilidade derrubar a resposta ao usuario.
 * `billing_mode` e `real_cost_usd` NAO sao passados aqui: um trigger no banco os preenche a partir
 * de app_settings.provider_billing (ver migration 0038), para valer em todo insert.
 */
export async function logUsage(row: Record<string, unknown>) {
  try {
    const admin = adminClient()
    if (!admin) return
    await admin.from('api_usage').insert(row)
  } catch (_) {
    /* silencioso de proposito */
  }
}

const AUDIT_DETAIL_MAX_CHARS = 4000

/** Corta o `detail` pra caber sem quebrar o JSON (nunca trunca a string bruta no meio de um objeto). */
function capDetail(detail?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!detail) return null
  try {
    const json = JSON.stringify(detail)
    if (json.length <= AUDIT_DETAIL_MAX_CHARS) return detail
    return { truncated: true, preview: json.slice(0, AUDIT_DETAIL_MAX_CHARS - 200) }
  } catch {
    return { truncated: true, preview: String(detail).slice(0, 500) }
  }
}

export interface AuditLogRow {
  severity: 'info' | 'warning' | 'error' | 'critical'
  category: 'system' | 'user' | 'silent' | 'security'
  source: string
  message: string
  code?: string | null
  detail?: Record<string, unknown> | null
  user_id?: string | null
  note_id?: string | null
  route?: string | null
  user_agent?: string | null
}

/**
 * So para uso SERVER-TO-SERVER (a propria edge function, que ja tem adminClient() aberto) --
 * grava direto no Postgres, sem round-trip HTTP. Chamada no catch de TODAS as edge functions,
 * entao um insert pendurado (rede lenta, Postgres ocupado) NAO PODE virar um request pendurado
 * em qualquer caminho de erro do app -- daí o timeout via Promise.race, diferente de logUsage
 * (que so grava uma vez, no caminho feliz). Nunca lanca: uma falha aqui nunca deve piorar o
 * erro original que estava sendo registrado.
 */
export async function logAuditServer(row: AuditLogRow): Promise<void> {
  try {
    const admin = adminClient()
    if (!admin) return
    const insert = admin.from('audit_log').insert({
      ...row,
      message: String(row.message ?? '').slice(0, 2000),
      detail: capDetail(row.detail),
    })
    await Promise.race([insert, new Promise((resolve) => setTimeout(resolve, 1500))])
  } catch (_) {
    /* nunca derruba quem chamou */
  }
}

/** Mesmo cuidado do logAuditServer: nunca pendura, nunca lanca. */
async function rpcQuiet(fn: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const admin = adminClient()
    if (!admin) return null
    const call = admin.rpc(fn, args)
    const res = await Promise.race([call, new Promise((resolve) => setTimeout(() => resolve(null), 1500))])
    return (res as { data?: unknown })?.data ?? null
  } catch (_) {
    return null
  }
}

export interface ErrorContext {
  source: string
  userId?: string | null
  noteId?: string | null
  /** Causa tecnica crua (corpo do provedor, stack). Vai SO para o log. */
  technical?: string
  detail?: Record<string, unknown>
  /** Registra o erro sem repetir o log (ex.: disjuntor ja aberto, que ja foi logado). */
  skipLog?: boolean
  /**
   * A chamada foi barrada PELO disjuntor ja aberto. Nao reabre o disjuntor (senao, enquanto algum
   * usuario insistisse, o prazo seria empurrado para frente e ele nunca fecharia sozinho) e nao
   * repete a linha no log -- so conta mais uma ocorrencia e mais um usuario afetado no alerta.
   */
  fromBreaker?: boolean
}

/**
 * A UNICA forma de responder erro nas edge functions. Faz as quatro coisas que o
 * administrador pediu, sempre juntas:
 *  1. o usuario recebe uma mensagem simples (`error`) + o codigo (`code`);
 *  2. o audit_log recebe o codigo e a causa tecnica real;
 *  3. problema que so o admin resolve vira alerta agregado em admin_alerts;
 *  4. problema do provedor inteiro abre o disjuntor, para nao martelar o provedor.
 */
export async function errorResponse(code: string, ctx: ErrorContext): Promise<Response> {
  const def = ERRORS[code] ?? ERRORS.UNEXPECTED
  const realCode = ERRORS[code] ? code : 'UNEXPECTED'

  await reportIssue(realCode, ctx)

  return new Response(
    JSON.stringify({
      error: def.user,
      code: realCode,
      adminOnly: !!def.adminOnly,
      retryAfterSec: def.retryAfterSec ?? null,
    }),
    { status: def.status, headers: { ...cors, 'content-type': 'application/json' } },
  )
}

/**
 * Registra (log + alerta + disjuntor) SEM responder ao usuario. Para quando o problema foi
 * contornado: o Groq recusou mas o AssemblyAI assumiu -- o usuario recebe a transcricao
 * normalmente, e o administrador ainda precisa saber que o provedor principal falhou.
 */
export async function reportIssue(code: string, ctx: ErrorContext): Promise<void> {
  const def = ERRORS[code] ?? ERRORS.UNEXPECTED
  const realCode = ERRORS[code] ? code : 'UNEXPECTED'
  const technical = String(ctx.technical ?? '').slice(0, 1500)

  if (!ctx.skipLog && !ctx.fromBreaker) {
    await logAuditServer({
      severity: def.severity,
      category: def.category,
      source: ctx.source,
      code: realCode,
      message: technical ? `${def.admin} | ${technical}` : def.admin,
      detail: ctx.detail ?? null,
      user_id: ctx.userId ?? null,
      note_id: ctx.noteId ?? null,
    })
  }

  if (def.alert) {
    await rpcQuiet('raise_admin_alert', {
      p_code: realCode,
      p_severity: def.severity === 'info' ? 'warning' : def.severity,
      p_title: def.admin,
      p_detail: { source: ctx.source, technical: technical.slice(0, 500), ...(ctx.detail ?? {}) },
      p_user: ctx.userId ?? null,
    })
  }

  if (def.breaker && !ctx.fromBreaker) {
    await rpcQuiet('trip_ai_breaker', {
      p_provider: def.breaker.provider,
      p_code: realCode,
      p_minutes: def.breaker.minutes,
    })
  }
}

/** O provedor voltou a responder: fecha o disjuntor e resolve o alerta correspondente. */
export async function clearBreaker(provider: string): Promise<void> {
  await rpcQuiet('clear_ai_breaker', { p_provider: provider })
}

export interface Guard {
  day_cost_user: number
  month_cost_global: number
  calls_last_min: number
  notes_last_hour: number
  audio_seconds_today_user: number
  groq_audio_seconds_last_hour: number
  groq_audio_seconds_today: number
  ai_enabled: boolean
  daily_usd_per_user: number
  monthly_usd_global: number
  rate_per_min: number
  notes_per_hour: number
  audio_minutes_per_day: number
  provider_billing: Record<string, 'paid' | 'free'>
  provider_limits: Record<string, Record<string, unknown>>
  breaker: Record<string, { code: string; until: string; since: string }>
}

export interface GuardResult {
  ok: boolean
  code?: string
  technical?: string
  guard?: Guard
}

/** Disjuntor aberto para o provedor? Devolve o codigo que o abriu. */
export function breakerOpen(g: Guard | undefined, provider: string): string | null {
  const b = g?.breaker?.[provider]
  if (!b?.until) return null
  return Date.parse(b.until) > Date.now() ? b.code : null
}

export type GuardKind = 'ai' | 'transcription'

/**
 * Roda os freios antes de gastar dinheiro. Se o medidor falhar, BARRA a chamada (fail-closed):
 * a alternativa (deixar passar) significa que uma falha do PROPRIO medidor vira gasto sem teto e
 * sem registro. Um erro ocasional numa falha passageira e um preco aceitavel por nunca gastar as
 * cegas.
 *
 * `kind`: o limite de "notas por hora" so faz sentido quando comeca uma nota nova (transcricao ou
 * resumo); o de minutos de audio, so na transcricao. Chat e detalhado nao contam nota nova.
 */
export async function checkBudget(
  userId: string | null,
  opts: { kind?: GuardKind; countsAsNote?: boolean } = {},
): Promise<GuardResult> {
  if (!userId) return { ok: false, code: 'AUTH_SESSION_INVALID' }

  const admin = adminClient()
  if (!admin) return { ok: false, code: 'BUDGET_UNAVAILABLE', technical: 'service role indisponivel' }

  let g: Guard
  try {
    const { data, error } = await admin.rpc('usage_guard', { p_user: userId })
    if (error || !data) {
      return { ok: false, code: 'BUDGET_UNAVAILABLE', technical: error?.message ?? 'RPC usage_guard sem dados' }
    }
    g = data as Guard
  } catch (err) {
    return { ok: false, code: 'BUDGET_UNAVAILABLE', technical: String(err) }
  }

  if (g.ai_enabled === false) return { ok: false, code: 'AI_DISABLED', guard: g }

  if (Number(g.month_cost_global) >= Number(g.monthly_usd_global)) {
    return {
      ok: false,
      code: 'BUDGET_MONTHLY_GLOBAL',
      technical: `real no mes US$ ${Number(g.month_cost_global).toFixed(2)} >= teto US$ ${Number(g.monthly_usd_global).toFixed(2)}`,
      guard: g,
    }
  }

  if (Number(g.day_cost_user) >= Number(g.daily_usd_per_user)) {
    return {
      ok: false,
      code: 'BUDGET_DAILY_USER',
      technical: `real hoje US$ ${Number(g.day_cost_user).toFixed(4)} >= limite US$ ${Number(g.daily_usd_per_user).toFixed(2)}`,
      guard: g,
    }
  }

  if (opts.kind === 'transcription' && Number(g.audio_seconds_today_user) >= Number(g.audio_minutes_per_day) * 60) {
    return {
      ok: false,
      code: 'BUDGET_AUDIO_PER_DAY',
      technical: `audio hoje ${Math.round(Number(g.audio_seconds_today_user) / 60)} min >= limite ${g.audio_minutes_per_day} min`,
      guard: g,
    }
  }

  if (opts.countsAsNote && Number(g.notes_last_hour) >= Number(g.notes_per_hour)) {
    return {
      ok: false,
      code: 'BUDGET_NOTES_PER_HOUR',
      technical: `${g.notes_last_hour} notas na ultima hora >= limite ${g.notes_per_hour}`,
      guard: g,
    }
  }

  if (Number(g.calls_last_min) >= Number(g.rate_per_min)) {
    return {
      ok: false,
      code: 'BUDGET_RATE_BURST',
      technical: `${g.calls_last_min} chamadas no ultimo minuto >= limite ${g.rate_per_min}`,
      guard: g,
    }
  }

  return { ok: true, guard: g }
}

/** Atalho: transforma um GuardResult reprovado na resposta padrao de erro. */
export const guardResponse = (r: GuardResult, source: string, userId: string | null) =>
  errorResponse(r.code ?? 'UNEXPECTED', { source, userId, technical: r.technical })
