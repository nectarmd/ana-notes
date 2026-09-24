// Processamento da gravacao DEPOIS que a nota ja existe (23/09/2026).
//
// Antes, a pessoa ficava presa na tela de gravacao ate transcricao e resumo terminarem. Quando um
// provedor falhava -- Groq recusando, creditos da Anthropic no fim --, ela via o relogio girando,
// clicava em parar de novo e achava que o app estava quebrado, mesmo com o audio salvo.
//
// Agora a nota nasce ao encerrar e o trabalho continua AQUI, fora da tela: quem gravou ja pode
// fechar a nota, abrir outra, gravar de novo. O andamento fica gravado NA PROPRIA NOTA
// (processing_stage / processing_error), entao a tela da nota explica o que esta acontecendo mesmo
// depois de fechar e abrir o app -- e nada depende de a pessoa ficar olhando.
//
// A gravacao pendente (IndexedDB) so e apagada quando a nota fica pronta: enquanto houver erro, o
// audio continua no aparelho e o trabalho pode ser retomado.

import { db } from './api'
import {
  deletePendingRecording,
  getPendingRecordingBlob,
  listPendingRecordings,
  saveAudio,
  type PendingRecordingMeta,
} from './audioStore'
import {
  generateSummary,
  generateSummaryAndItems,
  identifySpeakers,
  transcribeAudio,
} from './ai'
import { hasSpeakers, mergeAutoNames, NOTE_CHANGED_EVENT, type NoteSpeakers } from './speakers'
import { logSilentError } from './auditLog'
import { describeUnknownError } from './errorMessage'
import type { Note } from './types'

/** Avisa a interface que a fila mudou (tela inicial e tela da nota escutam). */
export const JOBS_CHANGED_EVENT = 'ana:jobs-changed'

export type JobStage = 'transcribing' | 'summarizing'

export interface NoteJobInput {
  noteId: string
  pendingKey: string
  userId: string
  title: string
  meta: Pick<PendingRecordingMeta, 'diarize' | 'template' | 'context' | 'skipAudioStore' | 'skipActionItems'>
}

interface JobEmAndamento {
  noteId: string
  title: string
  stage: JobStage
}

const fila: NoteJobInput[] = []
let atual: JobEmAndamento | null = null
let rodando = false

function avisar(): void {
  window.dispatchEvent(new Event(JOBS_CHANGED_EVENT))
}

function avisarNota(noteId: string): void {
  window.dispatchEvent(new CustomEvent(NOTE_CHANGED_EVENT, { detail: noteId }))
}

/** Job em execucao agora (para a barra "processando" na tela inicial). */
export function jobAtual(): JobEmAndamento | null {
  return atual
}

/** Quantas gravacoes estao na fila, incluindo a que roda agora. */
export function totalNaFila(): number {
  return fila.length + (atual ? 1 : 0)
}

export function estaNaFila(noteId: string): boolean {
  return atual?.noteId === noteId || fila.some((j) => j.noteId === noteId)
}

export function enfileirarNota(job: NoteJobInput): void {
  if (estaNaFila(job.noteId)) return
  fila.push(job)
  avisar()
  void girar()
}

async function girar(): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    while (fila.length) {
      const job = fila.shift()!
      atual = { noteId: job.noteId, title: job.title, stage: 'transcribing' }
      avisar()
      await processar(job)
      atual = null
      avisar()
    }
  } finally {
    rodando = false
  }
}

function mudarEtapa(stage: JobStage): void {
  if (atual) {
    atual = { ...atual, stage }
    avisar()
  }
}

/** Mensagem curta e humana para mostrar na nota (o detalhe tecnico vai para o audit_log). */
function mensagemDeFalha(err: unknown): string {
  const bruto = describeUnknownError(err)
  if (!bruto) return 'Não conseguimos concluir o processamento.'
  return bruto.length > 300 ? `${bruto.slice(0, 297)}...` : bruto
}

