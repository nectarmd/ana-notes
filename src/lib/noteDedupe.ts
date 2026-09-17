// Mesma gravacao processada duas vezes nao vira duas notas (Fase 8, item 4 -- 17/09/2026).
//
// Caso real: em 16/09 a mesma gravacao de 11 min virou 3 notas em 40 segundos, durante retentativas
// com a IA fora do ar. A comparacao e pelo hash da transcricao (RPC recent_note_with_transcript,
// migration 0041), so entre as notas da propria pessoa nas ultimas 6 horas.

import { supabase } from './supabase'
import { sha256Hex } from './ai'
import type { Note } from './types'

export async function findRecentNoteWithTranscript(transcript: string): Promise<Note | null> {
  if (!supabase || !transcript.trim()) return null
  try {
    const hash = await sha256Hex(transcript)
    const { data, error } = await supabase.rpc('recent_note_with_transcript', { p_sha256: hash, p_minutes: 360 })
    if (error) return null
    const rows = (data ?? []) as Note[]
    return rows[0] ?? null
  } catch {
    return null
  }
}
