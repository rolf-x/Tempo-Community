// "Sync all" (Portfolio): refresh the GitHub facts of every app the person can edit, two at a time. It never replaces
// a card that a person checked or a draft waiting in Review. Two ways to get descriptions:
//   with an API key  Tempo does everything itself:
//                    it refreshes the facts, writes a description for an app that wants one (no card, only Tempo's facts-only
//                    one, or an AI card the repo has moved past; saved as an unchecked draft, the same commitSync the repo
//                    scan uses), then adds tasks for health flags that have none. The AI is called only for work that is
//                    needed, so no tokens are wasted. A progress window shows where it is (SyncAllProgress.tsx); it can be
//                    closed, and a small pill at the bottom of the screen reopens it. The Claude window never opens.
//   without a key    facts only; an app with no card gets Tempo's facts-only card. When Claude (MCP) is on and has
//                    something left to do, the run ends by opening the Claude window. No progress window.
import { create } from 'zustand'
import { isUncheckedAICard, type Member, type Project, type Workspace } from '../types'
import { useStore } from '../store/useStore'
import { aiSyncApp, type SyncOutcome } from '../ai/router'
import { aiWriteTasks, appWantsTasks } from '../ai/keyTasks'
import { health } from '../ai/tools/health'
import { canWriteCards } from '../ai/workspaceAI'
import { mcpEnabled } from '../lib/aiMode'
import { appsNeedingCard, needsCard } from '../lib/claudeWork'
import { isPersonal } from '../lib/model'
import { canEditApp } from '../lib/permissions'
import { isSampleRepo } from '../lib/sampleRepo'
import { runGitHubGated } from '../components/ConnectGitHubDialog'
import { openClaudeWindow, useUI } from '../components/uiState'
import { GitHubError } from './github'

/** Where one app is in a run: waiting its turn, then reading GitHub, writing its description, adding tasks, and finished. */
export type SyncStep = 'waiting' | 'reading' | 'writing' | 'tasks' | 'done' | 'failed'

export interface SyncAppProgress {
  id: string
  name: string
  step: SyncStep
  /** A description was written (an unchecked draft, waiting in Review). */
  wrote: boolean
  /** Tasks added for this app. */
  tasks: number
}

/** What a run came to, for the window and the notice. */
export interface SyncSummary {
  total: number
  /** Apps that couldn't sync. */
  failed: number
  /** Descriptions written and saved as drafts. */
  wrote: number
  /** Apps that wanted a description and didn't get one because the AI didn't answer. */
  couldnt: number
  /** Apps that got tasks, and how many tasks in all. */
  taskApps: number
  tasks: number
  /** Apps that wanted tasks and didn't get them because the AI didn't answer. */
  couldntTasks: number
}

interface SyncAllState {
  running: boolean
  /** Apps finished so far, synced or failed. */
  done: number
  total: number
  /** Ids of the apps that couldn't sync in the last run. */
  failed: string[]
  /** This run uses an API key, so it has a progress window. */
  ai: boolean
  /** One row per app, in run order. Empty without a key. */
  apps: SyncAppProgress[]
  /** The progress window: open, minimised to the pill at the bottom of the screen, or gone. */
  view: 'open' | 'mini' | null
  /** Set when a run with a key ends; the window shows it until it is closed. */
  summary: SyncSummary | null
}

export const useSyncAll = create<SyncAllState>()(() => ({ running: false, done: 0, total: 0, failed: [], ai: false, apps: [], view: null, summary: null }))

/** Two apps at a time keeps GitHub's rate limit happy and the page responsive. */
export const SYNC_CONCURRENCY = 2

/** Not archived, has a real repo (not a sample), and the person may edit it: the same rule as the app page's Sync now. */
export function canSyncApp(project: Project, me: Member | null | undefined, workspace: Workspace | null | undefined): boolean {
  if (project.archived || !project.repo || isSampleRepo(project)) return false
  return !workspace || canEditApp(me, project)
}

export const syncableApps = (projects: Project[], me: Member | null | undefined, workspace: Workspace | null | undefined) =>
  projects.filter((project) => canSyncApp(project, me, workspace))

/**
 * Does Claude have something to do? An app needs a card, or has a health flag no open task covers. A task that is
 * already fixed doesn't cover its flag: if the flag is back, it needs a new one.
 */
export function claudeHasWork(projects: Project[], members: Member[], options: { personal?: boolean; now?: Date } = {}): boolean {
  if (appsNeedingCard(projects).length) return true
  return projects.some((project) => {
    if (project.archived || !project.repo || isSampleRepo(project)) return false
    const open = new Set((project.tasks ?? []).filter((task) => task.fixedAt === null).map((task) => task.problem))
    return health(project, members, options.now, { personal: options.personal, keptAt: project.keptAt }).some((flag) => !open.has(flag.kind))
  })
}

/**
 * An app Sync all may write a description for with a key: it needs a card (src/lib/claudeWork.ts): it has none yet, only
 * Tempo's facts-only one, or an AI card the repo has moved past. A person's checked card is then redrafted as a new
 * unchecked draft (Review shows what changed); a draft already waiting in Review is never replaced, so a sync can't flood
 * Review or undo a check.
 */
