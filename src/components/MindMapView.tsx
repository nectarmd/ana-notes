import { useEffect, useRef, useState } from 'react'
import { Download, FileCode2, FileDown, ListTree, Maximize2, X } from 'lucide-react'
import type { Note } from '../lib/types'
import { useToast } from './Toast'

type MindMap = NonNullable<Note['mindmap']>

// Paleta de cores dos ramos (estilo mapa mental tradicional).
const PALETTE = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4f46e5', '#0d9488']
const CENTRAL_COLOR = '#941010'
const BG = '#f8fafc'

// Dimensoes dos cards e espacamentos (em unidades do canvas interno).
const P = 32
const W_C = 216, H_C = 66
const W_B = 190, H_B = 58
const W_CH = 178, H_CH = 60
const COL_GAP = 94
/** Banda vertical minima reservada por ramo (usada so quando ele nao tem filhos, ou como piso
 *  geral) -- mesmo valor do antigo SLOT fixo, para manter a proporcao visual de mapas curtos. */
const MIN_BAND = 78
/** Espaco vertical entre filhos empilhados dentro do mesmo ramo. */
const CHILD_GAP = 18

type Kind = 'central' | 'branch' | 'child'
type NodeBox = { kind: Kind; text: string; lines: string[]; x: number; y: number; w: number; h: number; color: string }
type Link = { x1: number; y1: number; x2: number; y2: number; color: string; dir: 'l' | 'r' }

/**
 * Cards tinham altura FIXA e cortavam o texto com "…" quando nao cabia. Em vez de truncar,
 * o card cresce em altura para caber o texto (a IA ja e instruida a ser concisa; isto e so a
 * rede de seguranca para quando um ponto realmente precisa de mais espaco). maxLines aqui e uma
 * folga generosa, nao o limite normal -- so um texto MUITO fora do comum ainda seria cortado.
 */
const FS: Record<Kind, number> = { central: 15, branch: 13.5, child: 12 }
const MAX_CHARS: Record<Kind, number> = { central: 22, branch: 24, child: 26 }
const MAX_LINES: Record<Kind, number> = { central: 3, branch: 4, child: 6 }
const PAD_V: Record<Kind, number> = { central: 30, branch: 25.6, child: 16.8 }
const BASE_H: Record<Kind, number> = { central: H_C, branch: H_B, child: H_CH }

function measureNode(kind: Kind, text: string): { lines: string[]; h: number } {
  const lines = wrapLines(text, MAX_CHARS[kind], MAX_LINES[kind])
  const h = Math.max(BASE_H[kind], PAD_V[kind] + lines.length * FS[kind] * 1.2)
  return { lines, h }
}

