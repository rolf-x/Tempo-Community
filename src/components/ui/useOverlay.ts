// Shared behaviour for Modal and Drawer: Esc to close, focus-trap-lite, body scroll lock.
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let locks = 0

export function useOverlay(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null

    // Lock scroll (counted, so nested overlays behave)
    locks += 1
    document.body.style.overflow = 'hidden'

    // Focus the first [autofocus], else the first focusable, else the panel itself
    const frame = requestAnimationFrame(() => {
      const el = panel.current
      if (!el) return
      const target = el.querySelector<HTMLElement>('[autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el
      target.focus({ preventScroll: true })
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      locks = Math.max(0, locks - 1)
      if (locks === 0) document.body.style.overflow = ''
      // The opener may be gone (a modal that opened this one, then closed): fall back to the page's main region.
      const back = previous?.isConnected ? previous : document.getElementById('main')
      back?.focus?.({ preventScroll: true })
    }
  }, [open, panel])
}
