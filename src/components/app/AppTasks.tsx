// "Tasks" on the app page: what an AI agent added over MCP for the problems Tempo flags on this app. A task closes on
// its own: it shows as fixed the moment its flag is gone (derived here, before any sync saves `fixedAt`). Nobody edits
// a task's text in the browser; people who can edit the app can remove one.
import { useId, useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import type { AppTask } from '../../types'
import { flagFixHeading } from '../../ai/tools/flagFix'
import type { HealthKind } from '../../ai/tools/health'
import { TASK_LIMITS, clientName, taskText } from '../../ai/tools/mcpDrafts'
import { formatCalendarDate, formatShort, todayISO } from '../../lib/dates'
import { fixedTasks, openTasks } from '../../lib/tasks'
import { Card, IconButton, SectionHeader, cn } from '../ui'

/** "6 Oct" this year, "6 Oct 2025" before that; empty when the time is not a date. */
function dayLabel(iso: string | null | undefined, now: Date): string {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return ''
  const day = todayISO(at)
  return day.slice(0, 4) === todayISO(now).slice(0, 4) ? formatShort(day) : formatCalendarDate(day)
}

/** The client's own name for itself, as drafts show it. */
const addedBy = (task: AppTask) => (task.draftedBy?.client?.trim() ? clientName(task.draftedBy.client) : 'an AI agent')

function ProblemChip({ kind }: { kind: HealthKind }) {
  return <span className="inline-flex h-5 max-w-full items-center rounded-full bg-surface-2 px-2 text-xs font-medium text-text-muted"><span className="truncate">{flagFixHeading(kind)}</span></span>
}

export interface AppTasksProps {
  tasks: readonly AppTask[] | null | undefined
  /** The problems Tempo flags on the app right now. A task whose problem is not among them counts as fixed. */
  flagKinds: ReadonlySet<HealthKind>
  /** Who may remove a task: the people who can edit the app. */
  canEdit: boolean
  onRemove: (taskId: string) => void
  now?: Date
  /** Start with the fixed tasks listed. */
  defaultFixedOpen?: boolean
}

export function AppTasks({ tasks, flagKinds, canEdit, onRemove, now = new Date(), defaultFixedOpen = false }: AppTasksProps) {
  const [fixedOpen, setFixedOpen] = useState(defaultFixedOpen)
  const fixedId = useId()
  if (!tasks?.length) return null
  const open = openTasks(tasks, flagKinds)
  // Fixed just now (no date yet) first, then the newest fixed.
  const fixed = fixedTasks(tasks, flagKinds).sort((a, b) => (b.fixedAt ?? '￿').localeCompare(a.fixedAt ?? '￿'))
  // Every task was removed (not fixed): nothing to list, and "All done" would be wrong while the flag is still there.
  if (!open.length && !fixed.length) return null

  return (
    <section aria-label="Tasks">
      <SectionHeader title="Tasks" count={open.length} />
      <Card bare>
        {open.length > 0 ? (
          <ul className="divide-y divide-border">
            {open.map((task) => {
              const added = dayLabel(task.createdAt, now)
              return (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-text">{taskText(task.title, TASK_LIMITS.title)}</p>
                    {task.detail && <p className="mt-0.5 break-words text-sm leading-5 text-text-muted">{taskText(task.detail, TASK_LIMITS.detail)}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                      <ProblemChip kind={task.problem} />
                      <span>Added by {addedBy(task)}{added && ` · ${added}`}</span>
                    </p>
                  </div>
                  {canEdit && <IconButton icon={X} size="md" label={`Remove task ${taskText(task.title, TASK_LIMITS.title)}`} onClick={() => onRemove(task.id)} />}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-text-muted">
            {fixed.some((task) => flagKinds.has(task.problem)) ? 'No open tasks.' : 'All done. Tempo no longer flags these problems.'}
          </p>
        )}

        {fixed.length > 0 && (
          <div className={cn(open.length > 0 && 'border-t border-border')}>
            <button
              type="button"
              aria-expanded={fixedOpen}
              aria-controls={fixedId}
              onClick={() => setFixedOpen((value) => !value)}
              className="focus-ring flex min-h-11 w-full items-center gap-1.5 rounded-b-lg px-4 py-2 text-left text-sm font-medium text-text-muted hover:text-text"
            >
              <ChevronRight className={cn('size-4 shrink-0 transition-transform', fixedOpen && 'rotate-90')} aria-hidden />
              {fixed.length} fixed
            </button>
            {fixedOpen && (
              <ul id={fixedId} className="divide-y divide-border border-t border-border">
                {fixed.map((task) => {
                  const when = dayLabel(task.fixedAt, now)
                  return (
                    <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                        <Check className="size-3" strokeWidth={2.5} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-text-muted">{taskText(task.title, TASK_LIMITS.title)}</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                          <ProblemChip kind={task.problem} />
                          <span className="font-medium text-success">{when ? `Fixed on ${when}` : 'Fixed'}</span>
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {open.length > 0 && <p className="border-t border-border px-4 py-2 text-xs text-text-muted">A task closes on its own once Tempo no longer flags its problem.</p>}
      </Card>
    </section>
  )
}
