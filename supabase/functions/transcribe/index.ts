// Edge Function: transcricao de audio.
//  - Padrao: Whisper large-v3 (Groq/OpenAI) - barato e rapido, sincrono.
//  - AssemblyAI (assincrono: devolve jobId e o cliente acompanha com ?job=<id>) quando:
//      * o arquivo passa do limite por arquivo do Whisper (25 MB);
//      * o usuario pediu diarizacao (identificar quem falou);
//      * o Groq esta em tier gratuito e perto do limite de audio por hora/dia;
//      * o Groq FALHOU (limite, chave, 5xx, arquivo que ele nao le) -- o AssemblyAI assume e o
//        administrador e avisado, sem o usuario perder a transcricao.
//  Todo erro sai por `errorResponse`: mensagem simples ao usuario, codigo + causa ao administrador.

// @ts-nocheck  (ambiente Deno)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  adminClient,
  callerId,
  checkBudget,
  cors,
  errorResponse,
  guardResponse,
  logAuditServer,
  logUsage,
  reportIssue,
} from '../_shared/guard.ts'
import { classifyWhisper, CodedError } from '../_shared/errors.ts'

const PROVIDER = Deno.env.get('TRANSCRIPTION_PROVIDER') ?? 'groq'
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')

// Limites no SERVIDOR: o cliente ja valida, mas a edge function e chamavel direto.
const MAX_FILE_MB = 60
const MAX_AUDIO_SECONDS = 2 * 60 * 60 // 2 horas

// Acima disto o Whisper (Groq/OpenAI) recusa com 413 "Request Entity Too Large": o limite por
// arquivo e 25 MB nos dois. Um .m4a de reuniao de ~50 min ja nasce com 50 MB (casos de 02/09 e
// 10/09/2026). Arquivos assim vao para o AssemblyAI, que aceita ate 5 GB.
const WHISPER_MAX_MB = 24

// Margem antes do limite do tier gratuito do Groq: desvia para o AssemblyAI ANTES de o Groq
// comecar a recusar. Em 30 dias com 10 usuarios o pico ja chegou a 112% do limite por hora.
const GROQ_HOUR_MARGIN = 0.85
const GROQ_DAY_MARGIN = 0.9

// Preco de TABELA em USD por segundo de audio (o custo REAL depende do modo de cobranca do
// provedor, gravado por trigger em api_usage). AssemblyAI conferido em assemblyai.com/pricing em
// 17/09/2026: US$ 0,21/h, +US$ 0,02/h com diarizacao (antes o codigo usava US$ 0,37/h).
const PRICE_PER_SEC: Record<string, number> = {
  groq: 0.111 / 3600, // whisper-large-v3
  openai: 0.006 / 60, // whisper-1
  assemblyai: 0.21 / 3600,
  assemblyai_diarize: 0.02 / 3600,
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class WhisperError extends CodedError {
  fallback: boolean
  constructor(code: string, technical: string, fallback: boolean) {
    super(code, technical)
    this.fallback = fallback
  }
}

async function whisperOnce(file: File): Promise<{ text: string; seconds: number }> {
  const endpoint =
    PROVIDER === 'openai'
      ? 'https://api.openai.com/v1/audio/transcriptions'
      : 'https://api.groq.com/openai/v1/audio/transcriptions'
  const key = PROVIDER === 'openai' ? Deno.env.get('OPENAI_API_KEY') : Deno.env.get('GROQ_API_KEY')
  const model = PROVIDER === 'openai' ? 'whisper-1' : 'whisper-large-v3'
  const form = new FormData()
  form.append('file', file, file.name || 'audio.webm')
  form.append('model', model)
  form.append('language', 'pt')
  // verbose_json traz `duration` (segundos), que e como a transcricao e cobrada.
  form.append('response_format', 'verbose_json')
  const res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form })
  if (!res.ok) {
    const body = await res.text()
    const { code, fallback } = classifyWhisper(res.status, body)
    const err = new WhisperError(code, `${PROVIDER} ${res.status}: ${body.slice(0, 800)}`, fallback)
    ;(err as { retryable?: boolean }).retryable = classifyWhisper(res.status, body).retryable
    throw err
  }
  const data = await res.json()
  const segments = Array.isArray(data.segments) ? data.segments : []
  const text = segments.length ? paragraphize(segments) : String(data.text ?? '')
  return { text, seconds: Math.round(Number(data.duration) || 0) }
}