async function processar(job: NoteJobInput): Promise<void> {
  let note: Note | null = null
  try {
    note = await db.getNote(job.noteId)
    // Nota apagada enquanto esperava na fila: nao ha o que concluir, e o audio pendente segue no
    // aparelho (quem apaga a nota nao perde a gravacao).
    if (!note) return

    const blob = await getPendingRecordingBlob(job.pendingKey)

    // ---- 1. Transcricao ------------------------------------------------------------------
    if (!note.transcript?.trim()) {
      if (!blob || !blob.size) {
        throw new Error('O áudio desta gravação não está mais neste computador. Ele fica salvo apenas no aparelho que gravou.')
      }
      mudarEtapa('transcribing')
      await db.updateNote(note.id, { processing_stage: 'transcribing', processing_error: null })
      avisarNota(note.id)
      const res = await transcribeAudio(blob, { diarize: job.meta.diarize })
      note = await db.updateNote(note.id, {
        transcript: res.transcript ?? '',
        language: res.language ?? 'pt-BR',
      })
      avisarNota(note.id)
    }

    // ---- 2. Audio no armazenamento ------------------------------------------------------
    // Fora do caminho critico: se falhar, a nota continua sendo concluida (o audio segue no
    // aparelho). Foi o que faltou em 16/09/2026, quando 11 notas ficaram sem audio na nuvem.
    if (blob && !job.meta.skipAudioStore && !note.audio_url) {
      try {
        const ref = await saveAudio(note.id, job.userId, blob)
        if (ref) note = await db.updateNote(note.id, { audio_url: ref })
      } catch (err) {
        logSilentError('client:noteJobs.saveAudio', err)
      }
    }

    // ---- 3. Resumo e itens de acao ------------------------------------------------------
    if (note.status !== 'ready') {
      mudarEtapa('summarizing')
      await db.updateNote(note.id, { processing_stage: 'summarizing', processing_error: null })
      avisarNota(note.id)

      const meta = { template: job.meta.template, context: job.meta.context }
      // Nomes dos falantes EM PARALELO com o resumo (leva de 5 a 40 s e nao pode atrasar a nota).
      const nomes: Promise<NoteSpeakers | null> =
        hasSpeakers(note.transcript) && !note.speakers?.checked_at
          ? identifySpeakers(note.transcript)
              .then((auto) => mergeAutoNames(note?.speakers, auto))
              .catch((err) => {
                logSilentError('client:noteJobs.identifySpeakers', err)
                return null
              })
          : Promise.resolve(null)

      let summary = ''
      let actionItems: Note['action_items'] = []
      if (!job.meta.skipActionItems) {
        const r = await generateSummaryAndItems(note.transcript, meta)
        summary = r.summary
        actionItems = r.actionItems
      } else {
        summary = await generateSummary(note.transcript, meta)
      }

      const cedo = await Promise.race([
        nomes,
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 6000)),
      ])
      note = await db.updateNote(note.id, {
        summary,
        action_items: actionItems,
        status: 'ready',
        processing_stage: null,
        processing_error: null,
        ...(cedo ? { speakers: cedo } : {}),
      })
      // Nomes que chegarem depois do prazo entram sem segurar a nota.
      if (cedo === undefined) {
        const noteId = note.id
        void nomes.then(async (tarde) => {
          if (!tarde) return
          try {
            await db.updateNote(noteId, { speakers: tarde })
            avisarNota(noteId)
          } catch (err) {
            logSilentError('client:noteJobs.speakersTarde', err)
          }
        })
      }
    }

    // Concluida: a rede de seguranca no aparelho nao e mais necessaria.
    await deletePendingRecording(job.pendingKey)
    avisarNota(note.id)
  } catch (err) {
    logSilentError('client:noteJobs', err)
    // Tenta de novo sozinho: quase toda falha aqui e provedor fora do ar por alguns minutos
    // (Groq recusando por limite, creditos no fim, rede oscilando). Duas tentativas espacadas
    // resolvem a maioria sem a pessoa precisar fazer nada -- e, se o app for fechado antes,
    // retomarPendentes() recomeca na proxima abertura.
    const jaTentou = (note?.processing_attempts ?? 0) + 1
    if (jaTentou < 3) {
      const espera = jaTentou === 1 ? 60_000 : 5 * 60_000
      setTimeout(() => enfileirarNota(job), espera)
    }
    try {
      await db.updateNote(job.noteId, {
        processing_error: mensagemDeFalha(err),
        processing_attempts: (note?.processing_attempts ?? 0) + 1,
      })
      avisarNota(job.noteId)
    } catch (err2) {
      logSilentError('client:noteJobs.marcarErro', err2)
    }
  }
}

