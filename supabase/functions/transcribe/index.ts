// Edge Function: transcricao de audio.
//  - Padrao: Whisper large-v3 (Groq/OpenAI) - barato e rapido.
//  - Opcional (diarize=true): AssemblyAI com speaker_labels (identifica quem falou).
//    Requer secret ASSEMBLYAI_API_KEY. Sem a chave, faz fallback para Whisper.

// @ts-nocheck  (ambiente Deno)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { callerId, checkBudget, cors, guardResponse, logAuditServer, logUsage } from '../_shared/guard.ts'

const PROVIDER = Deno.env.get('TRANSCRIPTION_PROVIDER') ?? 'groq'
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')

// Limites no SERVIDOR: o cliente ja valida, mas a edge function e chamavel direto.
// 60 MB cobre uploads externos (m4a/mp3 de outros gravadores); o Groq aceita ate 100 MB
// no tier pago. O que passa daqui ainda esbarra no MAX_AUDIO_SECONDS de 2 h.
const MAX_FILE_MB = 60
const MAX_AUDIO_SECONDS = 2 * 60 * 60 // 2 horas

// Acima disto o Whisper (Groq/OpenAI) recusa com 413 "Request Entity Too Large": o limite por
// arquivo e 25 MB nos dois. Nao adianta so avisar o usuario -- um .m4a de reuniao de ~50 min ja
// nasce com 50 MB, e era exatamente esse o caso que voltava (2026-09-02 e 2026-09-10: o mesmo
// erro, 7 tentativas seguidas). Arquivos assim vao para o AssemblyAI, que aceita ate 5 GB.
const WHISPER_MAX_MB = 24

