import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from './cn'
import { DUR, EASE } from './motion'
import { IconButton } from './IconButton'
import { useOverlay } from './useOverlay'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  /** Header content on the left. */
  title?: ReactNode
  /** Extra header actions (right of the title, left of the close button) */
  actions?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Panel width ≥ sm. Default 460. Full width on phones. */
  width?: number
  className?: string
}

/** Right-hand side panel. Slides in over a light scrim; Esc and scrim click close it. */
export function Drawer({ open, onClose, title, actions, children, footer, width = 460, className }: DrawerProps) {
  const reducedMotion = useReducedMotion()
  const panel = useRef<HTMLElement>(null)
  useOverlay(open, panel, onClose)

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="drawer"
          className="fixed inset-0 z-50"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : DUR.fast, ease: EASE }}
        >
          <div className="absolute inset-0 bg-overlay" onClick={onClose} aria-hidden />
          <motion.aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            style={{ ['--drawer-w' as string]: `${width}px` }}
            className={cn(
              'absolute inset-y-0 right-0 flex w-full flex-col border-l border-border-strong bg-surface shadow-lg outline-none sm:w-[var(--drawer-w)]',
              className,
            )}
            initial={reducedMotion ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: reducedMotion ? 0 : DUR.slow, ease: EASE }}
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-muted">{title}</div>
              {actions}
              <IconButton icon={X} label="Close · Esc" size="sm" onClick={onClose} className="-mr-1" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
