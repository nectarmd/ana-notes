import { Loader2, X, Flag } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '../lib/format'
import { useVisualViewport } from '../lib/useVisualViewport'
import { useT } from '../lib/i18n'
import type { NotePriority } from '../lib/types'

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />
}

/** Bandeirinha de prioridade da nota: alta=vermelha, media=amarela, baixa=azul. */
export function PriorityBadge({ level, className = '' }: { level: NotePriority; className?: string }) {
  const t = useT()
  const map: Record<NotePriority, { key: string; color: string }> = {
    alta: { key: 'prio.alta', color: 'text-red-600 dark:text-red-500' },
    media: { key: 'prio.media', color: 'text-yellow-500 dark:text-yellow-400' },
    baixa: { key: 'prio.baixa', color: 'text-blue-500 dark:text-blue-400' },
  }
  const m = map[level]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${m.color} ${className}`}>
      <Flag size={12} fill="currentColor" strokeWidth={1.5} />
      {t(m.key)}
    </span>
  )
}

/**
 * Caixa de texto que cresce com o conteudo. Com altura fixa + `resize-none`, texto maior que a
 * caixa rolava por dentro e parecia vazar do quadro (relato de 17/09/2026, editar tarefa).
 * Cresce de `minRows` ate `maxRows` linhas; dali em diante rola, com a barra so nesse caso.
 */
export function AutoTextarea({
  minRows = 3,
  maxRows = 12,
  className = '',
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxRows?: number; value: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    function fit() {
      if (!el) return
      const cs = getComputedStyle(el)
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 24
      const chrome =
        parseFloat(cs.paddingTop) +
        parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) +
        parseFloat(cs.borderBottomWidth)
      const min = minRows * line + chrome
      const max = maxRows * line + chrome
      el.style.height = 'auto'
      const needed = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
      el.style.height = `${Math.min(Math.max(needed, min), max)}px`
      el.style.overflowY = needed > max ? 'auto' : 'hidden'
    }
    fit()
    // A largura muda a quebra de linha (girar o celular, redimensionar a janela, abrir a folha).
    // So a LARGURA importa: reagir a propria mudanca de altura seria um laco.
    let lastWidth = el.clientWidth
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (el.clientWidth === lastWidth) return
            lastWidth = el.clientWidth
            fit()
          })
        : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [value, minRows, maxRows])

  return <textarea ref={ref} rows={minRows} value={value} className={`input resize-none ${className}`} {...rest} />
}

export function Avatar({
  first,
  last,
  size = 40,
  url,
}: {
  first: string
  last: string
  size?: number
  url?: string | null
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={`${first} ${last}`}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="grid place-items-center rounded-full bg-brand-solid text-white font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(first, last)}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="text-content-muted mb-4">{icon}</div>}
      <h3 className="font-display font-semibold text-lg text-content-primary">{title}</h3>
      {subtitle && <p className="text-content-secondary mt-1 max-w-xs">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Bottom sheet on mobile, centered dialog on wider screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  /** 'lg' abre mais larga no computador (conversa com a ANA). */
  size = 'md',
  headerRight,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'md' | 'lg'
  headerRight?: ReactNode
}) {
  // Com o teclado aberto o `fixed inset-0` continua do tamanho da janela e a folha
  // (ancorada embaixo) fica atras do teclado. Aqui ela passa a seguir o visual viewport.
  const vp = useVisualViewport(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Trava o scroll do body enquanto a folha esta aberta. Sem isto, no iOS a pagina
  // de tras rola por baixo do overlay e a folha parece "travada".
  useEffect(() => {
    if (!open) return
    const y = window.scrollY
    const b = document.body
    const prev = { position: b.style.position, top: b.style.top, width: b.style.width }
    b.style.position = 'fixed'
    b.style.top = `-${y}px`
    b.style.width = '100%'
    return () => {
      b.style.position = prev.position
      b.style.top = prev.top
      b.style.width = prev.width
      window.scrollTo(0, y)
    }
  }, [open])

  if (!open) return null

  // Portal para o body: chamadores como a bottom nav (`fixed z-40`) criam um contexto de
  // empilhamento, e o z-[60] daqui ficaria preso dentro dele — atras do botao da ANA.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      style={vp ? { top: vp.top, height: vp.height, bottom: 'auto' } : undefined}
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div
        className={`relative w-full ${size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md'} overflow-y-auto overscroll-contain bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-3xl shadow-float animate-slide-up ${
          vp ? 'max-h-full' : 'max-h-[90dvh] safe-bottom'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-2">
          <h2 className="font-display font-semibold text-lg min-w-0 truncate">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
          {headerRight}
          <button
            onClick={onClose}
            className="grid place-items-center h-9 w-9 rounded-full bg-surface-elevated text-content-secondary hover:text-content-primary"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
          </div>
        </div>
        <div className="px-5 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Selo para funcoes ainda nao disponiveis no web-mobile. */
export function SoonBadge({ children = 'EM BREVE NO APP' }: { children?: string }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide bg-brand-solid text-white border border-brand-600 rounded-full px-2 py-0.5 whitespace-nowrap">
      {children}
    </span>
  )
}

/** Placeholder animado para carregamento. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-elevated ${className}`} />
}

/** Card-esqueleto de nota (para a Home). */
export function NoteCardSkeleton() {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-7 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4 mb-2" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

/** Dialogo de confirmacao (destrutivo ou neutro), no lugar do confirm() nativo. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  /** Texto ou conteudo rico (ex.: um campo extra de confirmacao). */
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  // Portal pelo mesmo motivo do Sheet: chamadores `fixed z-*` prendem o z-[70] aqui dentro.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-3xl shadow-float animate-slide-up safe-bottom p-6">
        <h2 className="font-display font-semibold text-lg">{title}</h2>
        {message && <div className="text-content-secondary mt-1.5 text-sm leading-relaxed">{message}</div>}
        <div className="flex gap-3 mt-6">
          <button className="btn-outline flex-1" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`flex-1 ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function Chip({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
        active
          ? 'bg-brand-solid border-brand-solid text-white'
          : 'bg-surface-elevated border-surface-border text-content-secondary hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  )
}
