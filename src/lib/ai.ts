// AI service facade. In mock mode uses the offline generators; in real mode
// invokes Supabase Edge Functions (which hold the API keys server-side).
//
// Model routing (real mode, handled inside the edge function):
//   - summary        -> claude-haiku-4-5   (rapido/barato)
//   - detailed       -> claude-sonnet-5    (resumo detalhado inteligente)
//   - analysis       -> claude-sonnet-5    (analise de reuniao)
//   - chat           -> claude-haiku-4-5
//   - transcription  -> Whisper large-v3 (provedor configurado)

import { config } from './config'
import { logClientError } from './auditLog'
import { supabase } from './supabase'
import {
  mockAnalysis,
  mockActionItems,
  mockChatReply,
  mockDetailed,
  mockFeedback,
  mockSummary,
  mockTranscript,
  mockDiarizedTranscript,
  mockAskAll,
  mockMindMap,
} from './aiMock'
import type { ActionItem, MeetingAnalysis, MindMap } from './types'
import type { PreparedImage } from './image'
import type { SpeakerEvidence } from './speakers'
import { AppError, assertNoAdminCooldown } from './appError'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * O supabase-js embrulha erros HTTP e esconde o corpo. O servidor responde
 * `{ error, code, adminOnly, retryAfterSec }` (catalogo em _shared/errors.ts) — sem ler o corpo,
 * o usuario veria apenas "Edge Function returned a non-2xx status code".
 */
async function unwrapError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = await ctx.clone().json()
      if (body?.error && typeof body.code === 'string') {
        return new AppError(
          String(body.error),
          body.code,
          body.adminOnly === true,
          typeof body.retryAfterSec === 'number' ? body.retryAfterSec : null,
        )
      }
      if (body?.error) return new Error(String(body.error))
    } catch {
      /* corpo nao era JSON */
    }
    // Sem `{ error }` legivel: preserva status + corpo cru em vez de deixar o supabase-js
    // devolver so "Edge Function returned a non-2xx status code". Isso e o que torna
    // diagnosticavel um erro do gateway/plataforma (ex.: 413 payload grande) no log de auditoria,
    // em vez de virar uma mensagem generica sem pista nenhuma.
    try {
      const status = ctx.status
      const text = (await ctx.clone().text()).slice(0, 300).trim()
      if (status || text) return new Error(`HTTP ${status || '?'}${text ? `: ${text}` : ''}`)
    } catch {
      /* corpo ilegivel */
    }
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase nao configurado')
  // Problema que so o administrador resolve ainda em cooldown: falha aqui, sem ir ao servidor.
  assertNoAdminCooldown()
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) throw await unwrapError(error)
  return data as T
}

/**
 * O Whisper (Groq/OpenAI) detecta o formato do audio pela EXTENSAO do nome do arquivo. Uma
 * gravacao e um Blob sem `.name`, e antes o codigo mandava tudo como "audio.webm" -- mas o
 * MediaRecorder do iOS Safari (e de qualquer navegador sem suporte a webm) grava em audio/mp4.
 * Um arquivo mp4 chamado "audio.webm" o provedor rejeita com "could not process file - is it a
 * valid media file?" (erro real do Henrique e da Aline). Aqui derivamos a extensao do MIME real
 * do blob, pra o nome bater com o conteudo. Uploads de arquivo (com `.name` de verdade) mantem
 * o proprio nome.
 */
function audioFilename(audio: Blob): string {
  const named = (audio as File).name
  if (named) return named
  const type = (audio.type || '').split(';')[0].trim().toLowerCase()
  const ext =
    type === 'audio/mp4' || type === 'video/mp4'
      ? 'mp4'
      : type === 'audio/mpeg'
        ? 'mp3'
        : type === 'audio/ogg'
          ? 'ogg'
          : type === 'audio/wav' || type === 'audio/x-wav'
            ? 'wav'
            : type === 'audio/aac'
              ? 'aac'
              : 'webm'
  return `audio.${ext}`
}

/**
 * Arquivo grande (acima do limite do Whisper) e transcrito pelo AssemblyAI de forma ASSINCRONA:
 * a primeira chamada devolve so um `jobId`, porque um audio de ~1 h nao termina dentro do tempo
 * de uma unica requisicao. Aqui acompanhamos ate ficar pronto.
 *
 * O teto de 30 min existe so para a tela nunca ficar presa para sempre se o trabalho travar do
 * lado do provedor -- ele processa bem mais rapido que o tempo real, entao mesmo um audio de 2 h
 * termina com folga.
 */
