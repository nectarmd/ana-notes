// Armazenamento das gravacoes de audio.
//   - Modo real  : Supabase Storage (bucket privado "recordings"), com URL assinada.
//   - Modo demo  : IndexedDB do navegador (persiste entre recarregamentos, sem backend).
// A nota guarda apenas uma REFERENCIA (audio_url); o binario fica no armazenamento.

import { config } from './config'
import { supabase } from './supabase'
import { audioContentType } from './mediaKind'
import { saveFile, type SaveResult } from './saveFile'
import { logSilentError } from './auditLog'

const DB_NAME = 'tailor-audio'
const STORE = 'blobs'
const BUCKET = 'recordings'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet(key: string): Promise<Blob | null> {
  const db = await openIdb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return blob
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb()
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

/** Salva o audio e retorna a referencia a guardar em note.audio_url. */
export async function saveAudio(noteId: string, userId: string, blob: Blob): Promise<string | null> {
  if (!blob || blob.size === 0) return null
  if (config.mockMode) {
    try {
      await idbPut(noteId, blob)
      return `idb:${noteId}`
    } catch {
      return null
    }
  }
  if (!supabase) return null
  const path = `${userId}/${noteId}.webm`
  // audioContentType: .m4a no Windows chega com type vazio; content-type errado (webm)
  // atrapalha o player. O caminho segue .webm por compatibilidade com a retencao/policies.
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: audioContentType(blob), upsert: true })
  return error ? null : path
}

/** Resolve uma URL tocavel a partir da referencia salva. */
export async function getAudioUrl(ref: string | null): Promise<string | null> {
  if (!ref) return null
  if (ref.startsWith('idb:')) {
    const blob = await idbGet(ref.slice(4))
    return blob ? URL.createObjectURL(blob) : null
  }
  if (ref.startsWith('http')) return ref
  if (!supabase) return null
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(ref, 3600)
  return data?.signedUrl ?? null
}

export interface DownloadAudioResult {
  /** Como o arquivo chegou ao usuario ('opened' = caiu no fallback de abrir o link). */
  saved: SaveResult | 'opened'
  /** Pediu MP3 mas a conversao falhou: foi entregue o formato original. */
  mp3Failed: boolean
}

/**
 * Baixa o arquivo de audio para o dispositivo do usuario. Com `mp3`, converte antes (ver mp3.ts);
 * se a conversao falhar (aparelho sem memoria, formato que o navegador nao decodifica), entrega o
 * original em vez de nao entregar nada.
 */
export async function downloadAudio(
  ref: string | null,
  filename: string,
  opts: { mp3?: boolean; onProgress?: (pct: number) => void } = {},
): Promise<DownloadAudioResult | null> {
  const url = await getAudioUrl(ref)
  if (!url) return null
  let blob: Blob
  try {
    blob = await (await fetch(url)).blob()
  } catch {
    // fallback: abre em nova aba
    window.open(url, '_blank')
    return { saved: 'opened', mp3Failed: false }
  }
  let mp3Failed = false
  if (opts.mp3) {
    try {
      const { toMp3 } = await import('./mp3')
      blob = await toMp3(blob, opts.onProgress)
    } catch (err) {
      mp3Failed = true
      logSilentError('client:downloadAudio.mp3', err)
    }
  }
  // A gravacao pode ser m4a (APK Android), mp3, wav... o nome segue o formato real.
  const ext = AUDIO_EXT[blob.type.split(';')[0]]
  const saved = await saveFile(blob, ext ? filename.replace(/\.[a-z0-9]+$/i, '') + ext : filename)
  return { saved, mp3Failed }
}

const AUDIO_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
}

export async function deleteAudio(ref: string | null): Promise<void> {
  if (!ref) return
  if (ref.startsWith('idb:')) return idbDelete(ref.slice(4))
  if (supabase && !ref.startsWith('http')) {
    await supabase.storage.from(BUCKET).remove([ref])
  }
}

/**
 * Rede de seguranca para gravacoes: guarda o audio no IndexedDB do proprio navegador ANTES
 * de qualquer chamada de rede (transcricao/IA/criar nota). Se o processamento falhar no meio
 * do caminho, a gravacao continua recuperavel — sempre no IndexedDB local, independente do
 * modo (mock ou real), porque isto e so uma rede de seguranca, nao o armazenamento final.
 */
const PENDING_PREFIX = 'pending:'

export interface PendingRecordingMeta {
  mode: string
  type: string
  title: string
  template: string
  context: string
  diarize: boolean
  duration: number
  fallbackTitle: string
  skipAudioStore: boolean
  skipActionItems: boolean
  savedAt: string
  /**
   * Nota ja criada para esta gravacao (a transcricao deu certo, a IA falhou depois). Sem isto,
   * retomar a pendencia criava OUTRA nota com a mesma transcricao: a Larissa ficou com tres notas
   * identicas em 16/09/2026 quando os creditos da Anthropic acabaram.
   */
  noteId?: string
}

const PENDING_META_KEY = 'tailor.pendingRecordings'

function readPendingMetaList(): Record<string, PendingRecordingMeta> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_META_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writePendingMetaList(list: Record<string, PendingRecordingMeta>): void {
  try {
    localStorage.setItem(PENDING_META_KEY, JSON.stringify(list))
  } catch {
    /* localStorage indisponivel (modo privado etc.): a rede de seguranca so fica mais fraca */
  }
}

export async function savePendingRecording(key: string, blob: Blob, meta: PendingRecordingMeta): Promise<void> {
  await idbPut(PENDING_PREFIX + key, blob)
  const list = readPendingMetaList()
  list[key] = meta
  writePendingMetaList(list)
}

/** Liga a pendencia a nota recem-criada (ver PendingRecordingMeta.noteId). */
export function setPendingRecordingNote(key: string, noteId: string): void {
  const list = readPendingMetaList()
  if (!list[key]) return
  list[key] = { ...list[key], noteId }
  writePendingMetaList(list)
}

export function listPendingRecordings(): Array<{ key: string; meta: PendingRecordingMeta }> {
  const list = readPendingMetaList()
  return Object.entries(list).map(([key, meta]) => ({ key, meta }))
}

export async function getPendingRecordingBlob(key: string): Promise<Blob | null> {
  return idbGet(PENDING_PREFIX + key)
}

export async function deletePendingRecording(key: string): Promise<void> {
  await idbDelete(PENDING_PREFIX + key)
  const list = readPendingMetaList()
  delete list[key]
  writePendingMetaList(list)
}

// NAO existe limpeza automatica de pendentes: gravacao e dado do usuario, e so ele apaga
// (botao "Descartar" no card de recuperacao). Havia uma prune silenciosa de 3 dias aqui —
// removida de vez depois que o app destruiu uma reuniao de 69 min sozinho (04/08/2026):
// nenhum codigo apaga gravacao por conta propria.
