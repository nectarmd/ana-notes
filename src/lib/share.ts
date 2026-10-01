// Exportacao e compartilhamento de notas: WhatsApp, e-mail, PDF e Word.
// Usa recursos nativos do browser; o PDF e gerado com jsPDF (carregado sob demanda).
//
// Desde 17/09/2026 o resumo tem secoes em markdown ("## Visão geral", bullets "- "). Antes o texto
// ia cru para o PDF/Word/WhatsApp e aparecia "##" no meio do documento; agora cada destino recebe
// o formato dele (HTML de verdade no Word, PDF diagramado, *negrito* e "•" no WhatsApp).
//
// Desde 01/10/2026 o PDF e um ARQUIVO de verdade. Antes ele abria uma janela em branco para
// imprimir, e o clique nao fazia nada no app Windows (que recusa janelas internas) nem no APK
// Android (WebView sem impressao). Os arquivos saem todos por saveFile(), ver saveFile.ts.

import type { jsPDF as JsPDF } from 'jspdf'
import type { Note } from './types'
import { fmtDate, fmtDuration } from './format'
import { APP_NAME } from './version'
import { withSpeakerNames } from './speakers'
import { isElectron } from './electron'
import { saveFile, type SaveResult } from './saveFile'

const PRIORITY_LABEL: Record<string, string> = { high: 'alta', low: 'baixa' }

/** Markdown simples da IA -> texto corrido. `bold` decide como marcar os titulos. */
function mdToPlain(md: string, bold: (s: string) => string): string {
  return md
    .split('\n')
    .map((line) => {
      const t = line.trim()
      const h = /^#{1,3}\s+(.*)$/.exec(t)
      if (h) return bold(h[1].replace(/\*\*/g, ''))
      if (/^[-*•]\s+/.test(t)) return `• ${t.replace(/^[-*•]\s+/, '')}`
      return line
    })
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
}

function actionItemExtra(a: Note['action_items'][number]): string {
  return [a.owner, a.due, a.priority && PRIORITY_LABEL[a.priority] ? `urgência ${PRIORITY_LABEL[a.priority]}` : null]
    .filter(Boolean)
    .join(' · ')
}

function actionItemLine(a: Note['action_items'][number]): string {
  const extra = actionItemExtra(a)
  return `${a.done ? '✓' : '☐'} ${a.text}${extra ? ` (${extra})` : ''}`
}

function buildPlainText(note: Note, bold: (s: string) => string): string {
  const lines: string[] = []
  lines.push(bold(note.title))
  lines.push(`${fmtDate(note.created_at)}${note.duration_seconds ? ` • ${fmtDuration(note.duration_seconds)}` : ''}`)
  lines.push('')
  if (note.summary) {
    lines.push(bold('RESUMO'))
    lines.push(mdToPlain(note.summary, bold))
    lines.push('')
  }
  if (note.detailed_summary) {
    lines.push(bold('RESUMO DETALHADO'))
    lines.push(mdToPlain(note.detailed_summary, bold))
    lines.push('')
  }
  if (note.action_items.length) {
    lines.push(bold('ITENS DE AÇÃO'))
    note.action_items.forEach((a) => lines.push(actionItemLine(a)))
    lines.push('')
  }
  lines.push(`— Gerado pelo ${APP_NAME}`)
  return lines.join('\n')
}

