// Saves the tasks Tempo wrote with the person's own AI key (src/ai/keyTasks.ts). In a cloud workspace the database does
// it (RPC key_submit_tasks, the browser's twin of mcp_submit_tasks: the app's owner or an admin only); the new tasks come
// back by realtime, so nothing is written to the store here. In guest mode the same merge runs on the local store.
import type { TaskDraft } from '../ai/tools/mcpDrafts'
import type { AppTask, DraftedBy } from '../types'
import { useStore } from '../store/useStore'
import { useSession } from './session'

export const MAX_TASKS = 10
export const MAX_TASKS_PER_PROBLEM = 3

const taskKey = (task: Pick<TaskDraft, 'problem' | 'title'>) => `${task.problem}\n${task.title.toLowerCase()}`

/** At most 3 for each problem and 10 in all, in the order given. */
export function capTasks(tasks: readonly TaskDraft[]): TaskDraft[] {
  const per = new Map<string, number>()
  const out: TaskDraft[] = []
  for (const task of tasks) {
    const n = per.get(task.problem) ?? 0
    if (n >= MAX_TASKS_PER_PROBLEM || out.length >= MAX_TASKS) continue
    per.set(task.problem, n + 1)
    out.push(task)
  }
  return out
}

/**
 * The task list after a key-written run, with the database's rules: an open task is replaced only for the problems in
 * `drafts` (open tasks for other problems stay), fixed and removed ones are kept, and a draft matching a removed task by
 * problem and title is not added again. Pure.
 */
export function mergeKeyTasks(
  existing: readonly AppTask[] | undefined,
  drafts: readonly TaskDraft[],
  draftedBy: DraftedBy,
  newId: () => string = () => crypto.randomUUID(),
): { tasks: AppTask[]; added: number } {
  const problems = new Set(drafts.map((task) => task.problem))
  const removed = new Set((existing ?? []).filter((task) => task.removedAt).map(taskKey))
  const kept = (existing ?? []).filter((task) => task.removedAt || task.fixedAt || !problems.has(task.problem))
  const fresh = drafts
    .filter((task) => !removed.has(taskKey(task)))
    .map((task): AppTask => ({ id: newId(), problem: task.problem, title: task.title, detail: task.detail, createdAt: draftedBy.at, draftedBy, fixedAt: null }))
  return { tasks: [...kept, ...fresh], added: fresh.length }
}

function failure(error: { code?: string; message?: string }): Error {
  if (error.code === '42501') return new Error("You can't add tasks to this app.")
  if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? '')) return new Error("Saving tasks isn't set up on this database yet.")
  return new Error("Tempo couldn't save the tasks.")
}

/**
 * Saves tasks for an app and returns how many were added. `label` names the writer on each task ("Anthropic API key").
 * Only the problems in `tasks` change; the app's other open tasks stay.
 */
export async function saveKeyTasks(projectId: string, tasks: readonly TaskDraft[], label: string): Promise<number> {
  const capped = capTasks(tasks)
  if (!capped.length) return 0
  const { workspace, meId } = useStore.getState()
  if (useSession.getState().status === 'signed-in' && workspace) {
    // Loaded on use, like the other cloud calls: guest mode never pulls in the Supabase client.
    const { client } = await import('./cloud')
    const { data, error } = await client().rpc('key_submit_tasks', { p_app: projectId, p_tasks: capped, p_label: label })
    if (error) throw failure(error)
    const count = (data as { tasks?: unknown } | null)?.tasks
    return typeof count === 'number' ? count : capped.length
  }
  const project = useStore.getState().projects.find((item) => item.id === projectId)
  if (!project) return 0
  const now = new Date().toISOString()
  const { tasks: next, added } = mergeKeyTasks(project.tasks, capped, { client: label, clientId: null, memberId: meId, at: now })
  if (!added) return 0
  useStore.getState().updateProject(projectId, { tasks: next, tasksAt: now })
  return added
}
