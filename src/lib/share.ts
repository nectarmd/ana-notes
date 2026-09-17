// Exportacao e compartilhamento de notas: WhatsApp, e-mail, PDF e Word.
// Usa recursos nativos do browser (sem dependencias pesadas).
//
// Desde 17/09/2026 o resumo tem secoes em markdown ("## Visão geral", bullets "- "). Antes o texto
// ia cru para o PDF/Word/WhatsApp e aparecia "##" no meio do documento; agora cada destino recebe
// o formato dele (HTML de verdade no PDF/Word, *negrito* e "•" no WhatsApp).

import type { Note } from './types'
import { fmtDate, fmtDuration } from './format'
import { APP_NAME } from './version'

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

function actionItemLine(a: Note['action_items'][number]): string {
  const extra = [a.owner, a.due, a.priority && PRIORITY_LABEL[a.priority] ? `urgência ${PRIORITY_LABEL[a.priority]}` : null]
    .filter(Boolean)
    .join(' · ')
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

/** Markdown simples da IA -> HTML: titulos, listas e paragrafos. */
function mdToHtml(md: string): string {
  const out: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) out.push('</ul>')
    inList = false
  }
  for (const raw of md.split('\n')) {
    const t = raw.trim().replace(/\*\*(.+?)\*\*/g, '$1')
    if (!t) {
      closeList()
      continue
    }
    const h3 = /^###\s+(.*)$/.exec(t)
    const h2 = /^#{1,2}\s+(.*)$/.exec(t)
    if (h3) {
      closeList()
      out.push(`<h4>${esc(h3[1])}</h4>`)
    } else if (h2) {
      closeList()
      out.push(`<h3>${esc(h2[1])}</h3>`)
    } else if (/^[-*•]\s+/.test(t)) {
      if (!inList) out.push('<ul>')
      inList = true
      const item = t.replace(/^[-*•]\s+/, '')
      const m = /^([^:]{2,60}):\s+(.+)$/.exec(item)
      out.push(m && m[1].split(/\s+/).length <= 8 ? `<li><strong>${esc(m[1])}:</strong> ${esc(m[2])}</li>` : `<li>${esc(item)}</li>`)
    } else {
      closeList()
      const sp = /^(Falante|Speaker|Hablante)\s+([A-Z0-9]{1,3}):\s?(.*)$/.exec(t)
      out.push(sp ? `<p><strong>${esc(sp[1])} ${esc(sp[2])}:</strong> ${esc(sp[3])}</p>` : `<p>${esc(t)}</p>`)
    }
  }
  closeList()
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
  window.location.href = `mailto:?subject=${subject}&body=${body}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'nota'

export function exportWord(note: Note): void {
  const html = noteToHtml(note)
  downloadBlob(new Blob([html], { type: 'application/msword' }), `${slug(note.title)}.doc`)
}

/** PDF via janela de impressao (usuario escolhe "Salvar como PDF"). */
export function exportPdf(note: Note): void {
  const html = noteToHtml(note)
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
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
export function exportTranscript(note: Note): void {
  const content = note.transcript?.trim() || 'Transcrição indisponível.'
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${slug(note.title)}-transcricao.txt`)
}

export function slugify(s: string): string {
  return slug(s)
}

/** Exporta TODAS as notas do usuario em Markdown (pequeno, ideal p/ IA e Word). */
export function exportNotesMarkdown(notes: Note[], ownerName = ''): void {
  const parts: string[] = [`# Minhas notas — ${APP_NAME}`, ownerName ? `_${ownerName}_` : '', '']
  for (const n of notes) {
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
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), 'minhas-notas-tailor.md')
}