export const wantsCard = (project: Project): boolean => needsCard(project) && !isUncheckedAICard(project.appCard)

/** One Sync all run: whether a key does the work, and what came of it. */
interface Run {
  ai: boolean
  /** Descriptions written and saved as drafts. */
  wrote: number
  /** Apps that wanted a description and didn't get one because the AI didn't answer. */
  couldnt: number
  /** Apps that got tasks, how many tasks in all, and apps that wanted tasks and didn't get them. */
  taskApps: number
  tasks: number
  couldntTasks: number
  /** The AI failed once (a description or tasks): the rest of the run is facts only, so a bad key isn't tried on every app. */
  broken: boolean
}

const findApp = (id: string) => useStore.getState().projects.find((project) => project.id === id)

/** Updates one app's row in the progress window. Without a key there are no rows, so this does nothing. */
const track = (id: string, patch: Partial<Pick<SyncAppProgress, 'step' | 'wrote' | 'tasks'>>) =>
  useSyncAll.setState((state) => (state.apps.length ? { apps: state.apps.map((app) => (app.id === id ? { ...app, ...patch } : app)) } : state))

/** Saves the repo's visibility as GitHub just reported it (aiSyncApp already saved the facts). Returns the app, or undefined when it was deleted while syncing. */
function saveVisibility(id: string, out: SyncOutcome): Project | undefined {
  const current = findApp(id)
  if (current?.repo && current.repo.fullName === out.facts.meta.fullName && current.repo.private !== out.facts.meta.private) {
    useStore.getState().updateProject(id, { repo: { ...current.repo, private: out.facts.meta.private } })
  }
  return current && findApp(id)
}

/** What a Sync all does for one app besides the facts aiSyncApp already saved: the repo's visibility, then with a key a description (see wantsCard) and tasks, or the facts-only card when there is none. */
async function syncOne(id: string, run: Run): Promise<void> {
  const onStep = (step: 'reading' | 'writing') => track(id, { step })
  // The AI is called only for an app that wants a description; every other app stays facts-only, so no tokens are wasted.
  const read = (useAI: boolean) => aiSyncApp(id, run.ai ? (useAI ? { onStep } : { factsOnly: true, onStep }) : { factsOnly: true })
  track(id, { step: 'reading' })
  const before = findApp(id)
  let wants = run.ai && !!before && wantsCard(before)
  let useAI = wants && !run.broken
  let out = await read(useAI)
  let current = saveVisibility(id, out)
  if (!current) return // deleted while syncing
  // The facts just saved can show that the card is out of date (a new commit, a repo made public): write it now, not at the next Sync all.
  if (run.ai && !wants && !run.broken && wantsCard(current)) {
    wants = useAI = true
    out = await read(true)
    current = saveVisibility(id, out)
    if (!current) return
  }
  if (useAI && out.source === 'ai') {
    // The card is looked at again now: if a person or Claude wrote one while the AI was working, it stays.
    const latest = findApp(id)
    if (!latest) return
    if (wantsCard(latest)) {
      useStore.getState().commitSync(id, { card: out.card, signals: out.signals, source: out.source })
      // An identical card keeps its check (commitSync): that is no new draft for Review.
      if (isUncheckedAICard(findApp(id)?.appCard)) {
        run.wrote++
        track(id, { wrote: true })
      }
    }
  } else {
    if (wants) {
      run.couldnt++
      if (useAI) run.broken = true
    }
    // The same facts-only card the repo scan saves for a new app. An existing card, or a draft waiting in Review, stays.
    if (!findApp(id)?.appCard) {
      useStore.getState().commitSync(id, { card: out.card, signals: out.signals, source: out.source })
    }
  }
  if (!run.ai || run.broken) return
  // Tasks for the health flags no open task covers, from the facts saved a moment ago.
  const latest = findApp(id)
  if (!latest || !appWantsTasks(latest, useStore.getState().members)) return
  track(id, { step: 'tasks' })
  try {
    const { written } = await aiWriteTasks(id)
    if (written > 0) {
      run.taskApps++
      run.tasks += written
      track(id, { tasks: written })
    }
  } catch {
    run.couldntTasks++
    run.broken = true
  }
}

/** Returns the ids that failed. An expired GitHub sign-in stops the run and is thrown, so the connect flow can ask again. */
async function syncApps(ids: string[], run: Run): Promise<string[]> {
  const names = new Map(useStore.getState().projects.map((project) => [project.id, project.name]))
  const rows: SyncAppProgress[] = run.ai ? ids.map((id) => ({ id, name: names.get(id) ?? 'App', step: 'waiting', wrote: false, tasks: 0 })) : []
  // The window opens as the work starts (after GitHub is connected). A retry after signing in again keeps it as the person left it.
  useSyncAll.setState((state) => ({ done: 0, total: ids.length, failed: [], apps: rows, view: run.ai ? (state.view ?? 'open') : null }))
  const failed: string[] = []
  let authError: GitHubError | null = null
  let next = 0
  const worker = async () => {
    while (!authError && next < ids.length) {
      const id = ids[next++]
      try {
        await syncOne(id, run)
        track(id, { step: 'done' })
      } catch (error) {
        if (error instanceof GitHubError && error.kind === 'auth') {
          authError = error
          track(id, { step: 'waiting' }) // the run starts again after sign-in
          return
        }
        failed.push(id)
        track(id, { step: 'failed' })
      }
      useSyncAll.setState((state) => ({ done: state.done + 1, failed: [...failed] }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, ids.length) }, worker))
  if (authError) throw authError
  return failed
}

