// With an API key, Tempo writes an app's tasks itself on sync. Claude (MCP) writes them with submit_tasks; this is
// the same job through the person's own key.
// It asks only for the problems (health flags) that have no open task, so a sync never rewrites the tasks that are there.
import type { AISettings, Member, Project } from '../types'
import { useStore } from '../store/useStore'
import { todayISO } from '../lib/dates'
import { isPersonal } from '../lib/model'
import { isSampleRepo } from '../lib/sampleRepo'
import { openTasks } from '../lib/tasks'
import { capTasks, saveKeyTasks } from '../data/keyTasksSave'
import { health, type HealthFlag, type HealthKind } from './tools/health'
import { cleanTasksDraft, type TaskDraft } from './tools/mcpDrafts'
import { tasksInput } from './tools/promptInput'
import { localOnly } from './adapterTypes'
import { callTool, PRESETS } from './client'
import { tasksSystem } from './prompts'
import { workspaceAI } from './workspaceAI'

export interface KeyTasksResult {
  /** Tasks saved for the app (0 when nothing was needed). */
  written: number
}

/** Health flags with no open task, the problems a key-run sync writes tasks for. Archived, repo-less and sample apps have none. */
function flagsWithoutTask(project: Project, members: Member[]): HealthFlag[] {
  if (project.archived || !project.repo || isSampleRepo(project)) return []
  const flags = health(project, members, new Date(), { personal: isPersonal(useStore.getState().workspace), keptAt: project.keptAt })
  const covered = new Set(openTasks(project.tasks, new Set(flags.map((flag) => flag.kind))).map((task) => task.problem))
  return flags.filter((flag) => !covered.has(flag.kind))
}

/** Does this app have a health flag with no open task, so a key-run sync should write tasks for it? */
export function appWantsTasks(project: Project, members: Member[]): boolean {
  return flagsWithoutTask(project, members).length > 0
}

/** Who a task says wrote it: "<Provider> API key", or "Claude (local)" for the dev bridge. */
export function keyLabel(settings: Pick<AISettings, 'provider' | 'preset'>): string {
  if (settings.provider === 'local' || (localOnly() && settings.provider !== 'none' && settings.provider !== 'demo')) return 'Claude (local)'
  if (settings.provider === 'anthropic') return 'Anthropic API key'
  const preset = PRESETS.find((item) => item.id === settings.preset)
  if (preset && !preset.needsKey) return preset.label
  return `${preset?.panelLabel ?? 'Custom'} API key`
}

/**
 * At most 3 tasks for each asked problem and 10 in all. When the AI wrote more than 10, every problem keeps its first task
 * before any gets a second (the flags come most serious first), so none is left out.
 */
function pick(drafts: TaskDraft[], order: HealthKind[]): TaskDraft[] {
  const byProblem = order.map((kind) => drafts.filter((task) => task.problem === kind).slice(0, 3))
  const chosen = new Set<TaskDraft>()
  for (let round = 0; round < 3; round++) {
    for (const list of byProblem) if (list[round] && chosen.size < 10) chosen.add(list[round])
  }
  return byProblem.flat().filter((task) => chosen.has(task))
}

/**
 * Writes tasks for the app's flags that have no open task, with the workspace's AI key, and saves them. Call it after
 * the sync saved fresh facts. Throws AIError when the AI fails, and an Error when the save fails.
 */
export async function aiWriteTasks(projectId: string): Promise<KeyTasksResult> {
  const { projects, members, settings } = useStore.getState()
  const project = projects.find((item) => item.id === projectId)
  const ai = workspaceAI(settings)
  if (!project || ai.provider === 'none' || ai.provider === 'demo') return { written: 0 }
  const flags = flagsWithoutTask(project, members)
  if (!flags.length) return { written: 0 }

  const out = await callTool({ tool: 'write_tasks', system: tasksSystem({ today: todayISO() }), user: tasksInput({ project, flags }) }, ai)

  // The app may have changed while the AI wrote (a flag cleared, Claude added tasks): keep only what is still missing.
  const now = useStore.getState()
  const current = now.projects.find((item) => item.id === projectId)
  if (!current) return { written: 0 }
  const missing = flagsWithoutTask(current, now.members).map((flag) => flag.kind)
  const asked = new Set<HealthKind>(flags.map((flag) => flag.kind))
  const wanted = missing.filter((kind) => asked.has(kind))
  const tasks = pick(cleanTasksDraft(out.tasks.filter((task) => wanted.includes(task.problem))), wanted)
  if (!tasks.length) return { written: 0 }
  return { written: await saveKeyTasks(projectId, capTasks(tasks), keyLabel(ai)) }
}
