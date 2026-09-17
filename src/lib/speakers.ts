// Nomes dos falantes (migration 0043). A transcricao guarda os rotulos da diarizacao ("Falante A: ...")
// intactos; os nomes vivem em `note.speakers` e sao aplicados AQUI na hora de mostrar, exportar e
// mandar para a IA. Renomear ou desfazer nunca reescreve o texto original.

import type { Note } from './types'

export type SpeakerSource = 'auto' | 'manual'

export interface SpeakerEvidence {
  type: 'self' | 'addressed' | 'handoff'
  turn: number
  quote: string
  reply_turn?: number
}

export interface SpeakerName {
  name: string
  source: SpeakerSource
  /** So nos nomes automaticos: os trechos que provaram o nome (conferidos no servidor). */
  evidence?: SpeakerEvidence[]
}

export interface NoteSpeakers {
  /** Quando a identificacao automatica rodou. Ausente = nunca rodou. */
  checked_at?: string | null
  names: Record<string, SpeakerName>
}

export const SPEAKER_NAME_MAX = 40

/** Uma nota mudou por fora da tela aberta (ex.: nomes que chegaram depois). detail = id da nota. */
export const NOTE_CHANGED_EVENT = 'ana:note-changed'

const LINE_RE = /^(Falante|Speaker|Hablante)\s+([A-Z0-9]{1,3}):/gm

/** Rotulos na ordem em que aparecem ("A", "B"...). */
export function speakerLabels(transcript: string | null | undefined): string[] {
  const out: string[] = []
  for (const m of (transcript ?? '').matchAll(LINE_RE)) if (!out.includes(m[2])) out.push(m[2])
  return out
}

/** Vale a pena procurar nomes: ha pelo menos duas pessoas separadas na transcricao. */
export const hasSpeakers = (transcript: string | null | undefined) => speakerLabels(transcript).length >= 2

/** rotulo -> nome, so dos rotulos que tem nome. */
export function nameMap(speakers: NoteSpeakers | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [label, v] of Object.entries(speakers?.names ?? {})) if (v?.name?.trim()) out[label] = v.name.trim()
  return out
}

/** "Falante A: texto" -> "Carla: texto" no inicio das linhas. */
export function nameTranscript(text: string | null | undefined, map: Record<string, string>): string {
  if (!text || !Object.keys(map).length) return text ?? ''
  return text.replace(LINE_RE, (whole, _word: string, label: string) => (map[label] ? `${map[label]}:` : whole))
}

// Preposicao/artigo antes de "Falante X" no texto corrido: "o Falante A disse" vira "Carla disse",
// "do Falante B" vira "de João" -- sem isso sairia "o Carla", com o genero errado.
const PREP: Record<string, string> = { o: '', a: '', do: 'de ', da: 'de ', ao: 'a ', 'à': 'a ', no: 'em ', na: 'em ', pelo: 'por ', pela: 'por ' }
const PROSE_RE =
  /(^|[^\p{L}\p{N}])((?:[Oo]|[Aa]|[Dd][oa]|[Aa]o|[Àà]|[Nn][oa]|[Pp]el[oa])\s+)?(?:Falante|Speaker|Hablante)\s+([A-Z0-9]{1,3})(?![\p{L}\p{N}])/gu

/** Troca menções a "Falante X" no texto corrido (resumos, itens de ação, análise). */
export function nameProse(text: string | null | undefined, map: Record<string, string>): string {
  if (!text || !Object.keys(map).length) return text ?? ''
  return text.replace(PROSE_RE, (whole, before: string, prep: string | undefined, label: string) => {
    const name = map[label]
    if (!name) return whole
    if (!prep) return `${before}${name}`
    const word = prep.trim()
    const repl = PREP[word.toLowerCase()] ?? `${word} `
    // Mantem a maiuscula de inicio de frase na preposicao ("Do Falante A" -> "De Carla").
    const cased = word[0] === word[0].toUpperCase() && repl ? repl[0].toUpperCase() + repl.slice(1) : repl
    return `${before}${cased}${name}`
  })
}

/** Aplica os nomes em todas as strings de um objeto (analise, mapa mental). */
export function nameDeep<T>(value: T, map: Record<string, string>): T {
  if (!Object.keys(map).length || value == null) return value
  if (typeof value === 'string') return nameProse(value, map) as T
  if (Array.isArray(value)) return value.map((v) => nameDeep(v, map)) as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = nameDeep(v, map)
    return out as T
  }
  return value
}

/** A nota como o usuario deve ver/exportar/mandar para a IA: com os nomes no lugar dos rotulos. */
export function withSpeakerNames(note: Note): Note {
  const map = nameMap(note.speakers)
  if (!Object.keys(map).length) return note
  return {
    ...note,
    transcript: nameTranscript(note.transcript, map),
    summary: nameProse(note.summary, map),
    detailed_summary: note.detailed_summary ? nameProse(note.detailed_summary, map) : note.detailed_summary,
    action_items: note.action_items.map((a) => ({
      ...a,
      text: nameProse(a.text, map),
      owner: a.owner ? nameProse(a.owner, map) : a.owner,
    })),
    analysis: nameDeep(note.analysis, map),
    mindmap: nameDeep(note.mindmap, map),
  }
}

/** Junta a identificacao automatica ao que a pessoa ja definiu: nome manual nunca e sobrescrito. */
export function mergeAutoNames(
  current: NoteSpeakers | null | undefined,
  auto: Record<string, { name: string; evidence?: SpeakerEvidence[] }>,
): NoteSpeakers {
  const names: Record<string, SpeakerName> = { ...(current?.names ?? {}) }
  for (const [label, v] of Object.entries(auto)) {
    if (names[label]?.source === 'manual') continue
    names[label] = { name: v.name, source: 'auto', evidence: v.evidence ?? [] }
  }
  return { checked_at: new Date().toISOString(), names }
}

/** Define (ou remove, com nome vazio) o nome de um rotulo pela mao do usuario. */
export function setManualName(current: NoteSpeakers | null | undefined, label: string, name: string): NoteSpeakers {
  const names: Record<string, SpeakerName> = { ...(current?.names ?? {}) }
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, SPEAKER_NAME_MAX)
  if (clean) names[label] = { name: clean, source: 'manual' }
  else delete names[label]
  return { checked_at: current?.checked_at ?? null, names }
}

export function speakerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
