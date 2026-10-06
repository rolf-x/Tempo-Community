import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from './cn'
import { DUR, EASE } from './motion'
import { IconButton } from './IconButton'
import { useOverlay } from './useOverlay'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  /** sm 384 · md 448 (default) · lg 512 · xl 672 px. Full-width bottom sheet below sm. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children?: ReactNode
  /** Right-aligned actions, separated by a hairline */
  footer?: ReactNode
  hideClose?: boolean
  /** No header/body padding: the caller owns the layout. */
  bare?: boolean
  /** Accessible name when there is no visible title (bare modals) */
  'aria-label'?: string
  className?: string
}

const WIDTH = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg', xl: 'sm:max-w-2xl' }

export function Modal({ open, onClose, title, description, size = 'md', children, footer, hideClose, bare, className, ...aria }: ModalProps) {
  const reducedMotion = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useOverlay(open, panel, onClose)

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : DUR.fast, ease: EASE }}
        >
          <div className="absolute inset-0 bg-overlay" onClick={onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title && !bare ? titleId : undefined}
            aria-label={aria['aria-label']}
            tabIndex={-1}
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl border border-border-strong bg-surface shadow-lg outline-none sm:rounded-xl',
              WIDTH[size],
              className,
            )}
            initial={reducedMotion ? false : { y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
            transition={{ duration: reducedMotion ? 0 : DUR.base, ease: EASE }}
          >
            {!bare && (title || !hideClose) && (
              <div className="flex items-start gap-3 px-5 pt-5 pb-1">
                <div className="min-w-0 flex-1">
                  {title && <h2 id={titleId} className="text-base font-semibold text-text">{title}</h2>}
                  {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
                </div>
                {!hideClose && <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />}
              </div>
            )}
            {bare && !hideClose && (
              <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="absolute right-3 top-3 z-10" />
            )}
            <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', !bare && 'px-5 py-4')}>{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
