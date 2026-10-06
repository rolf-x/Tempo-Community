// Tasks an agent wrote for an app's health flags (`AppTask`, written over MCP by mcp_submit_tasks). A task closes on its
// own: it counts as fixed as soon as its flag is gone, and the next sync saves `fixedAt` so it can't come back, even if
// the same flag returns later. Pure, and safe for the api to import (types only come from the app).
import type { HealthKind } from '../ai/tools/health'
import type { AppTask } from '../types'

type TaskList = readonly AppTask[] | null | undefined

/** Fixed already (a sync saw its flag gone) or its flag is not on the app right now. */
export const isTaskFixed = (task: Pick<AppTask, 'problem' | 'fixedAt'>, flagKinds: ReadonlySet<HealthKind>): boolean =>
  !!task.fixedAt || !flagKinds.has(task.problem)

/** A task a person removed is hidden everywhere (it stays stored, so Claude doesn't add it again). */
const shown = (tasks: TaskList): AppTask[] => (tasks ?? []).filter((task) => !task.removedAt)

export const openTasks = (tasks: TaskList, flagKinds: ReadonlySet<HealthKind>): AppTask[] =>
  shown(tasks).filter((task) => !isTaskFixed(task, flagKinds))

export const fixedTasks = (tasks: TaskList, flagKinds: ReadonlySet<HealthKind>): AppTask[] =>
  shown(tasks).filter((task) => isTaskFixed(task, flagKinds))

/**
 * The list to save after a sync: every open task whose flag is gone gets `fixedAt` = now. Null when nothing changed,
 * so the caller can leave the project alone.
 */
export function closeFixedTasks(tasks: TaskList, flagKinds: ReadonlySet<HealthKind>, now: string | Date): AppTask[] | null {
  // The database stamps its own time on a newly fixed task; this one only says "fixed".
  const closes = (task: AppTask) => !task.removedAt && !task.fixedAt && isTaskFixed(task, flagKinds)
  if (!tasks?.some(closes)) return null
  const at = typeof now === 'string' ? now : now.toISOString()
  return tasks.map((task) => (closes(task) ? { ...task, fixedAt: at } : task))
}