const apps = (count: number) => `${count} ${count === 1 ? 'app' : 'apps'}`

const descriptions = (count: number) => `${count} ${count === 1 ? 'description' : 'descriptions'}`

/** What a run says about itself, one sentence each. `hints` adds what to do next (the notice); the window has buttons for that. */
function sentences(summary: SyncSummary, hints: boolean): string[] {
  const { total, failed, wrote, couldnt, taskApps, couldntTasks } = summary
  return [
    failed ? `Synced ${total - failed} of ${apps(total)}. ${failed} couldn't sync.` : `Synced ${apps(total)}.`,
    wrote ? `Wrote ${descriptions(wrote)}.${hints ? ' Check them in Review.' : ''}` : '',
    taskApps ? `Added tasks to ${apps(taskApps)}.` : '',
    couldnt ? `Your AI couldn't write ${descriptions(couldnt)}.${hints ? ' Try Sync now on those apps.' : ''}` : '',
    couldntTasks ? `Your AI couldn't add tasks to ${apps(couldntTasks)}.${hints ? ' Try Sync now on those apps.' : ''}` : '',
  ].filter(Boolean)
}

/** The window's summary: "Done. Synced 50 apps. Wrote 12 descriptions. Added tasks to 9 apps." */
export const summaryText = (summary: SyncSummary): string => ['Done.', ...sentences(summary, false)].join(' ')

/** The notice at the end: what synced, and, with a key, what was written and what wasn't. */
function doneNotice(summary: SyncSummary): { text: string; tone: 'success' | 'danger' | 'neutral' } {
  const list = sentences(summary, true)
  return {
    // A run with nothing to add reads "Synced 5 apps", with no full stop.
    text: list.length === 1 && !summary.failed ? list[0].replace(/\.$/, '') : list.join(' '),
    tone: summary.failed ? 'danger' : summary.couldnt || summary.couldntTasks ? 'neutral' : 'success',
  }
}

/** Opens the progress window again, from the pill. */
export const openSyncWindow = () => useSyncAll.setState((state) => (state.ai && (state.running || state.summary) ? { view: 'open' } : {}))

/** Closes the window: while it is running it shrinks to the pill, and once it is done it goes, with its summary. */
export const closeSyncWindow = () => useSyncAll.setState((state) => (state.running ? { view: 'mini' } : { view: null, summary: null }))

export async function syncAll(): Promise<void> {
  if (useSyncAll.getState().running) return
  const { projects, members, meId, workspace, settings } = useStore.getState()
  const me = members.find((member) => member.id === meId) ?? null
  const ids = syncableApps(projects, me, workspace).map((project) => project.id)
  const { notify } = useUI.getState()
  if (!ids.length) {
    notify('No apps to sync')
    return
  }
  // With a key, Tempo writes the descriptions as it syncs. Decided once, at the click.
  const run: Run = { ai: canWriteCards(settings), wrote: 0, couldnt: 0, taskApps: 0, tasks: 0, couldntTasks: 0, broken: false }
  useSyncAll.setState({ running: true, done: 0, total: ids.length, failed: [], ai: run.ai, apps: [], view: null, summary: null })
  let summary: SyncSummary | null = null
  try {
    // Without a GitHub connection this opens the same connect dialog as Sync now, and stops if it isn't connected.
    const failed = await runGitHubGated(() => syncApps(ids, run))
    if (!failed) return
    summary = { total: ids.length, failed: failed.length, wrote: run.wrote, couldnt: run.couldnt, taskApps: run.taskApps, tasks: run.tasks, couldntTasks: run.couldntTasks }
    const notice = doneNotice(summary)
    notify(notice.text, notice.tone)
    // With a key the descriptions are done, so Claude's window stays shut. Without one, and with Claude on (mcp or both),
    // it opens when Claude has something left to do.
    if (mcpEnabled() && !run.ai) {
      // Only the apps this person may edit: Claude writes as them.
      const state = useStore.getState()
      const mine = syncableApps(state.projects, state.members.find((member) => member.id === state.meId), state.workspace)
      if (claudeHasWork(mine, state.members, { personal: isPersonal(state.workspace) })) openClaudeWindow('sync')
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : "Couldn't sync your apps.", 'danger')
  } finally {
    // The window stays as the person left it (open, or the pill) to show the summary. With none (GitHub isn't connected,
    // or the run stopped on an error) there is nothing to show, and the notice says what happened.
    useSyncAll.setState((state) => ({ running: false, summary: run.ai ? summary : null, view: run.ai && summary ? state.view : null }))
  }
}
