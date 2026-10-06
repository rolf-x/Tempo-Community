// Navigation layer for app-card sync and handover generation.
import { useStore } from '../store/useStore'
import { todayISO } from '../lib/dates'
import type { Activity, Project, Provider, RepoSignals } from '../types'
import { applySync, fallbackSync, type SyncResult } from './tools/applySync'
import { cleanHandover, factUrls, fallbackHandover, withDeploymentEvidence } from './tools/handoverFallback'
import { handoverMarkdown } from './tools/handoverMarkdown'
import { health } from './tools/health'
import type { HandoverOut } from './schemas'
import { repoFacts, type RepoFacts } from './tools/repoFacts'
import { handoverInput, syncAppInput } from './tools/promptInput'
import { fetchRepoRaw, waitForGitHubReset, type RepoReadOptions } from '../data/github'
import { isPersonal } from '../lib/model'
import { useSession } from '../data/session'
import { AIError, callTool, listModels, testConnection } from './client'
import { explainAIError } from './errors'
import { handoverSystem, syncAppSystem } from './prompts'
import { workspaceAI } from './workspaceAI'
import { mcpEnabled } from '../lib/aiMode'
import { aiAppName } from '../lib/mcpSetup'
import { isSampleRepo } from '../lib/sampleRepo'
import { closeFixedTasks } from '../lib/tasks'

export { listModels, testConnection, AIError }

const ai = () => workspaceAI(useStore.getState().settings)
export { SAMPLE_OWNER, isSampleRepo } from '../lib/sampleRepo'

/** Sample repos have no GitHub behind them: their facts come from seeded activity. */
export function sampleFacts(project: Project, activity: Activity[], now = new Date().toISOString()): { facts: RepoFacts; signals: RepoSignals } {
  const mine = activity.filter((item) => item.projectId === project.id && item.url)
  const facts: RepoFacts = {
    meta: { fullName: project.repo!.fullName, url: project.repo!.url, private: project.repo!.private, defaultBranch: project.repo!.defaultBranch, description: project.description, pushedAt: project.signals?.lastCommitAt ?? null },
    readme: project.signals?.hasReadme ? `# ${project.name}\n\n${project.description}` : null,
    files: [],
    deployFile: project.appCard?.evidence?.deployFile ?? null,
    commits: mine.filter((item) => item.kind === 'commit').map((item) => ({ sha: item.url!.split('/').pop()!.slice(0, 7), message: item.title, author: item.actor, date: item.at, url: item.url! })),
    pulls: mine.filter((item) => item.kind === 'pr').map((item) => ({ number: Number(item.url!.split('/').pop()), title: item.title, author: item.actor, url: item.url!, draft: false, createdAt: item.at })),
    issues: mine.filter((item) => item.kind === 'issue').map((item) => ({ number: Number(item.url!.split('/').pop()), title: item.title, url: item.url!, labels: [], createdAt: item.at })),
  }
  return { facts, signals: { ...(project.signals ?? { hasReadme: false, secretFiles: [], lastCommitAt: null, openIssues: 0, openPrs: 0 }), syncedAt: now } }
}

export interface SyncOutcome extends SyncResult {
  signals: RepoSignals
  source: 'ai' | 'fallback' | 'demo'
  note: string | null
  facts: RepoFacts
  error?: string | null
  errorProvider?: Provider
}

/**
 * What a sync saves besides the card: the fresh signals, and `fixedAt` on every open task whose health flag is gone
 * (judged with the same inputs the app page and the portfolio use), so a fixed task can't come back. The tasks are read
 * from the store now, not before the repo was fetched, so a task removed or added in the meantime isn't overwritten.
 */
function syncPatch(projectId: string, signals: RepoSignals, now: string, meta?: { fullName: string; private: boolean }): Pick<Project, 'signals'> & Partial<Pick<Project, 'tasks'>> {
  const { projects, members, workspace } = useStore.getState()
  const current = projects.find((item) => item.id === projectId)
  if (!current?.tasks?.length || current.archived) return { signals }
  // The repo's visibility as GitHub reports it now (the caller saves it after), so a repo made private closes its task on this sync.
  const repo = current.repo && meta && current.repo.fullName === meta.fullName ? { ...current.repo, private: meta.private } : current.repo
  const flags = health({ ...current, repo, signals }, members, new Date(now), { personal: isPersonal(workspace), keptAt: current.keptAt })
  const tasks = closeFixedTasks(current.tasks, new Set(flags.map((flag) => flag.kind)), now)
  return tasks ? { signals, tasks } : { signals }
}

/**
 * Read the repo and draft its app card. Factual health signals save immediately; the card waits for review.
 * `factsOnly` never calls an AI provider: it refreshes the facts and returns Tempo's facts-only card (Sync all, for every app
 * without a key and for apps that don't want a description with one). `onStep` says where it is, for Sync all's progress
 * window: 'reading' before the GitHub fetch, 'writing' right before the AI call (never with `factsOnly`).
 */
