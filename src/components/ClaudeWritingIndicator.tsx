import { useClaudeWriting, stopClaudeWriting } from '../data/claudeWriting'
import { Button, Spinner, cn } from './ui'
import { openClaudeWindow, useUI } from './uiState'

/** "Copy message again": the same message the Claude window gave, so nothing has to be reopened. */
export async function copyMessageAgain(prompt: string) {
  try {
    await navigator.clipboard.writeText(prompt)
    useUI.getState().notify('Copied', 'success')
  } catch {
    useUI.getState().notify("Couldn't copy. Open the Claude window to copy the message.", 'danger')
  }
}

/**
 * Where Claude's descriptions stand (mcp mode), as a small pill above the toasts so it never covers them or the
 * "changes waiting" notice at the bottom corner. The work goes on in the background; this only says so.
 * Mounted once in App. Shows nothing unless Tempo is waiting on Claude.
 */
export function ClaudeWritingIndicator() {
  const phase = useClaudeWriting((s) => s.phase)
  const arrived = useClaudeWriting((s) => s.arrived.length)
  const total = useClaudeWriting((s) => s.expected.length)
  const prompt = useClaudeWriting((s) => s.prompt)
  if (!phase) return null
  const stalled = phase === 'stalled'
  return (
    // The row is click-through so it never blocks the page; only the pill takes clicks. z-45 keeps it under modals (z-50)
    // and the toasts (z-60). 7.5rem clears two stacked toasts (bottom-5), and sits well above the right-hand notice.
    <div className="pointer-events-none fixed inset-x-0 bottom-[7.5rem] z-[45] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 rounded-2xl border px-3.5 py-2 text-xs font-medium text-text shadow-md',
          stalled ? 'border-warning/30 bg-warning-soft' : 'border-border-strong bg-surface',
        )}
      >
        {phase === 'waiting' && (
          <>
            <Spinner size={14} className="text-accent motion-reduce:animate-none" />
            <span>Waiting for Claude…</span>
            <span className="font-normal text-text-muted">Send Claude the message to start</span>
            <CantFindTempo />
          </>
        )}
        {phase === 'writing' && (
          <>
            <Spinner size={14} className="text-accent motion-reduce:animate-none" />
            <span className="tabular-nums">{`Claude is writing descriptions · ${arrived} of ${total}`}</span>
            {arrived > 0 && <a href="#/review" className="focus-ring rounded-sm text-accent hover:underline">Review</a>}
          </>
        )}
        {stalled && (
          <>
            <span>Nothing from Claude yet</span>
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => void copyMessageAgain(prompt)}>Copy message again</Button>
              <Button size="sm" variant="ghost" onClick={stopClaudeWriting}>Stop waiting</Button>
            </span>
            <CantFindTempo />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Tempo can't tell when Tempo is removed inside Claude, so the wait can't either: this opens "Connect Claude again".
 */
function CantFindTempo() {
  return (
    <button type="button" className="focus-ring rounded-sm font-normal text-accent hover:underline" onClick={() => openClaudeWindow('again')}>
      Claude can&apos;t find Tempo?
    </button>
  )
}
