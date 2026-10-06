// What Tempo asks Claude to do over MCP (mcp and both modes). The Claude window, Sync all and the "Claude is writing" indicator
// all go by these, so the message Claude gets and the apps Tempo waits for always match.
import type { Project } from '../types'
import { isAICardOutOfDate } from './cardFreshness.js'
import { isSampleRepo } from './sampleRepo.js'

/**
 * The apps whose card Claude should write: no card yet, only Tempo's facts-only card, or an AI card the repo has moved
 * past. A draft already waiting in Review is left alone, and so are archived and sample apps.
 */
export function needsCard(project: Project): boolean {
  if (project.archived || !project.repo || isSampleRepo(project)) return false
  return !project.appCard || project.appCard.source === 'fallback' || isAICardOutOfDate(project)
}

export const appsNeedingCard = (projects: Project[]) => projects.filter(needsCard)

/** Beyond this many, the message describes the apps instead of naming them. */
export const MAX_NAMED = 12

const quoted = (name: string) => `"${name.replace(/["\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)}"`

function list(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The one message to paste into Claude. It names the workspace (list_apps covers every workspace), names the apps that
 * need a card when there are few, and asks for tasks on the problems Tempo flags, which close on their own once fixed.
 * `tempo` is this Tempo's name (`tempoSite().label`): "Tempo (staging)" on staging, so an AI app connected to both
 * uses the right one.
 */
export function draftPrompt(workspace: string | null | undefined, apps: string[], tempo = 'Tempo'): string {
  const name = workspace?.replace(/["\r\n]+/g, ' ').trim()
  const where = name ? ` in my "${name}" workspace` : ''
  const tasks = `add tasks for the problems Tempo flags on my apps${name ? ' there' : ''}`
  if (!apps.length) return `Use ${tempo} to ${tasks.replace(' there', where)}.`
  const cards = apps.length <= MAX_NAMED
    ? `the app cards for ${list(apps.map(quoted))}${where}`
    : `the app card for each app${where} that Tempo marks as needing one`
  return `Use ${tempo} to draft ${cards}. Then ${tasks}.`
}