async function acompanharTranscricao(
  jobId: string,
  onProgress?: (mensagem: string) => void,
): Promise<{ transcript: string; language: string }> {
  const LIMITE_MS = 30 * 60 * 1000
  const INTERVALO_MS = 5000
  // Uma consulta que falha (rede do celular oscilando, provedor lento para responder o status) nao
  // pode jogar fora uma transcricao de 1 h ja em andamento. So desiste apos falhas SEGUIDAS.
  const MAX_FALHAS_SEGUIDAS = 6
  const inicio = Date.now()
  let falhas = 0
  onProgress?.('A transcrição está em andamento...')
  while (Date.now() - inicio < LIMITE_MS) {
    await delay(INTERVALO_MS)
    const { data, error } = await supabase!.functions.invoke(`transcribe?job=${encodeURIComponent(jobId)}`, {
      method: 'GET',
    })
    if (error) {
      const err = await unwrapError(error)
      const transitorio =
        !(err instanceof AppError) || err.code === 'TRANSCRIBE_JOB_UNREACHABLE'
      if (transitorio && ++falhas < MAX_FALHAS_SEGUIDAS) continue
      throw err
    }
    falhas = 0
    const r = data as { transcript?: string; language?: string; status?: string }
    if (typeof r?.transcript === 'string') return { transcript: r.transcript, language: r.language ?? 'pt-BR' }
    const minutos = Math.floor((Date.now() - inicio) / 60000)
    onProgress?.(
      minutos < 1 ? 'A transcrição está em andamento...' : `Transcrevendo há ${minutos} min — áudios longos levam alguns minutos.`,
    )
  }
  throw new Error(
    'A transcrição deste áudio está demorando mais que o esperado. O áudio continua salvo neste aparelho — tente novamente em alguns minutos.',
  )
}

/** SHA-256 em hexadecimal de um blob ou texto (Web Crypto, sem dependencia). */
export async function sha256Hex(input: Blob | string): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : await input.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * O arquivo comeca com um cabecalho que algum decodificador reconhece?
 *
 * Um Blob de gravacao que perdeu o primeiro pedaco (era o que acontecia quando dois gravadores
 * rodavam juntos, ver useRecorder) vira bytes sem formato: o Groq responde "could not process
 * file" e o AssemblyAI ve "application/octet-stream (data)". Repetir o envio nunca resolve --
 * melhor dizer isso de cara do que deixar o usuario tentando (a Larissa tentou 5 vezes em 2
 * minutos em 23/09/2026).
 */
async function temCabecalhoDeMidia(blob: Blob): Promise<boolean> {
  try {
    const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
    if (h.length < 4) return false
    const texto = (i: number, n: number) => String.fromCharCode(...h.slice(i, i + n))
    if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return true // WebM/Matroska
    if (texto(4, 4) === 'ftyp') return true // MP4/M4A/MOV
    if (['OggS', 'RIFF', 'fLaC', 'FORM'].includes(texto(0, 4))) return true // Ogg, WAV, FLAC, AIFF
    if (texto(0, 3) === 'ID3') return true // MP3 com tag
    if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return true // quadro MPEG (mp3/aac solto)
    return false
  } catch {
    return true // na duvida, deixa o servidor decidir: nunca barrar audio bom
  }
}

export async function transcribeAudio(
  audio: Blob,
  opts: { diarize?: boolean; onProgress?: (mensagem: string) => void } = {},
): Promise<{ transcript: string; language: string }> {
  if (config.mockMode) {
    await delay(opts.diarize ? 1800 : 1200)
    return { transcript: opts.diarize ? mockDiarizedTranscript() : mockTranscript(), language: 'pt-BR' }
  }
  if (!(await temCabecalhoDeMidia(audio))) {
    logClientError({
      severity: 'error',
      category: 'system',
      source: 'client:transcribeAudio',
      code: 'RECORDER_FILE_CORRUPTED',
      message: 'Arquivo de áudio sem cabeçalho reconhecível: envio bloqueado antes de chamar o provedor.',
      detail: { bytes: audio.size, type: audio.type || null },
    })
    throw new Error(
      'Não conseguimos ler este áudio: o arquivo da gravação ficou danificado (perdeu o início). ' +
        'Tentar de novo não resolve. Use "Baixar áudio" no card da gravação e envie para o suporte.',
    )
  }
  const form = new FormData()
  const filename = audioFilename(audio)
  form.append('file', audio, filename)
  if (opts.diarize) form.append('diarize', 'true')
  // Impressao digital do arquivo: se o MESMO audio chegar de novo (retentativa, segunda aba), o
  // servidor devolve a transcricao ja feita sem pagar outra vez. Sem ela, o servidor calcula.
  const hash = await sha256Hex(audio).catch(() => null)
  if (hash) form.append('sha256', hash)
  // Edge function reads multipart and forwards to the transcription provider.
  if (!supabase) throw new Error('Supabase nao configurado')
  assertNoAdminCooldown()
  const { data, error } = await supabase.functions.invoke('transcribe', { body: form })
  if (error) throw await unwrapError(error)
  const resposta = data as { transcript?: string; language?: string; jobId?: string }
  // Arquivo pequeno: ja veio transcrito. Arquivo grande: veio um ID para acompanhar.
  if (resposta?.jobId) return acompanharTranscricao(resposta.jobId, opts.onProgress)
  return resposta as { transcript: string; language: string }
}

