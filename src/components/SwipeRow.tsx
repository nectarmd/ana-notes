import { useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

const REVEAL = 88 // largura da acao escondida

/**
 * Mobile/APK: arrastar para a esquerda revela "Excluir".
 * Desktop: um icone de lixeira discreto aparece ao passar o mouse.
 * Nos dois casos quem confirma e o chamador (ConfirmDialog).
 */
export function SwipeRow({
  onDelete,
  label,
  children,
}: {
  onDelete: () => void
  label: string
  children: ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const opened = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  // Ate saber se o dedo vai na horizontal ou na vertical, nao sequestramos o scroll.
  const axis = useRef<'unknown' | 'x' | 'y'>('unknown')

  function close() {
    opened.current = false
    setDx(0)
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    axis.current = 'unknown'
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return
    const t = e.touches[0]
    const mx = t.clientX - start.current.x
    const my = t.clientY - start.current.y

    if (axis.current === 'unknown') {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
      if (axis.current === 'x') setDragging(true)
    }
    if (axis.current !== 'x') return

    const base = opened.current ? -REVEAL : 0
    setDx(Math.max(-REVEAL, Math.min(0, base + mx)))
  }

  function onTouchEnd() {
    if (axis.current === 'x') {
      const shouldOpen = dx < -REVEAL / 2
      opened.current = shouldOpen
      setDx(shouldOpen ? -REVEAL : 0)
    }
    setDragging(false)
    start.current = null
    axis.current = 'unknown'
  }

  const isOpen = dx <= -REVEAL / 2

  return (
    <div className="relative h-full rounded-2xl overflow-hidden group">
      <button
        onClick={onDelete}
        tabIndex={isOpen ? 0 : -1}
        aria-hidden={!isOpen}
        aria-label={label}
        className="md:hidden absolute inset-y-0 right-0 grid place-items-center gap-1 bg-brand-solid text-white"
        style={{ width: REVEAL }}
      >
        <Trash2 size={20} />
        <span className="text-[11px] font-medium">{label}</span>
      </button>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 180ms ease-out',
        }}
        className="relative h-full bg-surface-bg"
      >
        {children}

        {/* Com a acao aberta, o toque no card fecha em vez de navegar. */}
        {isOpen && !dragging && (
          <button
            aria-label="Fechar"
            onClick={close}
            className="md:hidden absolute inset-0 cursor-default"
          />
        )}

        {/* O canto de baixo a direita e do coracao (favoritar): a lixeira, que so aparece ao passar
            o mouse, fica ao lado dele. */}
        <button
          onClick={onDelete}
          aria-label={label}
          title={label}
          className="hidden md:grid absolute bottom-2 right-11 place-items-center h-8 w-8 rounded-lg
                     text-content-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                     hover:bg-surface-elevated hover:text-accent transition-opacity"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}
