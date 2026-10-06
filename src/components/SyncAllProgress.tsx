import { useEffect, useRef, useState, type Ref } from 'react'
import { Check, CircleAlert, CircleCheck } from 'lucide-react'
import { useClaudeWriting } from '../data/claudeWriting'
import { closeSyncWindow, openSyncWindow, summaryText, useSyncAll, type SyncAppProgress, type SyncSummary } from '../data/syncAll'
import { navigate } from '../lib/router'
import { useUI } from './uiState'
import { Button, Modal, ProgressBar, Spinner, cn } from './ui'

// Sync all with an API key. One window says where the run is; closing it shrinks it to a pill at the
// bottom of the screen, and the pill opens it again. Mounted once in App. Shows nothing without a key.

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const working = (app: SyncAppProgress) => app.step === 'reading' || app.step === 'writing' || app.step === 'tasks'

/** The big line: how far along the run is. */
export const progressLine = (done: number, total: number) => `Writing descriptions · ${done} of ${plural(total, 'app', 'apps')}`

/** What is happening to one app right now. */
export function nowLine(app: SyncAppProgress): string {
  if (app.step === 'writing') return `Writing the description for ${app.name}…`
  if (app.step === 'tasks') return `Adding tasks for ${app.name}…`
  return `Reading GitHub for ${app.name}…`
}

/** The short status at the end of an app's row. */
export function rowStatus(app: SyncAppProgress): string {
  switch (app.step) {
    case 'waiting': return 'Waiting'
    case 'reading': return 'Reading GitHub…'
    case 'writing': return 'Writing description…'
    case 'tasks': return 'Adding tasks…'
    case 'failed': return "Couldn't sync"
    case 'done': return ['Done', app.wrote ? 'description written' : '', app.tasks ? plural(app.tasks, 'task', 'tasks') : ''].filter(Boolean).join(' · ')
  }
}

function RowIcon({ step }: { step: SyncAppProgress['step'] }) {
  if (step === 'done') return <Check className="size-3.5 shrink-0 text-success" strokeWidth={2.5} aria-hidden />
  if (step === 'failed') return <CircleAlert className="size-3.5 shrink-0 text-danger" aria-hidden />
  if (step === 'waiting') return <span className="mx-[5px] size-1 shrink-0 rounded-full bg-text-faint" aria-hidden />
  return <Spinner size={14} className="text-accent motion-reduce:animate-none" />
}

export interface SyncAllBodyProps {
  apps: SyncAppProgress[]
  done: number
  total: number
  /** Set once the run is over: the window shows it instead of the progress line. */
  summary: SyncSummary | null
}

/** The window's content: the big line, what is happening now, the bar and a row for each app. */
export function SyncAllBody({ apps, done, total, summary }: SyncAllBodyProps) {
  const now = apps.filter(working)
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Sync progress" className="space-y-2.5">
        {summary ? (
          <p className="flex items-start gap-2 text-[15px] font-semibold leading-snug text-text">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            {summaryText(summary)}
          </p>
        ) : (
          <div>
            <p className="text-[15px] font-semibold tabular-nums text-text">{progressLine(done, total)}</p>
            <ul className="mt-1.5 space-y-1 text-sm text-text-muted">
              {now.length ? (
                now.map((app) => (
                  <li key={app.id} className="flex items-center gap-2">
                    <Spinner size={14} className="text-accent motion-reduce:animate-none" />
                    <span className="min-w-0 break-words">{nowLine(app)}</span>
                  </li>
                ))
              ) : (
                <li>{done ? 'Finishing up…' : 'Starting…'}</li>
              )}
            </ul>
          </div>
        )}
        <ProgressBar value={total ? (done / total) * 100 : 0} size="md" tone={summary ? 'success' : 'accent'} />
      </div>
      <ul aria-label="Apps" className="max-h-60 divide-y divide-border overflow-y-auto overscroll-contain rounded-lg border border-border">
        {apps.map((app) => (
          <li key={app.id} className="flex items-center gap-2.5 px-3 py-2">
            <RowIcon step={app.step} />
            <span className={cn('min-w-0 flex-1 truncate text-sm', app.step === 'waiting' ? 'text-text-muted' : 'text-text')}>{app.name}</span>
            <span className={cn('max-w-[55%] text-right text-xs', app.step === 'failed' ? 'text-danger' : 'text-text-muted')}>{rowStatus(app)}</span>
          </li>
        ))}
      </ul>
      {!summary && <p className="text-xs text-text-muted">You can close this. Tempo keeps going and shows its progress at the bottom of the screen.</p>}
    </div>
  )
}