export interface AiMeta {
  template?: string
  context?: string
}

/** Le e resume uma imagem (inclusive texto fotografado/escaneado), com tamanho delimitado. */
export async function summarizeImage(
  image: PreparedImage,
  opts: { maxWords?: number; context?: string } = {},
): Promise<string> {
  if (config.mockMode) {
    await delay(900)
    return '## Descricao\n\nModo demo: a leitura de imagens exige o backend configurado.'
  }
  const r = await invoke<{ summary: string }>('ai', {
    task: 'image',
    image: { media_type: image.media_type, data: image.data },
    maxWords: opts.maxWords ?? 150,
    context: opts.context,
  })
  return r.summary
}

export async function generateSummary(transcript: string, meta: AiMeta = {}): Promise<string> {
  if (config.mockMode) {
    await delay(700)
    return mockSummary(transcript)
  }
  const r = await invoke<{ summary: string }>('ai', { task: 'summary', transcript, ...meta })
  return r.summary
}

/**
 * Resumo e itens de acao numa chamada so (desde 17/09/2026). O servidor le a transcricao uma vez
 * em vez de duas -- 17% a 22% mais barato em reunioes medias e longas, com a mesma qualidade.
 */
export async function generateSummaryAndItems(
  transcript: string,
  meta: AiMeta = {},
): Promise<{ summary: string; actionItems: ActionItem[] }> {
  if (config.mockMode) {
    await delay(900)
    return { summary: mockSummary(transcript), actionItems: mockActionItems(transcript) }
  }
  return invoke<{ summary: string; actionItems: ActionItem[] }>('ai', { task: 'summary_items', transcript, ...meta })
}

/**
 * Nomes reais dos falantes ("Falante A" -> "Carla"), so quando a conversa prova: a pessoa se
 * apresenta, ou alguem a chama pelo nome e ela responde na fala seguinte. O servidor confere cada
 * prova no texto; o que nao passar fica como "Falante X". Rotulos sem nome nao voltam.
 */
export async function identifySpeakers(
  transcript: string,
): Promise<Record<string, { name: string; evidence: SpeakerEvidence[] }>> {
  if (config.mockMode) {
    await delay(600)
    return {}
  }
  const r = await invoke<{ names: Record<string, { name: string; evidence: SpeakerEvidence[] }> }>('ai', {
    task: 'identify_speakers',
    transcript,
  })
  return r.names ?? {}
}

export async function generateDetailed(transcript: string, meta: AiMeta = {}): Promise<string> {
  if (config.mockMode) {
    await delay(1200)
    return mockDetailed(transcript)
  }
  const r = await invoke<{ detailed: string }>('ai', { task: 'detailed', transcript, ...meta })
  return r.detailed
}

export async function generateActionItems(transcript: string, meta: AiMeta = {}): Promise<ActionItem[]> {
  if (config.mockMode) {
    await delay(500)
    return mockActionItems(transcript)
  }
  const r = await invoke<{ actionItems: ActionItem[] }>('ai', { task: 'action_items', transcript, ...meta })
  return r.actionItems
}

/**
 * Uma analise so "existe" se tiver algum conteudo. Quando a IA devolve texto que nao da para
 * parsear, sobra um objeto com campos vazios: ele e truthy, entao a tela mostraria uma aba em
 * branco e nunca mais ofereceria o botao de gerar. Aqui um objeto vazio conta como ausente.
 */
export function hasAnalysis(a: MeetingAnalysis | null | undefined): a is MeetingAnalysis {
  if (!a) return false
  const lists = [a.strengths, a.improvements, a.questionsAsked, a.suggestedQuestions, a.keyPoints, a.risks]
  return (
    typeof a.overallScore === 'number' ||
    !!a.tone?.trim() ||
    !!a.pacing?.trim() ||
    lists.some((l) => Array.isArray(l) && l.some((s) => !!s?.trim()))
  )
}

