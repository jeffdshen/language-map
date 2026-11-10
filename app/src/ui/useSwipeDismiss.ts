import type { PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'

type SheetPointer = ReactPointerEvent<HTMLElement>

/**
 * Touch-drag a sheet down by its grip to dismiss it (mouse drags are ignored).
 * Spread the result on the grip; the sheet is the nearest `[data-sheet]` ancestor.
 */
export function useSwipeDismiss(onClose?: () => void) {
  const drag = useRef<{ y: number; dy: number; id: number; el: HTMLElement } | null>(null)
  if (!onClose) return {}
  const end = (e: SheetPointer) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    d.el.style.transition = ''
    d.el.style.translate = ''
    if (e.type === 'pointerup' && d.dy > 70) onClose()
  }
  return {
    onPointerDown: (e: SheetPointer) => {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button, a, input, select, textarea')) return
      const el = e.currentTarget.closest<HTMLElement>('[data-sheet]')
      if (!el) return
      // Touch pointers are implicitly captured by their target, so moves keep bubbling here.
      drag.current = { y: e.clientY, dy: 0, id: e.pointerId, el }
      el.style.transition = 'none'
    },
    onPointerMove: (e: SheetPointer) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      d.dy = Math.max(0, e.clientY - d.y)
      d.el.style.translate = `0 ${d.dy}px`
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
}