export async function aiSyncApp(
  projectId: string,
  { factsOnly = false, onStep, ...opts }: RepoReadOptions & { factsOnly?: boolean; onStep?: (step: 'reading' | 'writing') => void } = {},
): Promise<SyncOutcome> {
  const { projects, activity } = useStore.getState()
  const project = projects.find((item) => item.id === projectId)
  if (!project) throw new AIError("That app doesn't exist any more.")
  if (!project.repo) throw new AIError('Connect a repo to this app first.')
  const now = new Date().toISOString()

  if (isSampleRepo(project)) {
    const { facts, signals } = sampleFacts(project, activity, now)
    useStore.getState().updateProject(projectId, syncPatch(projectId, signals, now))
    const fallback = fallbackSync(facts, { signals }, now)
    return {
      card: project.appCard ? { what: project.appCard.what, who: project.appCard.who, stage: project.appCard.stage, status: project.appCard.status } : fallback.card,
      signals, facts, source: 'demo', note: 'Sample repo: card refreshed from its seeded activity.',
    }
  }

  const token = useSession.getState().githubToken
  if (!token) throw new AIError('Connect GitHub to sync this app.')
  onStep?.('reading')
  const { facts, signals } = repoFacts(await fetchRepoRaw(token, project.repo.fullName, {
    ...opts,
    onRateLimit: opts.onRateLimit ?? ((error) => waitForGitHubReset(error, 60_000, opts.signal)),
  }), now)
  // The repo was changed (or the app deleted) while GitHub answered: these facts belong to the old repo, so keep none.
  const after = useStore.getState().projects.find((item) => item.id === projectId)
  if (after?.repo?.fullName.toLowerCase() !== project.repo.fullName.toLowerCase()) throw new AIError("This app's repo changed while syncing. Sync again.")
  useStore.getState().updateProject(projectId, syncPatch(projectId, signals, now, facts.meta))
  const settings = ai()
  // With Claude (MCP) on and no key, the browser doesn't write the card; the connected AI app does.
  const noAI = mcpEnabled() ? `Facts only. Ask ${aiAppName()} to draft the written card.` : 'No AI connected: facts only. Pick your AI for a written card.'
  if (settings.provider === 'none' || factsOnly) return { ...fallbackSync(facts, { signals }, now), signals, facts, source: 'fallback', note: noAI }
  if (settings.provider === 'demo') return { ...fallbackSync(facts, { signals }, now), signals, facts, source: 'fallback', note: 'Sample mode: rules only. Add an AI key for a written card.' }

  const user = syncAppInput(project, facts)
  onStep?.('writing')
  try {
    const out = await callTool({ tool: 'sync_app', system: syncAppSystem({ today: todayISO() }), user }, settings)
    return { ...applySync(out, { facts, signals }), signals, facts, source: 'ai', note: null }
  } catch (error) {
    return {
      ...fallbackSync(facts, { signals }, now), signals, facts, source: 'fallback', note: null,
      error: explainAIError(error, settings.provider).details, errorProvider: settings.provider,
    }
  }
}

export interface HandoverOutcome {
  doc: HandoverOut
  source: 'ai' | 'fallback'
  markdown: string
}

export async function aiHandover(projectId: string): Promise<HandoverOutcome> {
  const { projects, members, activity, workspace } = useStore.getState()
  const project = projects.find((item) => item.id === projectId)
  if (!project) throw new AIError("That app doesn't exist any more.")
  if (!project.repo) throw new AIError('Connect a repo to this app first.')
  const now = new Date()
  let facts: RepoFacts
  let fetchedLiveUrl: string | null = null
  if (isSampleRepo(project)) {
    const sample = sampleFacts(project, activity, now.toISOString())
    facts = sample.facts
    fetchedLiveUrl = sample.signals.liveUrl ?? null
  } else {
    const token = useSession.getState().githubToken
    if (!token) throw new AIError('Connect GitHub to write a handover pack.')
    const fresh = repoFacts(await fetchRepoRaw(token, project.repo.fullName), now.toISOString())
    facts = fresh.facts
    fetchedLiveUrl = fresh.signals.liveUrl ?? null
  }
  const flags = health(project, members, now, { personal: isPersonal(workspace), keptAt: project.keptAt })
  const owner = members.find((member) => member.id === project.ownerId)?.name ?? null
  const liveUrl = [project.liveUrl, fetchedLiveUrl, project.signals?.liveUrl].find((url): url is string => !!url?.trim())?.trim() ?? null
  const deployment = { liveUrl, deployFile: facts.deployFile ?? project.appCard?.evidence?.deployFile ?? null }
  const finish = (doc: HandoverOut, source: 'ai' | 'fallback'): HandoverOutcome => ({ doc, source, markdown: handoverMarkdown(doc, project.name) })
  const fallback = () => {
    const doc = fallbackHandover(facts, flags, owner, deployment)
    return finish({ ...doc, summary: `Built from repo facts. ${doc.summary}` }, 'fallback')
  }
  const settings = ai()
  if (settings.provider === 'none' || settings.provider === 'demo' || isSampleRepo(project)) return fallback()
  const user = handoverInput({ project, owner, deployment, facts, flags })
  try {
    const out = await callTool({ tool: 'handover', system: handoverSystem({ today: todayISO(), owner }), user }, settings)
    // The AI's strings become plain text and it may link only to URLs it was shown; our own deployment evidence goes in after.
    return finish(withDeploymentEvidence(cleanHandover(out, factUrls(facts)), deployment), 'ai')
  } catch {
    return fallback()
  }
}