/** Esta nota ainda tem a gravacao guardada NESTE aparelho? So entao da para tentar de novo. */
export function temGravacaoLocal(noteId: string): boolean {
  return listPendingRecordings().some((p) => p.meta.noteId === noteId)
}

/**
 * "Tentar de novo" da tela da nota. A tentativa automatica para na terceira; daqui em diante quem
 * decide e a pessoa, e o contador zera para que as automaticas valham de novo.
 *
 * Devolve false quando a gravacao nao esta mais neste aparelho (outro computador, ou navegador
 * limpo) -- nesse caso a tela nem mostra o botao.
 */
export async function retomarNota(noteId: string, userId: string): Promise<boolean> {
  const alvo = listPendingRecordings().find((p) => p.meta.noteId === noteId)
  if (!alvo) return false
  if (estaNaFila(noteId)) return true
  const note = await db.getNote(noteId)
  if (!note) return false
  await db.updateNote(noteId, { processing_error: null, processing_attempts: 0, processing_stage: 'transcribing', status: 'processing' })
  avisarNota(noteId)
  enfileirarNota({
    noteId,
    pendingKey: alvo.key,
    userId,
    title: note.title,
    meta: {
      diarize: alvo.meta.diarize,
      template: alvo.meta.template,
      context: alvo.meta.context,
      skipAudioStore: alvo.meta.skipAudioStore,
      skipActionItems: alvo.meta.skipActionItems,
    },
  })
  return true
}

/**
 * Quanto tempo uma nota precisa ficar parada antes de valer a pena retomar.
 *
 * O banco atualiza updated_at a cada mexida (gatilho touch_updated_at), entao uma nota tocada ha
 * pouco quer dizer que ALGUEM esta trabalhando nela agora -- outra aba aberta, ou esta mesma
 * sessao antes de um F5. Retomar nessa hora manda transcrever de novo o mesmo audio e paga duas
 * vezes pela mesma gravacao. Melhor esperar e conferir de novo.
 */
const PARADA_MS = 3 * 60_000

/** Alguem mexeu nesta nota agora ha pouco? */
function recemMexida(note: Note): boolean {
  const t = Date.parse(note.updated_at ?? '')
  return Number.isFinite(t) && Date.now() - t < PARADA_MS
}

let reconferirAgendado = false

/**
 * Retoma sozinho o que ficou pela metade (app fechado no meio, computador desligado): para cada
 * gravacao guardada neste aparelho que ja tem nota, se a nota ainda nao esta pronta, volta para a
 * fila.
 *
 * Roda ao abrir o app, em qualquer tela (AppShell) -- quem reabre o app cai na tela inicial, nao
 * na de gravacao. Nota mexida ha menos de PARADA_MS fica para a proxima conferida, salvo se ja
 * registrou erro (ai ninguem esta trabalhando nela mesmo).
 */
export async function retomarPendentes(userId: string): Promise<void> {
  let faltouAlguma = false
  for (const { key, meta } of listPendingRecordings()) {
    if (!meta.noteId) continue
    try {
      const note = await db.getNote(meta.noteId)
      if (!note || note.status === 'ready') continue
      if (!note.processing_error && recemMexida(note)) {
        faltouAlguma = true
        continue
      }
      enfileirarNota({
        noteId: note.id,
        pendingKey: key,
        userId,
        title: note.title,
        meta: {
          diarize: meta.diarize,
          template: meta.template,
          context: meta.context,
          skipAudioStore: meta.skipAudioStore,
          skipActionItems: meta.skipActionItems,
        },
      })
    } catch (err) {
      logSilentError('client:noteJobs.retomar', err)
    }
  }
  // Tinha nota mexida ha pouco: confere de novo mais tarde, sem depender de a pessoa recarregar.
  if (faltouAlguma && !reconferirAgendado) {
    reconferirAgendado = true
    setTimeout(() => {
      reconferirAgendado = false
      void retomarPendentes(userId)
    }, PARADA_MS)
  }
}