export function noteToPlainText(note: Note): string {
  return buildPlainText(note, (s) => s)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Run = { text: string; bold?: boolean }
type MdBlock = { kind: 'h3' | 'h4' | 'li' | 'p'; runs: Run[] }

/** Markdown simples da IA -> blocos (titulos, itens de lista e paragrafos). Base do Word e do PDF. */
function mdToBlocks(md: string): MdBlock[] {
  const out: MdBlock[] = []
  for (const raw of md.split('\n')) {
    const t = raw.trim().replace(/\*\*(.+?)\*\*/g, '$1')
    if (!t) continue
    const h3 = /^###\s+(.*)$/.exec(t)
    const h2 = /^#{1,2}\s+(.*)$/.exec(t)
    if (h3) {
      out.push({ kind: 'h4', runs: [{ text: h3[1] }] })
    } else if (h2) {
      out.push({ kind: 'h3', runs: [{ text: h2[1] }] })
    } else if (/^[-*•]\s+/.test(t)) {
      const item = t.replace(/^[-*•]\s+/, '')
      const m = /^([^:]{2,60}):\s+(.+)$/.exec(item)
      out.push({
        kind: 'li',
        runs: m && m[1].split(/\s+/).length <= 8 ? [{ text: `${m[1]}: `, bold: true }, { text: m[2] }] : [{ text: item }],
      })
    } else {
      const sp = /^(Falante|Speaker|Hablante)\s+([A-Z0-9]{1,3}):\s?(.*)$/.exec(t)
      out.push({ kind: 'p', runs: sp ? [{ text: `${sp[1]} ${sp[2]}: `, bold: true }, { text: sp[3] }] : [{ text: t }] })
    }
  }
  return out
}

const runsToHtml = (runs: Run[]) =>
  runs.map((r) => (r.bold ? `<strong>${esc(r.text.trimEnd())}</strong> ` : esc(r.text))).join('').trim()

/** Markdown simples da IA -> HTML: titulos, listas e paragrafos. */
function mdToHtml(md: string): string {
  const out: string[] = []
  let inList = false
  for (const b of mdToBlocks(md)) {
    if (b.kind !== 'li' && inList) {
      out.push('</ul>')
      inList = false
    }
    if (b.kind === 'li' && !inList) {
      out.push('<ul>')
      inList = true
    }
    out.push(`<${b.kind}>${runsToHtml(b.runs)}</${b.kind}>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function noteToHtml(note: Note): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
  <title>${esc(note.title)}</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#101010;max-width:720px;margin:32px auto;padding:0 24px;line-height:1.55}
    h1{color:#941010;font-size:24px;margin-bottom:4px}
    h2{color:#941010;font-size:15px;margin-top:28px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #E8E6E2;padding-bottom:4px}
    h3{font-size:15px;margin:18px 0 6px}
    h4{font-size:14px;margin:12px 0 4px;color:#3a3a3a}
    p{margin:6px 0}
    ul{margin:6px 0;padding-left:20px}
    li{margin:4px 0}
    .meta{color:#878684;font-size:13px;margin-bottom:16px}
    .foot{margin-top:32px;color:#878684;font-size:12px;border-top:1px solid #E8E6E2;padding-top:12px}
  </style></head><body>
  <h1>${esc(note.title)}</h1>
  <div class="meta">${fmtDate(note.created_at)}${note.duration_seconds ? ` &bull; ${fmtDuration(note.duration_seconds)}` : ''}</div>
  ${note.summary ? `<h2>Resumo</h2>${mdToHtml(note.summary)}` : ''}
  ${note.detailed_summary ? `<h2>Resumo detalhado</h2>${mdToHtml(note.detailed_summary)}` : ''}
  ${
    note.action_items.length
      ? `<h2>Itens de ação</h2><ul>${note.action_items.map((a) => `<li>${esc(actionItemLine(a))}</li>`).join('')}</ul>`
      : ''
  }
  ${note.transcript ? `<h2>Transcrição</h2>${mdToHtml(note.transcript)}` : ''}
  <div class="foot">Gerado pelo ${esc(APP_NAME)}</div>
  </body></html>`
}

export function shareWhatsApp(note: Note): void {
  const text = encodeURIComponent(buildPlainText(note, (s) => `*${s}*`))
  window.open(`https://wa.me/?text=${text}`, '_blank')
}

export function shareEmail(note: Note): void {
  const subject = encodeURIComponent(`Nota: ${note.title}`)
  const body = encodeURIComponent(noteToPlainText(note))
  const url = `mailto:?subject=${subject}&body=${body}`
  // No app Windows, navegar a janela para mailto: nao abre o Outlook (o Electron nao conhece o
  // esquema e a pagina cairia na tela de erro); o window.open passa pelo setWindowOpenHandler,
  // que entrega o mailto ao Windows.
  if (isElectron()) window.open(url, '_blank')
  else window.location.href = url
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'nota'

export function exportWord(note: Note): Promise<SaveResult> {
  const html = noteToHtml(note)
  return saveFile(new Blob([html], { type: 'application/msword' }), `${slug(note.title)}.doc`)
}

// ---------------------------------------------------------------- PDF

let jsPdfModule: Promise<typeof import('jspdf')> | null = null

/** Carrega o jsPDF de antemao (ao abrir a folha de compartilhar). No celular o menu de
 *  compartilhar exige que o toque seja recente; baixar a biblioteca so no clique pode estourar
 *  esse prazo e o arquivo cairia no download em vez do menu. */
export function preloadPdf(): Promise<typeof import('jspdf')> {
  if (!jsPdfModule) {
    jsPdfModule = import('jspdf').catch((err) => {
      jsPdfModule = null
      throw err
    })
  }
  return jsPdfModule
}

// Fontes padrao do PDF so tem a tabela WinAnsi (Latin-1 + aspas, travessoes, "•", "…", "€").
// Acentos do portugues e do espanhol passam; o resto viraria lixo na pagina.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
function pdfSafe(s: string): string {
  let out = ''
  for (const ch of s.replace(/✓|✔/g, '[x]').replace(/☐/g, '[ ]').replace(/[‐‑]/g, '-')) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch
    else if (ch === '\t') out += ' '
  }
  return out
}

const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 54
const CONTENT_W = A4_W - MARGIN * 2
const ACCENT: [number, number, number] = [148, 16, 16]
const MUTED: [number, number, number] = [135, 134, 132]
const TEXT: [number, number, number] = [16, 16, 16]
const RULE: [number, number, number] = [232, 230, 226]

/** Diagramador minimo: texto com trechos em negrito, quebra de linha e de pagina. */
class PdfWriter {
  y = MARGIN
  constructor(private pdf: JsPDF) {}

  private ensure(h: number) {
    if (this.y + h > A4_H - MARGIN) {
      this.pdf.addPage()
      this.y = MARGIN
    }
  }

  space(h: number) {
    this.y += h
  }

  /** Quebra `runs` em linhas de ate `maxW`; cada linha e uma lista de trechos posicionados. */
  private layout(runs: Run[], size: number, maxW: number) {
    const lines: { text: string; bold: boolean; x: number }[][] = [[]]
    let x = 0
    for (const run of runs) {
      const bold = !!run.bold
      this.pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size)
      for (const tok of pdfSafe(run.text).split(/(\s+)/)) {
        if (!tok) continue
        const space = /^\s+$/.test(tok)
        if (space) {
          if (x > 0) x += this.pdf.getTextWidth(' ')
          continue
        }
        // Palavra maior que a linha (link longo): quebra no meio.
        const pieces: string[] =
          this.pdf.getTextWidth(tok) > maxW ? (this.pdf.splitTextToSize(tok, maxW) as string[]) : [tok]
        for (const piece of pieces) {
          const w = this.pdf.getTextWidth(piece)
          if (x > 0 && x + w > maxW) {
            lines.push([])
            x = 0
          }
          lines[lines.length - 1].push({ text: piece, bold, x })
          x += w
        }
      }
    }
    return lines
  }

  text(
    runs: Run[],
    opts: { size: number; color?: [number, number, number]; indent?: number; bullet?: boolean; lineGap?: number },
  ) {
    const indent = opts.indent ?? 0
    const lineH = opts.size * (opts.lineGap ?? 1.45)
    const lines = this.layout(runs, opts.size, CONTENT_W - indent)
    lines.forEach((line, i) => {
      this.ensure(lineH)
      const baseline = this.y + opts.size
      this.pdf.setTextColor(...(opts.color ?? TEXT))
      if (opts.bullet && i === 0) {
        this.pdf.setFont('helvetica', 'normal').setFontSize(opts.size)
        this.pdf.text('•', MARGIN + indent - 10, baseline)
      }
      for (const seg of line) {
        this.pdf.setFont('helvetica', seg.bold ? 'bold' : 'normal').setFontSize(opts.size)
        this.pdf.text(seg.text, MARGIN + indent + seg.x, baseline)
      }
      this.y += lineH
    })
  }

  section(title: string) {
    this.ensure(48)
    this.space(16)
    this.text([{ text: title.toUpperCase(), bold: true }], { size: 11, color: ACCENT })
    this.pdf.setDrawColor(...RULE).setLineWidth(0.8)
    this.pdf.line(MARGIN, this.y, A4_W - MARGIN, this.y)
    this.space(8)
  }

  blocks(md: string) {
    for (const b of mdToBlocks(md)) {
      if (b.kind === 'h3') {
        this.ensure(36)
        this.space(8)
        this.text(b.runs.map((r) => ({ ...r, bold: true })), { size: 11.5 })
      } else if (b.kind === 'h4') {
        this.space(4)
        this.text(b.runs.map((r) => ({ ...r, bold: true })), { size: 10.5, color: [58, 58, 58] })
      } else if (b.kind === 'li') {
        this.text(b.runs, { size: 10, indent: 14, bullet: true })
        this.space(2)
      } else {
        this.text(b.runs, { size: 10 })
        this.space(4)
      }
    }
  }
}

async function buildPdf(note: Note): Promise<Blob> {
  const { jsPDF } = await preloadPdf()
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  pdf.setProperties({ title: pdfSafe(note.title), creator: APP_NAME })
  const w = new PdfWriter(pdf)

  w.text([{ text: note.title, bold: true }], { size: 20, color: ACCENT, lineGap: 1.25 })
  w.space(2)
  w.text(
    [{ text: `${fmtDate(note.created_at)}${note.duration_seconds ? ` • ${fmtDuration(note.duration_seconds)}` : ''}` }],
    { size: 10, color: MUTED },
  )

  if (note.summary?.trim()) {
    w.section('Resumo')
    w.blocks(note.summary)
  }
  if (note.detailed_summary?.trim()) {
    w.section('Resumo detalhado')
    w.blocks(note.detailed_summary)
  }
  if (note.action_items.length) {
    w.section('Itens de ação')
    for (const a of note.action_items) {
      const extra = actionItemExtra(a)
      w.text([{ text: `${a.done ? '[x]' : '[ ]'} ${a.text}` }, ...(extra ? [{ text: ` (${extra})` }] : [])], {
        size: 10,
      })
      w.space(3)
    }
  }
  if (note.transcript?.trim()) {
    w.section('Transcrição')
    w.blocks(note.transcript)
  }

  w.space(20)
  w.text([{ text: `Gerado pelo ${APP_NAME}` }], { size: 9, color: MUTED })

  // Rodape com paginacao, depois que o total de paginas e conhecido.
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
    pdf.text(`${i} / ${pages}`, A4_W - MARGIN, A4_H - 28, { align: 'right' })
  }
  return pdf.output('blob')
}

/** Gera o PDF da nota e entrega como arquivo (menu de compartilhar no celular, download no PC). */
export async function exportPdf(note: Note): Promise<SaveResult> {
  return saveFile(await buildPdf(note), `${slug(note.title)}.pdf`)
}

export async function nativeShare(note: Note): Promise<boolean> {
  if (!navigator.share) return false
  try {
    await navigator.share({ title: note.title, text: noteToPlainText(note) })
    return true
  } catch {
    return false
  }
}

export async function copyToClipboard(note: Note): Promise<void> {
  await navigator.clipboard.writeText(noteToPlainText(note))
}

/** Baixa a transcricao como .txt para o usuario guardar onde quiser. */
export function exportTranscript(note: Note): Promise<SaveResult> {
  const content = note.transcript?.trim() || 'Transcrição indisponível.'
  return saveFile(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${slug(note.title)}-transcricao.txt`)
}

export function slugify(s: string): string {
  return slug(s)
}

/** Exporta TODAS as notas do usuario em Markdown (pequeno, ideal p/ IA e Word). */
export function exportNotesMarkdown(notes: Note[], ownerName = ''): Promise<SaveResult> {
  const parts: string[] = [`# Minhas notas — ${APP_NAME}`, ownerName ? `_${ownerName}_` : '', '']
  for (const n of notes.map(withSpeakerNames)) {
    parts.push(`## ${n.title}`)
    parts.push(
      `_${fmtDate(n.created_at)}${n.duration_seconds ? ` · ${fmtDuration(n.duration_seconds)}` : ''}_`,
      '',
    )
    if (n.summary?.trim()) {
      parts.push('### Resumo', n.summary.trim(), '')
    }
    if (n.action_items?.length) {
      parts.push('### Itens de ação')
      n.action_items.forEach((a) => parts.push(`- [${a.done ? 'x' : ' '}] ${a.text}${a.owner ? ` (${a.owner})` : ''}`))
      parts.push('')
    }
    if (n.transcript?.trim()) {
      parts.push('### Transcrição', n.transcript.trim(), '')
    }
    parts.push('---', '')
  }
  const md = parts.join('\n')
  return saveFile(new Blob([md], { type: 'text/markdown;charset=utf-8' }), 'minhas-notas-tailor.md')
}