/**
 * Transcricao em PARAGRAFOS, nao num bloco unico. Ate 17/09/2026 o texto do Whisper era gravado como
 * veio -- 48 mil caracteres sem uma quebra de linha, ilegivel na tela. Os trechos (segmentos do
 * Whisper ou palavras do AssemblyAI, com tempo em segundos) viram paragrafo novo numa pausa de 2 s
 * ou mais, ou quando o paragrafo ja esta longo e a frase termina.
 */
function paragraphize(pieces: Array<{ text?: string; start?: number; end?: number }>): string {
  const out: string[] = []
  let cur = ''
  let lastEnd = 0
  for (const p of pieces) {
    const t = String(p.text ?? '').trim()
    if (!t) continue
    const start = Number(p.start) || 0
    const endsSentence = /[.!?…]["')\]]?$/.test(cur)
    if (cur && ((start - lastEnd >= 2 && cur.length >= 150) || (cur.length >= 650 && endsSentence) || cur.length >= 1200)) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur} ${t}` : t
    lastEnd = Number(p.end) || start
  }
  if (cur) out.push(cur)
  return out.join('\n\n')
}

/**
 * Com novas tentativas. Dois tipos de falha transitoria justificam reenviar o MESMO arquivo:
 *  - erro do provedor retryable (5xx, "could not process file" em audio que o navegador le);
 *  - 200 OK com texto VAZIO para audio com duracao real: ja aconteceu com um audio de 25 min que,
 *    reenviado, transcreveu 22 mil caracteres. Nao e o audio que esta ruim.
 */
async function whisper(file: File): Promise<{ text: string; seconds: number }> {
  const MIN_SECONDS_TO_EXPECT_TEXT = 3
  const MAX_ATTEMPTS = 3
  let last: { text: string; seconds: number } | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await whisperOnce(file)
      last = result
      if (result.text.trim() || result.seconds < MIN_SECONDS_TO_EXPECT_TEXT) return result
    } catch (err) {
      const retryable = (err as { retryable?: boolean }).retryable === true
      if (!retryable || attempt === MAX_ATTEMPTS) throw err
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1500 * attempt)
  }
  return last!
}

/**
 * Manda o arquivo pro AssemblyAI e devolve o ID do trabalho, SEM esperar terminar: um audio de
 * ~1 h nao termina dentro do tempo de uma requisicao de edge function.
 */
/** Por que o ultimo assemblyStart nao devolveu trabalho. Sem isto a falha do plano B era
 *  invisivel: em 23/09/2026 o Groq recusou por limite (429), o AssemblyAI tambem nao assumiu e o
 *  log so dizia "nao estava disponivel", sem motivo nenhum para investigar. */
let assemblyLastError: string | null = null

async function assemblyStart(file: File, diarize: boolean): Promise<string | null> {
  assemblyLastError = null
  if (!ASSEMBLYAI_API_KEY) {
    assemblyLastError = 'ASSEMBLYAI_API_KEY nao configurada'
    return null
  }
  try {
    const up = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: ASSEMBLYAI_API_KEY },
      body: await file.arrayBuffer(),
    })
    if (!up.ok) {
      assemblyLastError = `upload ${up.status}: ${(await up.text()).slice(0, 300)}`
      return null
    }
    const { upload_url } = await up.json()

    const tr = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: ASSEMBLYAI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url, speaker_labels: diarize, language_code: 'pt' }),
    })
    if (!tr.ok) {
      assemblyLastError = `criacao do trabalho ${tr.status}: ${(await tr.text()).slice(0, 300)}`
      return null
    }
    const { id } = await tr.json()
    if (!id) assemblyLastError = 'resposta do AssemblyAI sem id de trabalho'
    return id ?? null
  } catch (e) {
    assemblyLastError = `excecao: ${e instanceof Error ? e.message : String(e)}`
    return null
  }
}

async function assemblyFetch(id: string): Promise<Record<string, unknown> | null> {
  if (!ASSEMBLYAI_API_KEY) return null
  try {
    const p = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, {
      headers: { authorization: ASSEMBLYAI_API_KEY },
    })
    if (!p.ok) return null
    return await p.json()
  } catch {
    return null
  }
}

/** Texto final: com diarizacao vira "Falante A: ...", uma fala por linha; sem, paragrafos pelas pausas. */
function assemblyResult(data: Record<string, unknown>): { text: string; seconds: number } {
  const utterances = data.utterances as Array<{ speaker: string; text: string }> | undefined
  const words = data.words as Array<{ text: string; start: number; end: number }> | undefined
  const text =
    Array.isArray(utterances) && utterances.length
      ? utterances.map((u) => `Falante ${u.speaker}: ${u.text}`).join('\n')
      : Array.isArray(words) && words.length
        ? paragraphize(words.map((w) => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 })))
        : String(data.text ?? '')
  return { text, seconds: Math.round(Number(data.audio_duration) || 0) }
}

// ------------------------------------------------------------------------------ mesmo audio duas vezes
//
// Fase 8, item 4 (17/09/2026): em 16/09 a mesma gravacao de 11 min foi transcrita 3 vezes em 40 s
// (log do proprio Groq). A chave e o SHA-256 do arquivo ORIGINAL (o app manda; sem ele, calculamos
// aqui), por usuario, separando com e sem diarizacao. Guardado por 7 dias (limpeza em 0041).
const HEX64 = /^[0-9a-f]{64}$/
const JOB_REUSE_MS = 3 * 60 * 60 * 1000

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface CacheRow {
  transcript: string | null
  job_id: string | null
  provider: string | null
  created_at: string
}

async function cacheGet(userId: string, key: string): Promise<CacheRow | null> {
  try {
    const admin = adminClient()
    if (!admin) return null
    const { data } = await admin
      .from('transcription_cache')
      .select('transcript, job_id, provider, created_at')
      .eq('user_id', userId)
      .eq('file_sha256', key)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
      .maybeSingle()
    return (data as CacheRow) ?? null
  } catch {
    return null
  }
}

async function cachePut(userId: string, key: string, row: Record<string, unknown>): Promise<void> {
  try {
    const admin = adminClient()
    if (!admin) return
    const now = new Date().toISOString()
    await admin.from('transcription_cache').upsert({ user_id: userId, file_sha256: key, created_at: now, updated_at: now, ...row })
  } catch {
    /* cache e opcional: nunca derruba a transcricao */
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let userId: string | null = null
  try {
    userId = await callerId(req)

    // ------------------------------------------------------------------ consulta de trabalho
    // Nao passa pelo freio: o gasto ja foi autorizado quando o trabalho comecou. Acompanhar um
    // trabalho em andamento nunca pode ser barrado por "limite" -- perderia a transcricao paga.
    const jobId = new URL(req.url).searchParams.get('job')
    if (jobId) {
      if (!userId) return errorResponse('AUTH_SESSION_INVALID', { source: 'edge:transcribe' })
      const data = await assemblyFetch(jobId)
      if (!data) {
        return errorResponse('TRANSCRIBE_JOB_UNREACHABLE', { source: 'edge:transcribe', userId, detail: { jobId } })
      }
      if (data.status === 'error') {
        // Trabalho que falhou nao pode ser reaproveitado: a proxima tentativa comeca do zero.
        try {
          await adminClient()?.from('transcription_cache').delete().eq('user_id', userId).eq('job_id', jobId)
        } catch {
          /* ignora */
        }
        return errorResponse('TRANSCRIBE_JOB_FAILED', {
          source: 'edge:transcribe',
          userId,
          technical: `AssemblyAI: ${String(data.error ?? '').slice(0, 400)}`,
          detail: { jobId },
        })
      }
      if (data.status !== 'completed') return json({ status: 'processing' })

      const done = assemblyResult(data)
      const diarized = data.speaker_labels === true
      // Cobranca so aqui: e neste ponto que o audio foi realmente processado. Se o mesmo trabalho ja
      // foi entregue antes (duas tentativas acompanhando o mesmo job), nao conta de novo.
      const admin = adminClient()
      const { data: prior } = admin
        ? await admin.from('transcription_cache').select('file_sha256, transcript').eq('user_id', userId).eq('job_id', jobId).maybeSingle()
        : { data: null }
      if (!prior?.transcript) {
        await logUsage({
          user_id: userId,
          provider: 'assemblyai',
          model: diarized ? 'best+speaker_labels' : 'best',
          task: 'transcription',
          audio_seconds: done.seconds,
          cost_usd: done.seconds * (PRICE_PER_SEC.assemblyai + (diarized ? PRICE_PER_SEC.assemblyai_diarize : 0)),
        })
      }
      if (prior?.file_sha256 && admin) {
        await admin
          .from('transcription_cache')
          .update({ transcript: done.text, provider: 'assemblyai', audio_seconds: done.seconds, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('file_sha256', prior.file_sha256)
      }
      if (done.seconds > MAX_AUDIO_SECONDS) {
        return errorResponse('TRANSCRIBE_TOO_LONG', { source: 'edge:transcribe', userId, detail: { seconds: done.seconds } })
      }
      return json({ transcript: done.text, language: 'pt-BR', provider: 'assemblyai' })
    }

    // ------------------------------------------------------------------ nova transcricao
    const inForm = await req.formData()
    const file = inForm.get('file') as File
    if (!file) return errorResponse('TRANSCRIBE_FILE_MISSING', { source: 'edge:transcribe', userId })
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return errorResponse('TRANSCRIBE_TOO_LARGE', { source: 'edge:transcribe', userId, detail: { bytes: file.size } })
    }
    const diarize = inForm.get('diarize') === 'true'

    // Mesmo audio desta pessoa ja transcrito (ou em andamento no AssemblyAI): reaproveita ANTES do
    // freio -- uma retentativa nao deve gastar nem contar no limite diario de minutos.
    let cacheKey: string | null = null
    if (userId) {
      const sent = String(inForm.get('sha256') ?? '').toLowerCase()
      const fileHash = HEX64.test(sent) ? sent : await sha256Hex(await file.arrayBuffer())
      cacheKey = diarize ? await sha256Hex(new TextEncoder().encode(`${fileHash}:diarize`)) : fileHash
      const hit = await cacheGet(userId, cacheKey)
      if (hit?.transcript) {
        await logAuditServer({
          severity: 'info',
          category: 'system',
          source: 'edge:transcribe',
          code: 'TRANSCRIBE_DEDUPED',
          message: 'Mesmo audio enviado de novo: transcricao reaproveitada, sem custo.',
          user_id: userId,
          detail: { bytes: file.size, provider: hit.provider },
        })
        return json({ transcript: hit.transcript, language: 'pt-BR', provider: hit.provider ?? 'cache', cached: true })
      }
      if (hit?.job_id && Date.now() - Date.parse(hit.created_at) < JOB_REUSE_MS) {
        return json({ jobId: hit.job_id, provider: 'assemblyai', route: 'dedupe' }, 202)
      }
    }

    const guard = await checkBudget(userId, { kind: 'transcription', countsAsNote: true })
    if (!guard.ok) return guardResponse(guard, 'edge:transcribe', userId)
    const g = guard.guard!

    const tooBigForWhisper = file.size > WHISPER_MAX_MB * 1024 * 1024
    const limits = (g.provider_limits?.groq ?? {}) as Record<string, number>
    const groqIsFree = PROVIDER === 'groq' && g.provider_billing?.groq === 'free'
    const groqNearLimit =
      groqIsFree &&
      ((Number(limits.audio_seconds_hour) > 0 &&
        Number(g.groq_audio_seconds_last_hour) >= Number(limits.audio_seconds_hour) * GROQ_HOUR_MARGIN) ||
        (Number(limits.audio_seconds_day) > 0 &&
          Number(g.groq_audio_seconds_today) >= Number(limits.audio_seconds_day) * GROQ_DAY_MARGIN))

    const route = tooBigForWhisper ? 'size' : diarize ? 'diarize' : groqNearLimit ? 'groq_limit' : null
    if (route && ASSEMBLYAI_API_KEY) {
      const id = await assemblyStart(file, diarize)
      if (id) {
        if (userId && cacheKey) await cachePut(userId, cacheKey, { job_id: id, transcript: null, provider: 'assemblyai' })
        return json({ jobId: id, provider: 'assemblyai', route }, 202)
      }
      // Upload pro AssemblyAI falhou: tenta o Whisper mesmo assim. Se o arquivo for grande, o
      // Whisper recusa e o catch devolve a mensagem certa.
      await reportIssue('TRANSCRIBE_PROVIDER_ERROR', {
        source: 'edge:transcribe',
        userId,
        technical: `Upload/criacao do trabalho no AssemblyAI falhou (rota ${route}): ${assemblyLastError ?? 'motivo desconhecido'}; tentando Whisper.`,
        detail: { bytes: file.size, motivo: assemblyLastError },
      })
    }

    let result: { text: string; seconds: number }
    try {
      result = await whisper(file)
    } catch (err) {
      // O Whisper falhou de um jeito que o AssemblyAI pode contornar: o usuario nao perde a
      // transcricao, e o administrador fica sabendo que o provedor principal falhou.
      if (err instanceof WhisperError && err.fallback && ASSEMBLYAI_API_KEY) {
        const id = await assemblyStart(file, diarize)
        if (!id) {
          // O plano B tambem falhou: o usuario recebe o erro do Whisper, mas o motivo REAL da
          // recusa do AssemblyAI fica registrado para o administrador.
          await reportIssue('TRANSCRIBE_PROVIDER_ERROR', {
            source: 'edge:transcribe',
            userId,
            technical: `Plano B falhou apos ${err.code}: ${assemblyLastError ?? 'motivo desconhecido'}`,
            detail: { bytes: file.size, motivo: assemblyLastError },
          })
        }
        if (id) {
          if (userId && cacheKey) await cachePut(userId, cacheKey, { job_id: id, transcript: null, provider: 'assemblyai' })
          await reportIssue(err.code, {
            source: 'edge:transcribe',
            userId,
            technical: `${err.technical} | contornado: enviado ao AssemblyAI (job ${id})`,
            detail: { bytes: file.size, fallbackJob: id },
          })
          return json({ jobId: id, provider: 'assemblyai', route: 'fallback' }, 202)
        }
      }
      throw err
    }

    await logUsage({
      user_id: userId,
      provider: PROVIDER,
      model: PROVIDER === 'openai' ? 'whisper-1' : 'whisper-large-v3',
      task: 'transcription',
      audio_seconds: result.seconds,
      cost_usd: result.seconds * (PRICE_PER_SEC[PROVIDER] ?? 0),
    })

    if (result.seconds > MAX_AUDIO_SECONDS) {
      return errorResponse('TRANSCRIBE_TOO_LONG', { source: 'edge:transcribe', userId, detail: { seconds: result.seconds } })
    }

    // Texto vazio nao entra no cache: a proxima tentativa precisa poder transcrever de novo.
    if (userId && cacheKey && result.text.trim()) {
      await cachePut(userId, cacheKey, { transcript: result.text, provider: PROVIDER, audio_seconds: result.seconds, job_id: null })
    }

    return json({ transcript: result.text, language: 'pt-BR', provider: PROVIDER })
  } catch (err) {
    if (err instanceof CodedError) {
      return errorResponse(err.code, { source: 'edge:transcribe', userId, technical: err.technical })
    }
    return errorResponse('UNEXPECTED', {
      source: 'edge:transcribe',
      userId,
      technical: `${String(err)}${err instanceof Error && err.stack ? ` | ${err.stack.slice(0, 600)}` : ''}`,
    })
  }
})
