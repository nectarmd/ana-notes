import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightCircle,
  CheckCircle2,
  Lightbulb,
  Link2,
  ListTree,
  Search,
  Sparkles,
  Target,
  Award,
  FileText,
} from 'lucide-react'
import { stripInlineMd } from '../lib/textPreview'
import { speakerInitials } from '../lib/speakers'

/* ------------------------------------------------------------------------------------------------
 * Resumo (rapido e detalhado)
 *
 * Desde 17/09/2026 a IA devolve secoes fixas ("## Visão geral", "## Pontos principais", ...). Aqui
 * cada secao vira um bloco com icone; a visao geral ganha destaque; bullets "Tema: explicacao" poem
 * o tema em negrito; "### Tema" (detalhado) vira subtitulo; "Ligação:" aparece como conexao entre
 * temas. Resumos antigos (so bullets, sem secoes) continuam aparecendo num bloco unico.
 * ---------------------------------------------------------------------------------------------- */

type Line = { kind: 'h3' | 'bullet' | 'text'; text: string }
type Section = { title: string | null; lines: Line[] }

function parseSections(md: string): Section[] {
  const sections: Section[] = []
  let cur: Section = { title: null, lines: [] }
  for (const raw of md.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    const h2 = /^#{1,2}\s+(.*)$/.exec(t)
    if (h2 && !t.startsWith('###')) {
      if (cur.title !== null || cur.lines.length) sections.push(cur)
      cur = { title: stripInlineMd(h2[1]).replace(/:$/, ''), lines: [] }
      continue
    }
    if (t.startsWith('###')) cur.lines.push({ kind: 'h3', text: stripInlineMd(t.replace(/^#+\s*/, '')) })
    else if (/^[-*•]\s+/.test(t)) cur.lines.push({ kind: 'bullet', text: stripInlineMd(t.replace(/^[-*•]\s+/, '')) })
    else cur.lines.push({ kind: 'text', text: stripInlineMd(t) })
  }
  if (cur.title !== null || cur.lines.length) sections.push(cur)
  return sections
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

function sectionIcon(title: string) {
  const t = fold(title)
  if (t.includes('visao geral') || t.includes('overview') || t.includes('resumen')) return <Sparkles size={16} />
  if (t.includes('contexto') || t.includes('objetivo')) return <Target size={16} />
  if (t.includes('ponto') || t.includes('discutid') || t.includes('tema')) return <ListTree size={16} />
  if (t.includes('decis') || t.includes('combinad')) return <CheckCircle2 size={16} />
  if (t.includes('risco') || t.includes('atencao')) return <AlertTriangle size={16} />
  if (t.includes('proximo') || t.includes('passo') || t.includes('next')) return <ArrowRightCircle size={16} />
  if (t.includes('sugest') || t.includes('recomenda')) return t.includes('recomenda') ? <Award size={16} /> : <Lightbulb size={16} />
  if (t.includes('conex') || t.includes('ligac')) return <Link2 size={16} />
  return <FileText size={16} />
}

/** "Tema curto: explicacao" -> tema em destaque. So quando o trecho antes dos dois-pontos e curto. */
function BulletText({ text }: { text: string }) {
  const m = /^([^:]{2,60}):\s+(.+)$/.exec(text)
  if (m && m[1].split(/\s+/).length <= 8 && !/https?$/i.test(m[1])) {
    return (
      <span>
        <span className="font-semibold text-content-primary">{m[1]}:</span> {m[2]}
      </span>
    )
  }
  return <span>{text}</span>
}

export function SummaryView({ text, empty }: { text: string | null | undefined; empty: string }) {
  const sections = useMemo(() => parseSections(text ?? ''), [text])
  if (!text?.trim() || sections.length === 0) return <p className="text-content-muted">{empty}</p>

  return (
    <div className="space-y-3">
      {sections.map((s, i) => {
        // Titulo solto, sem conteudo embaixo (resumos antigos comecavam com "# Resumo da Reuniao - X"):
        // vira cabecalho simples, nao um cartao vazio.
        if (s.title !== null && s.lines.length === 0) {
          return (
            <h2 key={i} className="font-display font-semibold text-lg px-1 pt-1">
              {s.title}
            </h2>
          )
        }
        const overview = s.title !== null && /visao geral|overview|resumen/.test(fold(s.title))
        const suggestions = s.title !== null && /sugest|recomenda/.test(fold(s.title))
        return (
          <section
            key={i}
            className={`rounded-2xl border p-4 sm:p-5 ${
              overview
                ? 'bg-accent/5 border-accent/25'
                : suggestions
                  ? 'bg-surface-elevated/60 border-dashed border-surface-border'
                  : 'bg-surface-card border-surface-border'
            }`}
          >
            {s.title !== null && (
              <h3 className="flex items-center gap-2 font-display font-semibold mb-2.5">
                <span className="text-accent shrink-0">{sectionIcon(s.title)}</span>
                {s.title}
              </h3>
            )}
            <div className="space-y-2 leading-relaxed break-words text-content-secondary">
              {s.lines.map((l, j) => {
                if (l.kind === 'h3')
                  return (
                    <h4 key={j} className={`font-semibold text-content-primary ${j > 0 ? 'pt-3' : ''}`}>
                      {l.text}
                    </h4>
                  )
                if (l.kind === 'bullet') {
                  const link = /^(Ligação|Ligacao|Conexão|Conexao|Link|Connection|Relación|Relacion):\s*(.+)$/i.exec(l.text)
                  if (link)
                    return (
                      <div key={j} className="flex gap-2 text-sm rounded-lg bg-surface-elevated/70 px-3 py-2">
                        <Link2 size={14} className="text-accent shrink-0 mt-1" />
                        <span>{link[2]}</span>
                      </div>
                    )
                  return (
                    <div key={j} className="flex gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-solid shrink-0" aria-hidden />
                      <BulletText text={l.text} />
                    </div>
                  )
                }
                return (
                  <p key={j} className={overview ? 'text-content-primary' : ''}>
                    {l.text}
                  </p>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Transcricao
 *
 * Duas formas chegam do servidor: com identificacao de falantes ("Falante A: ...", uma fala por
 * linha) e sem (paragrafos separados por linha em branco desde 17/09/2026; antes, um bloco unico de
 * dezenas de milhares de caracteres). Falas viram turnos com o falante em destaque; texto corrido
 * vira paragrafos de tamanho de leitura. Busca com destaque ajuda em reunioes de 1 hora.
 * ---------------------------------------------------------------------------------------------- */

const SPEAKER_RE = /^(Falante|Speaker|Hablante)\s+([A-Z0-9]{1,3}):\s?(.*)$/

/** Cores de identificacao de falante (fundo suave + texto), em ordem fixa por letra. */
export const SPEAKER_TONES = [
  'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'bg-pink-500/10 text-pink-700 dark:text-pink-300',
  'bg-amber-500/10 text-amber-700 dark:text-amber-300',
]

/** Quebra um bloco enorme em paragrafos de ~500 caracteres, sempre no fim de uma frase. */
function splitLong(block: string): string[] {
  if (block.length <= 700) return [block]
  const sentences = block.match(/[^.!?…]+[.!?…]+["')\]]?\s*|[^.!?…]+$/g) ?? [block]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur.length + s.length > 520 && cur.length >= 200) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const q = fold(query)
  const f = fold(text)
  const parts: React.ReactNode[] = []
  let from = 0
  let idx = f.indexOf(q)
  while (idx !== -1) {
    if (idx > from) parts.push(text.slice(from, idx))
    parts.push(
      <mark key={idx} className="bg-yellow-300/60 dark:bg-yellow-500/40 text-inherit rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    from = idx + q.length
    idx = f.indexOf(q, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}

export function TranscriptView({
  text,
  empty,
  searchPlaceholder,
  matchesLabel,
  names = {},
}: {
  text: string | null | undefined
  empty: string
  searchPlaceholder: string
  /** Ex.: "{n} ocorrências". */
  matchesLabel: string
  /** rotulo -> nome real (note.speakers). O texto segue com os rotulos; o nome so aparece aqui. */
  names?: Record<string, string>
}) {
  const [query, setQuery] = useState('')

  const parsed = useMemo(() => {
    const lines = (text ?? '').split('\n').map((l) => l.trim())
    const nonEmpty = lines.filter(Boolean)
    const speakerLines = nonEmpty.filter((l) => SPEAKER_RE.test(l)).length
    if (nonEmpty.length > 0 && speakerLines / nonEmpty.length >= 0.5) {
      const turns: { speaker: string; label: string; paras: string[] }[] = []
      for (const l of nonEmpty) {
        const m = SPEAKER_RE.exec(l)
        if (m) {
          const last = turns[turns.length - 1]
          if (last && last.speaker === m[2]) last.paras.push(m[3])
          else turns.push({ speaker: m[2], label: `${m[1]} ${m[2]}`, paras: [m[3]] })
        } else if (turns.length) {
          turns[turns.length - 1].paras.push(l)
        } else {
          turns.push({ speaker: '?', label: '', paras: [l] })
        }
      }
      return { mode: 'speakers' as const, turns }
    }
    const blocks = (text ?? '')
      .split(/\n\s*\n|\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .flatMap(splitLong)
    return { mode: 'paragraphs' as const, blocks }
  }, [text])

  const matches = useMemo(() => {
    const q = fold(query.trim())
    if (q.length < 2 || !text) return 0
    const f = fold(text)
    let n = 0
    let i = f.indexOf(q)
    while (i !== -1) {
      n++
      i = f.indexOf(q, i + q.length)
    }
    return n
  }, [query, text])

  if (!text?.trim()) return <p className="text-content-muted">{empty}</p>
  const q = query.trim().length >= 2 ? query.trim() : ''

  const speakerOrder: string[] = []
  const toneOf = (s: string) => {
    if (!speakerOrder.includes(s)) speakerOrder.push(s)
    return SPEAKER_TONES[speakerOrder.indexOf(s) % SPEAKER_TONES.length]
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
        <input
          type="search"
          className="input w-full h-10 py-0 pl-9 pr-28"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-content-muted tabular-nums">
            {matchesLabel.replace('{n}', String(matches))}
          </span>
        )}
      </div>

      {parsed.mode === 'speakers' ? (
        <ol className="space-y-4">
          {parsed.turns.map((turn, i) => (
            <li key={i} className="flex gap-3">
              {turn.label ? (
                <span
                  className={`grid place-items-center h-8 w-8 rounded-full text-xs font-bold shrink-0 ${toneOf(turn.speaker)}`}
                  aria-hidden
                >
                  {names[turn.speaker] ? speakerInitials(names[turn.speaker]) : turn.speaker}
                </span>
              ) : (
                <span className="h-8 w-8 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                {turn.label && (
                  <p className="text-xs font-semibold text-content-muted mb-0.5">{names[turn.speaker] ?? turn.label}</p>
                )}
                <div className="space-y-2 text-[15px] leading-7 text-content-secondary break-words">
                  {turn.paras.flatMap(splitLong).map((p, j) => (
                    <p key={j}>
                      <Highlight text={p} query={q} />
                    </p>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-4 text-[15px] leading-7 text-content-secondary break-words">
          {parsed.blocks.map((b, i) => (
            <p key={i}>
              <Highlight text={b} query={q} />
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
