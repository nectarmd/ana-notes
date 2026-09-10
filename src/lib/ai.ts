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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * O supabase-js embrulha erros HTTP e esconde o corpo. Os freios de gasto (429/503) e os
 * limites de tamanho (413) respondem `{ error: "mensagem para o usuario" }` — sem ler o
 * corpo, o usuario veria apenas "Edge Function returned a non-2xx status code".
 */
async function unwrapError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = await ctx.clone().json()
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
  const inicio = Date.now()
  while (Date.now() - inicio < LIMITE_MS) {
    await delay(INTERVALO_MS)
    const { data, error } = await supabase!.functions.invoke(`transcribe?job=${encodeURIComponent(jobId)}`, {
      method: 'GET',
    })
    if (error) throw await unwrapError(error)
    const r = data as { transcript?: string; language?: string; status?: string }
    if (typeof r?.transcript === 'string') return { transcript: r.transcript, language: r.language ?? 'pt-BR' }
    const minutos = Math.round((Date.now() - inicio) / 60000)
    onProgress?.(
      minutos < 1
        ? 'Áudio grande: a transcrição está em andamento...'
        : `Áudio grande: transcrevendo há ${minutos} min...`,
    )
  }
  throw new Error(
    'A transcrição deste áudio está demorando mais que o esperado. O áudio continua salvo neste aparelho — tente novamente em alguns minutos.',
  )
}

export async function transcribeAudio(
  audio: Blob,
  opts: { diarize?: boolean; onProgress?: (mensagem: string) => void } = {},
): Promise<{ transcript: string; language: string }> {
  if (config.mockMode) {
    await delay(opts.diarize ? 1800 : 1200)
    return { transcript: opts.diarize ? mockDiarizedTranscript() : mockTranscript(), language: 'pt-BR' }
  }
  const form = new FormData()
  const filename = audioFilename(audio)
  form.append('file', audio, filename)
  if (opts.diarize) form.append('diarize', 'true')
  // Edge function reads multipart and forwards to the transcription provider.
  if (!supabase) throw new Error('Supabase nao configurado')
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
export async function askHelp(question: string, lang: 'pt' | 'en' | 'es' = 'pt'): Promise<string> {
  const { searchHelp, HELP_KB_TEXT } = await import('./helpKb')
  if (lang === 'pt') {
    const local = searchHelp(question)
    if (local) return local.a // resposta gratuita da base
  }
  if (config.mockMode) {
    await delay(500)
    const msg: Record<string, string> = {
      pt: 'Só consigo ajudar com dúvidas sobre o uso do aplicativo. Tente perguntar sobre gravar, transcrever, compartilhar, pastas, discador ou configurações.',
      en: 'I can only help with questions about using the app. Try asking about recording, transcribing, sharing, folders, the dialer or settings.',
      es: 'Solo puedo ayudar con dudas sobre el uso de la app. Prueba a preguntar sobre grabar, transcribir, compartir, carpetas, el marcador o los ajustes.',
    }
    return msg[lang] ?? msg.pt
  }
  const r = await invoke<{ answer: string }>('ai', { task: 'help', question, kb: HELP_KB_TEXT, lang })
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