/** Mesmo criterio do `hasAnalysis`: mapa sem nenhum ramo e um mapa que nao foi gerado. */
export function hasMindMap(m: MindMap | null | undefined): m is MindMap {
  return !!m && Array.isArray(m.branches) && m.branches.length > 0
}

export async function generateAnalysis(transcript: string, meta: AiMeta = {}): Promise<MeetingAnalysis> {
  if (config.mockMode) {
    await delay(1400)
    return mockAnalysis(transcript)
  }
  const r = await invoke<{ analysis: MeetingAnalysis }>('ai', { task: 'analysis', transcript, ...meta })
  return r.analysis
}

/** Assistente de ajuda: responde SO sobre o uso do app. Em pt tenta a base local (gratis)
 *  antes da IA; em outros idiomas vai direto na IA (que responde no idioma do usuario). */
export async function askHelp(
  question: string,
  lang: 'pt' | 'en' | 'es' = 'pt',
  /** Ultimas mensagens da conversa, para a ANA entender perguntas encadeadas ("e no celular?"). */
  history: { role: string; content: string }[] = [],
): Promise<string> {
  const { searchHelp, HELP_KB_TEXT } = await import('./helpKb')
  // A base local so responde direto quando a pergunta se explica sozinha: no meio de uma conversa
  // ela ignoraria o contexto e responderia outra coisa.
  if (lang === 'pt' && history.length === 0) {
    const local = searchHelp(question)
    if (local) return local.a // resposta gratuita da base
  }
  if (config.mockMode) {
    await delay(500)
    const msg: Record<string, string> = {
      pt: 'Só consigo ajudar com dúvidas sobre o uso do aplicativo. Tente perguntar sobre gravar, transcrever, compartilhar, pastas, tarefas ou configurações.',
      en: 'I can only help with questions about using the app. Try asking about recording, transcribing, sharing, folders, tasks or settings.',
      es: 'Solo puedo ayudar con dudas sobre el uso de la app. Prueba a preguntar sobre grabar, transcribir, compartir, carpetas, tareas o los ajustes.',
    }
    return msg[lang] ?? msg.pt
  }
  const r = await invoke<{ answer: string }>('ai', {
    task: 'help',
    question,
    kb: HELP_KB_TEXT,
    lang,
    history: history.slice(-6),
  })
  return r.answer
}

export async function translateText(text: string, target: string): Promise<string> {
  if (config.mockMode) {
    await delay(700)
    return `[${target}]\n${text}`
  }
  const r = await invoke<{ text: string }>('ai', { task: 'translate', text, target })
  return r.text
}

export async function generateMindMap(transcript: string, meta: AiMeta = {}): Promise<MindMap> {
  if (config.mockMode) {
    await delay(900)
    return mockMindMap(transcript)
  }
  const r = await invoke<{ mindmap: MindMap }>('ai', { task: 'mindmap', transcript, ...meta })
  return r.mindmap
}

export type FeedbackAudience = 'cliente' | 'candidato' | 'colega' | 'outro'
export type FeedbackTone = 'serio' | 'descontraido' | 'formal' | 'informal'

export async function generateFeedback(
  transcript: string,
  opts: { audience: FeedbackAudience; customLabel?: string; tone: FeedbackTone },
): Promise<string> {
  const { audience, customLabel, tone } = opts
  if (config.mockMode) {
    await delay(1000)
    return mockFeedback(transcript, audience)
  }
  const r = await invoke<{ feedback: string }>('ai', {
    task: 'feedback',
    transcript,
    audience,
    customLabel: customLabel ?? '',
    tone,
  })
  return r.feedback
}

export interface NoteDigest {
  title: string
  created_at: string
  summary: string
}

/** Busca semantica: pergunta em linguagem natural sobre TODAS as notas. */
export async function askAllNotes(question: string, notes: NoteDigest[]): Promise<string> {
  if (config.mockMode) {
    await delay(800)
    return mockAskAll(question, notes)
  }
  const digest = notes
    .slice(0, 80)
    .map((n) => ({ title: n.title, date: n.created_at, summary: n.summary }))
  const r = await invoke<{ answer: string }>('ai', { task: 'search', question, notes: digest })
  return r.answer
}

export async function chatWithNote(
  question: string,
  transcript: string,
  history: { role: string; content: string }[],
  summary = '',
): Promise<string> {
  if (config.mockMode) {
    await delay(600)
    return mockChatReply(question, transcript)
  }
  // `summary` so e usado quando o transcript passa do limite: aí a edge function manda
  // resumo + trechos, em vez de reenviar o texto inteiro a cada pergunta.
  const r = await invoke<{ reply: string }>('ai', { task: 'chat', question, transcript, history, summary })
  return r.reply
}