function buildLayout(map: MindMap) {
  const branches = map.branches ?? []
  const right: { b: MindMap['branches'][number]; ci: number }[] = []
  const left: { b: MindMap['branches'][number]; ci: number }[] = []
  branches.forEach((b, i) => (i % 2 === 0 ? right : left).push({ b, ci: i }))

  // Banda reservada para o ramo: cabe a pilha de filhos (cada um com sua altura real) OU a
  // altura do proprio titulo do ramo, o que for maior -- nunca menos que MIN_BAND sem filhos.
  function bandH(b: MindMap['branches'][number]): number {
    const branchH = measureNode('branch', b.title).h
    if (!b.children.length) return Math.max(branchH, MIN_BAND)
    const contentH =
      b.children.reduce((s, c) => s + measureNode('child', c).h, 0) + (b.children.length - 1) * CHILD_GAP
    return Math.max(branchH, contentH)
  }

  const rH = right.reduce((s, x) => s + bandH(x.b), 0)
  const lH = left.reduce((s, x) => s + bandH(x.b), 0)
  const cm = measureNode('central', map.central)
  const totalH = Math.max(rH, lH, cm.h + MIN_BAND)

  const leftHasKids = left.some((x) => x.b.children.length > 0)
  const rightHasKids = right.some((x) => x.b.children.length > 0)
  const leftWidth = left.length ? COL_GAP + W_B + (leftHasKids ? COL_GAP + W_CH : 0) : 0
  const rightWidth = right.length ? COL_GAP + W_B + (rightHasKids ? COL_GAP + W_CH : 0) : 0

  const totalW = P + leftWidth + W_C + rightWidth + P
  const totalHeight = totalH + P * 2

  const cLeftX = P + leftWidth
  const cRightX = cLeftX + W_C
  const cCenterY = P + totalH / 2

  const nodes: NodeBox[] = [
    {
      kind: 'central',
      text: map.central,
      lines: cm.lines,
      x: cLeftX,
      y: cCenterY - cm.h / 2,
      w: W_C,
      h: cm.h,
      color: CENTRAL_COLOR,
    },
  ]
  const links: Link[] = []

  function placeSide(list: { b: MindMap['branches'][number]; ci: number }[], side: 'r' | 'l', sideSum: number) {
    let acc = P + (totalH - sideSum) / 2
    for (const { b, ci } of list) {
      const h = bandH(b)
      const bandTop = acc
      acc += h
      const branchY = bandTop + h / 2
      const color = PALETTE[ci % PALETTE.length]
      const branchX = side === 'r' ? cRightX + COL_GAP : cLeftX - COL_GAP - W_B
      const bm = measureNode('branch', b.title)
      nodes.push({ kind: 'branch', text: b.title, lines: bm.lines, x: branchX, y: branchY - bm.h / 2, w: W_B, h: bm.h, color })

      links.push({
        x1: side === 'r' ? cRightX : cLeftX,
        y1: cCenterY,
        x2: side === 'r' ? branchX : branchX + W_B,
        y2: branchY,
        color,
        dir: side,
      })

      // Filhos empilhados com altura propria, centralizados na banda (que pode ser maior que a
      // soma deles, quando quem manda no tamanho da banda e o titulo do ramo).
      const childMeasures = b.children.map((c) => measureNode('child', c))
      const childrenContentH =
        childMeasures.reduce((s, m) => s + m.h, 0) + Math.max(0, childMeasures.length - 1) * CHILD_GAP
      const childX = side === 'r' ? branchX + W_B + COL_GAP : branchX - COL_GAP - W_CH
      let cursor = bandTop + (h - childrenContentH) / 2
      childMeasures.forEach((m, i) => {
        const childY = cursor + m.h / 2
        cursor += m.h + CHILD_GAP
        nodes.push({ kind: 'child', text: b.children[i], lines: m.lines, x: childX, y: childY - m.h / 2, w: W_CH, h: m.h, color })
        links.push({
          x1: side === 'r' ? branchX + W_B : branchX,
          y1: branchY,
          x2: side === 'r' ? childX : childX + W_CH,
          y2: childY,
          color,
          dir: side,
        })
      })
    }
  }
  placeSide(right, 'r', rH)
  placeSide(left, 'l', lH)

  return { nodes, links, totalW, totalHeight }
}

function linkPath(l: Link) {
  const dx = (l.x2 - l.x1) / 2
  return `M${l.x1},${l.y1} C${l.x1 + dx},${l.y1} ${l.x2 - dx},${l.y2} ${l.x2},${l.y2}`
}

function arrow(l: Link) {
  return l.dir === 'r'
    ? `${l.x2},${l.y2} ${l.x2 - 9},${l.y2 - 5} ${l.x2 - 9},${l.y2 + 5}`
    : `${l.x2},${l.y2} ${l.x2 + 9},${l.y2 - 5} ${l.x2 + 9},${l.y2 + 5}`
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w
    if (trial.length <= maxChars) cur = trial
    else {
      if (cur) lines.push(cur)
      cur = w
      if (lines.length >= maxLines) break
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  for (let i = 0; i < lines.length; i++) if (lines[i].length > maxChars) lines[i] = lines[i].slice(0, maxChars)
  const full = words.join(' ')
  if (lines.join(' ').length < full.length && lines.length) {
    let last = lines[lines.length - 1]
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1)
    lines[lines.length - 1] = last.replace(/[\s.,;:]+$/, '') + '…'
  }
  return lines.length ? lines : ['']
}

