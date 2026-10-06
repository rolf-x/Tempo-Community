import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, CircleAlert, Undo2, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useUI } from '../uiState'
import { cn } from './cn'
import { DUR, EASE } from './motion'

const UNDO_MS = 6000
const NOTICE_MS = 4000

/**
 * Mounted once in App. Shows the store's undo toast ("Deleted “x”" + Undo, 6 s) and
 * one-off notices from useUI().notify() (4 s). Bottom-centre, stacked.
 */
export function ToastHost() {
  const undo = useStore((s) => s.undo)
  const setUndo = useStore((s) => s.setUndo)
  const toast = useUI((s) => s.toast)
  const dismiss = useUI((s) => s.dismissToast)

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo, setUndo])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, NOTICE_MS)
    return () => clearTimeout(t)
  }, [toast, dismiss])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toast && (
          <ToastShell key={`n-${toast.id}`} onClose={dismiss}>
            {toast.tone === 'success' && <Check className="size-4 text-success" aria-hidden />}
            {toast.tone === 'danger' && <CircleAlert className="size-4 text-danger" aria-hidden />}
            <span className="flex-1">{toast.message}</span>
          </ToastShell>
        )}
        {undo && (
          <ToastShell key="undo" onClose={() => setUndo(null)}>
            <span className="flex-1">{undo.label}</span>
            <button
              type="button"
              onClick={() => {
                undo.restore()
                setUndo(null)
              }}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-toast-ink/10 px-2.5 text-xs font-semibold text-toast-ink hover:bg-toast-ink/15"
            >
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          </ToastShell>
        )}
      </AnimatePresence>
    </div>
  )
}

function ToastShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.div
      role="status"
      layout
      initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: reducedMotion ? 0 : DUR.base, ease: EASE }}
      className={cn(
        'pointer-events-auto flex min-h-10 w-full max-w-sm items-center gap-3 rounded-lg border border-border-strong bg-toast py-1.5 pl-3.5 pr-1.5 text-sm font-medium text-toast-ink shadow-lg',
      )}
    >
      {children}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="focus-ring grid size-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-toast-ink/10 hover:text-toast-ink"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </motion.div>
  )
}