export interface SyncAllFooterProps {
  summary: SyncSummary | null
  onHide: () => void
  onClose: () => void
  onReview: () => void
}

/** Hide while it runs; Close (and Open Review, when descriptions were written) once it is done. */
export function SyncAllFooter({ summary, onHide, onClose, onReview }: SyncAllFooterProps) {
  if (!summary) return <Button onClick={onHide}>Hide</Button>
  const review = summary.wrote > 0
  return (
    <>
      <Button variant={review ? 'secondary' : 'primary'} onClick={onClose}>Close</Button>
      {review && <Button variant="primary" onClick={onReview}>Open Review</Button>}
    </>
  )
}

export interface SyncAllPillProps {
  done: number
  total: number
  /** The run is over: the pill says so and opens the summary. */
  finished: boolean
  /** Sits higher when the "Claude is writing" pill is showing, so the two stack. */
  lifted?: boolean
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

/** The window, zoomed out: a small pill at the bottom of the screen. Click it to open the window again. */
export function SyncAllPill({ done, total, finished, lifted, onClick, buttonRef }: SyncAllPillProps) {
  return (
    // The row is click-through so it never blocks the page; only the pill takes clicks. z-45 keeps it under modals (z-50)
    // and the toasts (z-60). 7.5rem sits above two stacked toasts, the same place as the "Claude is writing" pill, so with
    // that one showing too this one stacks above it.
    <div className={cn('pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-4', lifted ? 'bottom-[13rem]' : 'bottom-[7.5rem]')}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        aria-label={finished ? 'Sync done. See what changed' : `Syncing ${done} of ${total} apps. Show progress`}
        className="focus-ring pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-xs font-medium text-text shadow-md transition-colors hover:bg-surface-2"
      >
        {finished ? (
          <>
            <Check className="size-3.5 shrink-0 text-success" strokeWidth={2.5} aria-hidden />
            <span>Sync done</span>
            <span className="font-normal text-text-muted">· See what changed</span>
          </>
        ) : (
          <>
            <Spinner size={14} className="text-accent motion-reduce:animate-none" />
            <span className="tabular-nums">{`Syncing ${done} of ${total}`}</span>
          </>
        )}
      </button>
    </div>
  )
}

export function SyncAllProgress() {
  const view = useSyncAll((s) => s.view)
  const apps = useSyncAll((s) => s.apps)
  const done = useSyncAll((s) => s.done)
  const total = useSyncAll((s) => s.total)
  const summary = useSyncAll((s) => s.summary)
  const claudeShowing = useClaudeWriting((s) => s.phase !== null)
  // Mounted the first time it opens and kept, so closing it can animate out.
  const [mounted, setMounted] = useState(view === 'open')
  const pill = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  // Counts as an open window for the rest of the app (no Claude window or ⌘K on top of it).
  useEffect(() => {
    useUI.setState({ syncWindowOpen: view === 'open' })
  }, [view])

  useEffect(() => {
    if (view === 'open') {
      setMounted(true)
      wasOpen.current = true
      return
    }
    // Hiding the window hands focus to the pill, so the keyboard doesn't lose its place.
    const toPill = view === 'mini' && wasOpen.current
    wasOpen.current = false
    if (!toPill) return
    const frame = requestAnimationFrame(() => pill.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [view])

  const review = () => {
    closeSyncWindow()
    navigate({ name: 'review' })
  }

  return (
    <>
      {(mounted || view === 'open') && (
        <Modal
          open={view === 'open'}
          onClose={closeSyncWindow}
          title="Syncing your apps"
          size="md"
          footer={<SyncAllFooter summary={summary} onHide={closeSyncWindow} onClose={closeSyncWindow} onReview={review} />}
        >
          <SyncAllBody apps={apps} done={done} total={total} summary={summary} />
        </Modal>
      )}
      {view === 'mini' && <SyncAllPill done={done} total={total} finished={!!summary} lifted={claudeShowing} onClick={openSyncWindow} buttonRef={pill} />}
    </>
  )
}