function Card({ n }: { n: NodeBox }) {
  const isChild = n.kind === 'child'
  const fs = FS[n.kind]
  const lh = fs * 1.2
  const rx = n.kind === 'central' ? 16 : n.kind === 'branch' ? 12 : 10
  const cy = n.y + n.h / 2
  const startY = cy - ((n.lines.length - 1) * lh) / 2
  const tx = isChild ? n.x + 14 : n.x + n.w / 2
  const anchor = isChild ? 'start' : 'middle'
  return (
    <g>
      <rect
        x={n.x}
        y={n.y}
        width={n.w}
        height={n.h}
        rx={rx}
        fill={isChild ? '#ffffff' : n.color}
        stroke={isChild ? n.color : 'none'}
        strokeWidth={isChild ? 2 : 0}
      />
      {n.lines.map((ln, i) => (
        <text
          key={i}
          x={tx}
          y={startY + i * lh}
          fill={isChild ? '#1e293b' : '#ffffff'}
          fontSize={fs}
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={isChild ? 500 : 700}
          textAnchor={anchor}
          dominantBaseline="central"
        >
          {ln}
        </text>
      ))}
    </g>
  )
}

/** Mapa mental tradicional (SVG): no central, ramos para os dois lados e filhos ligados por curvas/setas. */
export function MindMapView({ map, title }: { map: MindMap; title?: string }) {
  const { nodes, links, totalW, totalHeight } = buildLayout(map)
  const svgRef = useRef<SVGSVGElement>(null)
  const toast = useToast()
  const [fs, setFs] = useState(false)

  function fileBase() {
    const b = (title || 'mapa-mental')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40)
    return b || 'mapa-mental'
  }

  async function renderCanvas(scale = 2): Promise<HTMLCanvasElement> {
    const svg = svgRef.current
    if (!svg) throw new Error('svg')
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(totalW))
    clone.setAttribute('height', String(totalHeight))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const str = new XMLSerializer().serializeToString(clone)
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str)
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('img'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(totalW * scale)
    canvas.height = Math.round(totalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('ctx')
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  async function downloadPng() {
    try {
      const canvas = await renderCanvas(2)
      await new Promise<void>((res) =>
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = fileBase() + '.png'
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }
          res()
        }, 'image/png'),
      )
    } catch {
      toast('Não foi possível gerar a imagem.', 'error')
    }
  }

  async function downloadPdf() {
    try {
      const canvas = await renderCanvas(2)
      const jpeg = canvas.toDataURL('image/jpeg', 0.92)
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: totalW >= totalHeight ? 'l' : 'p', unit: 'pt', format: [totalW, totalHeight] })
      pdf.addImage(jpeg, 'JPEG', 0, 0, totalW, totalHeight)
      pdf.save(fileBase() + '.pdf')
    } catch {
      toast('Não foi possível gerar o PDF.', 'error')
    }
  }

  function saveBlob(content: string, mime: string, ext: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileBase()}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** SVG vetorial: abre e edita em Figma, Illustrator, Inkscape ou Canva. */
  function downloadSvg() {
    try {
      const svg = svgRef.current
      if (!svg) throw new Error('svg')
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('width', String(totalW))
      clone.setAttribute('height', String(totalHeight))
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)
      saveBlob(str, 'image/svg+xml;charset=utf-8', 'svg')
    } catch {
      toast('Não foi possível gerar o SVG.', 'error')
    }
  }

  /** OPML: formato de mapa mental aceito por XMind, Freeplane, MindMeister, iThoughts. */
  function downloadOpml() {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const branches = map.branches
      .map((b) => {
        const kids = b.children.map((c) => `      <outline text="${esc(c)}"/>`).join('\n')
        return `    <outline text="${esc(b.title)}">\n${kids}\n    </outline>`
      })
      .join('\n')

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>${esc(title || map.central)}</title></head>
  <body>
    <outline text="${esc(map.central)}">
${branches}
    </outline>
  </body>
</opml>`
    saveBlob(opml, 'text/x-opml;charset=utf-8', 'opml')
  }

  async function enterFs() {
    setFs(true)
    try {
      await document.documentElement.requestFullscreen?.()
    } catch {
      /* iOS / nao suportado: usamos overlay proprio */
    }
    try {
      await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape')
    } catch {
      /* orientacao nao pode ser travada (ex.: desktop) */
    }
  }

  async function exitFs() {
    try {
      ;(screen.orientation as unknown as { unlock?: () => void })?.unlock?.()
    } catch {
      /* ignore */
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      /* ignore */
    }
    setFs(false)
  }

  // Fecha o overlay se o usuario sair do fullscreen nativo (ex.: ESC).
  useEffect(() => {
    function onChange() {
      if (!document.fullscreenElement) setFs((v) => (v ? false : v))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const svgEl = (attachRef: boolean) => (
    <svg
      ref={attachRef ? svgRef : undefined}
      viewBox={`0 0 ${totalW} ${totalHeight}`}
      width="100%"
      style={{ height: 'auto', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={totalW} height={totalHeight} fill={BG} />
      {links.map((l, i) => (
        <g key={i}>
          <path d={linkPath(l)} fill="none" stroke={l.color} strokeWidth={2.5} strokeOpacity={0.75} strokeLinecap="round" />
          <polygon points={arrow(l)} fill={l.color} />
        </g>
      ))}
      {nodes.map((n, i) => (
        <Card key={i} n={n} />
      ))}
    </svg>
  )

  const toolbarBtn = 'grid place-items-center h-9 w-9 rounded-lg bg-surface-elevated border border-surface-border text-content-secondary hover:text-content-primary'

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-2">
        <button onClick={downloadPng} className={toolbarBtn} aria-label="Baixar imagem" title="Baixar imagem (PNG)">
          <Download size={17} />
        </button>
        <button onClick={downloadPdf} className={toolbarBtn} aria-label="Baixar PDF" title="Baixar PDF">
          <FileDown size={17} />
        </button>
        <button onClick={downloadSvg} className={toolbarBtn} aria-label="Baixar SVG editavel" title="Baixar SVG editável (Figma, Illustrator, Inkscape)">
          <FileCode2 size={17} />
        </button>
        <button onClick={downloadOpml} className={toolbarBtn} aria-label="Baixar OPML editavel" title="Baixar OPML editável (XMind, Freeplane, MindMeister)">
          <ListTree size={17} />
        </button>
        <button onClick={enterFs} className={toolbarBtn} aria-label="Tela cheia" title="Tela cheia (landscape)">
          <Maximize2 size={17} />
        </button>
      </div>
      <p className="text-xs text-content-muted text-right mb-2">
        SVG e OPML abrem em editores de mapa mental para você continuar editando.
      </p>

      <div className="rounded-2xl border border-surface-border overflow-hidden">{svgEl(true)}</div>
      <p className="text-xs text-content-muted mt-2">Use dois dedos para dar zoom no mapa.</p>

      {fs && (
        <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: BG }}>
          <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0 border-b border-black/10">
            <span className="text-sm font-medium text-slate-700 truncate min-w-0 flex-1">{title || 'Mapa mental'}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={downloadPng} className="grid place-items-center h-9 w-9 rounded-lg bg-white border border-black/10 text-slate-700" aria-label="Baixar imagem">
                <Download size={17} />
              </button>
              <button onClick={downloadPdf} className="grid place-items-center h-9 w-9 rounded-lg bg-white border border-black/10 text-slate-700" aria-label="Baixar PDF">
                <FileDown size={17} />
              </button>
              <button onClick={exitFs} className="grid place-items-center h-9 w-9 rounded-lg bg-white border border-black/10 text-slate-700" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto grid place-items-center p-2">
            <div className="w-full">{svgEl(false)}</div>
          </div>
          <p className="text-[11px] text-slate-500 text-center py-1 shrink-0">Gire o aparelho para landscape • use dois dedos para dar zoom</p>
        </div>
      )}
    </div>
  )
}