// USD por SEGUNDO de audio (transcricao nao e cobrada por token).
const PRICE_PER_SEC: Record<string, number> = {
  groq: 0.111 / 3600, // whisper-large-v3
  openai: 0.006 / 60, // whisper-1
  assemblyai: 0.37 / 3600, // com speaker labels
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
  if (!res.ok) throw new Error(`${PROVIDER} ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return { text: data.text ?? '', seconds: Math.round(Number(data.duration) || 0) }
}

/**
 * Achado investigando uma nota do usuario: um audio de 25min voltou com texto vazio (200 OK,
 * sem erro), e o MESMO arquivo, reenviado depois pelo mesmo codigo, transcreveu perfeitamente
 * (22 mil caracteres). Ou seja, o provedor as vezes devolve sucesso com texto vazio de forma
 * transitoria -- nao e o audio que esta ruim. Para audio com duracao real, isso quase certamente
 * NAO e silencio de verdade (quem chega aqui ja passou pelo filtro de audio silencioso no
 * cliente); tenta de novo antes de desistir.
 */
/**
 * Falhas do PROVEDOR que valem reenviar o mesmo arquivo. "could not process file" entra aqui
 * porque ja apareceu em gravacoes que o proprio navegador decodifica sem problema (o cliente so
 * chega ate aqui depois de passar pelo filtro de audio silencioso, que DECODIFICA o blob). Sob
 * carga o provedor tambem devolve 5xx e 429. Reenviar custa pouco perto de perder uma reuniao.
 */
function isRetriableProviderError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /could not process file/i.test(m) || /\s5\d\d:\s/.test(m) || /\s429:\s/.test(m)
}

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
      // Antes, QUALQUER erro aqui matava a transcricao na primeira tentativa -- inclusive os
      // transitorios, que o bloco de texto-vazio acima ja tratava havia tempos. Uma reuniao de
      // 30 min da Aline (31/08) se perdeu exatamente assim, num unico "could not process file".
      if (!isRetriableProviderError(err) || attempt === MAX_ATTEMPTS) throw err
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
  return last!
}

/**
 * Manda o arquivo pro AssemblyAI e devolve o ID do trabalho, SEM esperar terminar.
 * Separado do poll de proposito: um audio de ~1 h nao termina dentro do tempo de UMA requisicao
 * de edge function, entao quem chama decide se espera (arquivo pequeno) ou se devolve o ID pro
 * cliente acompanhar (arquivo grande).
 */
async function assemblyStart(file: File, diarize: boolean): Promise<string | null> {
  if (!ASSEMBLYAI_API_KEY) return null
  const up = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_API_KEY },
    body: await file.arrayBuffer(),
  })
  if (!up.ok) return null
  const { upload_url } = await up.json()

  const tr = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, speaker_labels: diarize, language_code: 'pt' }),
  })
  if (!tr.ok) return null
  const { id } = await tr.json()
  return id ?? null
}

/** Le o estado de um trabalho do AssemblyAI (uma consulta, sem laco). */
async function assemblyFetch(id: string): Promise<Record<string, unknown> | null> {
  if (!ASSEMBLYAI_API_KEY) return null
  const p = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
    headers: { authorization: ASSEMBLYAI_API_KEY },
  })
  if (!p.ok) return null
  return await p.json()
}

/**
 * Texto final de um trabalho concluido.
 * BUG corrigido no passado: antes devolvia a STRING crua, mas o chamador le `result.text` --
 * vinha undefined e a nota saia com transcript undefined ("transcricao vazia" / crash no
 * cliente). Sempre devolver o objeto.
 */
function assemblyResult(data: Record<string, unknown>): { text: string; seconds: number } {
  const utterances = data.utterances as Array<{ speaker: string; text: string }> | undefined
  const text =
    Array.isArray(utterances) && utterances.length
      ? utterances.map((u) => `Falante ${u.speaker}: ${u.text}`).join('\n')
      : ((data.text as string) ?? '')
  return { text, seconds: Math.round(Number(data.audio_duration) || 0) }
}

async function assemblyDiarize(file: File): Promise<{ text: string; seconds: number } | null> {
  const id = await assemblyStart(file, true)
  if (!id) return null

  // poll (limite de ~140s; audios muito longos podem exceder -- por isso arquivo grande usa o
  // caminho assincrono, que devolve o ID em vez de esperar aqui)
  const start = Date.now()
  while (Date.now() - start < 140000) {
    await new Promise((r) => setTimeout(r, 3000))
    const data = await assemblyFetch(id)
    if (!data) continue
    if (data.status === 'completed') {
      return assemblyResult(data)
    }
    if (data.status === 'error') return null
  }
  return null // timeout -> fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let userId: string | null = null
  try {
    userId = await callerId(req)
    const guard = await checkBudget(userId)
    if (!guard.ok) return guardResponse(guard)

    // Consulta de um trabalho JA em andamento (arquivo grande, no AssemblyAI). O cliente chama
    // com ?job=<id> de tempos em tempos ate ficar pronto. E assim que um audio de ~1 h consegue
    // terminar: nenhuma requisicao fica aberta esperando, entao o limite de tempo da edge
    // function deixa de ser o teto da duracao do audio.
    const jobId = new URL(req.url).searchParams.get('job')
    if (jobId) {
      const data = await assemblyFetch(jobId)
      if (!data) {
        return new Response(JSON.stringify({ error: 'Não foi possível consultar a transcrição.' }), {
          status: 502,
          headers: { ...cors, 'content-type': 'application/json' },
        })
      }
      if (data.status === 'error') {
        await logAuditServer({
          severity: 'warning',
          category: 'user',
          source: 'edge:transcribe',
          message: `AssemblyAI falhou: ${String(data.error ?? '').slice(0, 300)}`,
          user_id: userId,
        })
        return new Response(
          JSON.stringify({ error: 'Não conseguimos transcrever este áudio. Tente outro arquivo ou formato.' }),
          { status: 422, headers: { ...cors, 'content-type': 'application/json' } },
        )
      }
      if (data.status !== 'completed') {
        return new Response(JSON.stringify({ status: 'processing' }), {
          headers: { ...cors, 'content-type': 'application/json' },
        })
      }
      const done = assemblyResult(data)
      // Cobranca so aqui: e neste ponto que o audio foi realmente processado.
      await logUsage({
        user_id: userId,
        provider: 'assemblyai',
        model: 'best',
        task: 'transcription',
        audio_seconds: done.seconds,
        cost_usd: done.seconds * (PRICE_PER_SEC.assemblyai ?? 0),
      })
      return new Response(JSON.stringify({ transcript: done.text, language: 'pt-BR' }), {
        headers: { ...cors, 'content-type': 'application/json' },
      })
    }

    const inForm = await req.formData()
    const file = inForm.get('file') as File
    if (!file) throw new Error('Arquivo de audio ausente.')
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      await logAuditServer({
        severity: 'warning',
        category: 'user',
        source: 'edge:transcribe',
        message: `Arquivo muito grande. Limite de ${MAX_FILE_MB} MB.`,
        detail: { bytes: file.size },
        user_id: userId,
      })
      return new Response(
        JSON.stringify({ error: `Arquivo muito grande. Limite de ${MAX_FILE_MB} MB.` }),
        { status: 413, headers: { ...cors, 'content-type': 'application/json' } },
      )
    }
    const diarize = inForm.get('diarize') === 'true'

    // Arquivo acima do limite do Whisper: mandar pra la so devolveria 413. Vai pro AssemblyAI e
    // devolve o ID pro cliente acompanhar, em vez de esperar aqui (audio longo nao termina
    // dentro de uma requisicao). Este e o caso do .m4a de reuniao: ~50 MB para ~54 min.
    if (file.size > WHISPER_MAX_MB * 1024 * 1024) {
      const id = await assemblyStart(file, diarize)
      if (id) {
        return new Response(JSON.stringify({ jobId: id }), {
          status: 202,
          headers: { ...cors, 'content-type': 'application/json' },
        })
      }
      // Sem ASSEMBLYAI_API_KEY (ou o upload falhou): segue pro Whisper mesmo assim. Ele deve
      // recusar com 413, e o catch la embaixo traduz para a mensagem de "muito grande" --
      // continua sendo um erro claro, nunca um erro cru.
      await logAuditServer({
        severity: 'warning',
        category: 'system',
        source: 'edge:transcribe',
        message: 'Arquivo grande sem caminho AssemblyAI disponivel; tentando Whisper mesmo assim.',
        detail: { bytes: file.size },
        user_id: userId,
      })
    }

    let result: { text: string; seconds: number } | null = null
    let provider = PROVIDER
    let model = PROVIDER === 'openai' ? 'whisper-1' : 'whisper-large-v3'

    if (diarize) {
      result = await assemblyDiarize(file)
      if (result) {
        provider = 'assemblyai'
        model = 'best+speaker_labels'
      }
    }
    if (result === null) result = await whisper(file) // fallback ou modo padrao

    await logUsage({
      user_id: userId,
      provider,
      model,
      task: 'transcription',
      audio_seconds: result.seconds,
      cost_usd: result.seconds * (PRICE_PER_SEC[provider] ?? 0),
    })

    if (result.seconds > MAX_AUDIO_SECONDS) {
      await logAuditServer({
        severity: 'warning',
        category: 'user',
        source: 'edge:transcribe',
        message: 'Audio acima do limite de 2 horas.',
        detail: { seconds: result.seconds },
        user_id: userId,
      })
      return new Response(
        JSON.stringify({ error: 'Audio acima do limite de 2 horas.' }),
        { status: 413, headers: { ...cors, 'content-type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ transcript: result.text, language: 'pt-BR' }), {
      headers: { ...cors, 'content-type': 'application/json' },
    })
  } catch (err) {
    const raw = String(err)
    // Provedor recusou pelo TAMANHO: o Groq aceita 25 MB por arquivo no tier gratuito e
    // 100 MB no pago -- MENOS que o MAX_FILE_MB daqui (60 MB), entao um arquivo pode passar
    // pela nossa barreira e morrer la. Sem este mapeamento o erro cru caia no fallback
    // generico "Falha ao processar. Tente novamente." sem dizer a causa (caso real:
    // m4a/3gp de 49 MB e 53 min, 2026-09-02). "muito grande" na mensagem casa com o
    // FRIENDLY do cliente (aiError) e evita log duplicado (ALREADY_LOGGED_SERVER).
    const tooLarge = /too large|entity too large|content size|file size|exceeds.*(size|limit)|\s413:\s/i.test(raw)
    if (tooLarge) {
      await logAuditServer({
        severity: 'warning',
        category: 'user',
        source: 'edge:transcribe',
        message: `Audio muito grande para o provedor: ${raw.slice(0, 300)}`,
        user_id: userId,
      })
      return new Response(
        JSON.stringify({
          error:
            'Este áudio é muito grande para o provedor de transcrição no plano atual. Comprima o arquivo (ex.: converta para MP3) ou fale com o administrador.',
        }),
        { status: 413, headers: { ...cors, 'content-type': 'application/json' } },
      )
    }
    // Provedor recusou o arquivo (formato/container que ele nao le, ou audio corrompido/vazio).
    // Devolve uma mensagem clara em vez do "groq 400: {...}" cru -- e marca como 'warning'/'user'
    // (e conteudo do usuario, nao uma falha do sistema).
    const invalidMedia = /could not process file|valid media file|invalid.*file|unsupported/i.test(raw)
    if (invalidMedia) {
      await logAuditServer({
        severity: 'warning',
        category: 'user',
        source: 'edge:transcribe',
        message: `Audio nao pode ser lido pelo provedor: ${raw.slice(0, 300)}`,
        user_id: userId,
      })
      return new Response(
        JSON.stringify({
          error:
            'Não conseguimos ler este áudio. Grave novamente (evite pausar/retomar em excesso) ou, se enviou um arquivo, tente outro formato (MP3, M4A, WAV, WEBM).',
        }),
        { status: 422, headers: { ...cors, 'content-type': 'application/json' } },
      )
    }
    await logAuditServer({
      severity: 'error',
      category: 'system',
      source: 'edge:transcribe',
      message: raw.slice(0, 500),
      user_id: userId,
    })
    return new Response(JSON.stringify({ error: raw }), {
      status: 500,
      headers: { ...cors, 'content-type': 'application/json' },
    })
  }
})
