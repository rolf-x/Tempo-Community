import { useStore } from '../store/useStore'
import type { Project } from '../types'
import { aiSyncApp, isSampleRepo } from './router'
import { useRedraftState } from './redraftState'
import { workspaceAI } from './workspaceAI'

export type RedraftEvent = {
  type: 'writing' | 'written' | 'failed'
  projectId: string
  completed: number
  total: number
  message?: string
}

export interface RedraftOptions {
  /** Limit a retry to specific cards. Omit to write every facts-only card. */
  projectIds?: string[]
  /** Kept small so connecting AI does not fan out into an unbounded set of provider calls. */
  concurrency?: number
  onProgress?: (event: RedraftEvent) => void
}

const newestCardFirst = (a: Project, b: Project) => {
  const stamp = (project: Project) => project.lastActivityAt ?? project.signals?.lastCommitAt ?? project.appCard?.updatedAt ?? project.createdAt
  return stamp(b).localeCompare(stamp(a)) || a.id.localeCompare(b.id)
}

/**
 * Replace facts-only cards with AI-written drafts. Successful cards land immediately; if a provider
 * call falls back or throws, that card keeps its facts and no later batch is started.
 */
export async function redraftFactCards(options: RedraftOptions = {}): Promise<RedraftEvent[]> {
  const state = useStore.getState()
  const provider = workspaceAI(state.settings).provider
  if (provider === 'none' || provider === 'demo') return []

  const only = options.projectIds ? new Set(options.projectIds) : null
  const alreadyWriting = useRedraftState.getState().writingIds
  const candidates = state.projects
    .filter((project) =>
      !project.archived
      && (only ? !!project.appCard : project.appCard?.source === 'fallback')
      && !isSampleRepo(project)
      && (!only || only.has(project.id))
      && !alreadyWriting.has(project.id),
    )
    .sort(newestCardFirst)

  if (candidates.length === 0) return []

  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 3)))
  const events: RedraftEvent[] = []
  let completed = 0
  let stopped = false
  const emit = (event: RedraftEvent) => {
    events.push(event)
    options.onProgress?.(event)
  }

  for (let offset = 0; offset < candidates.length && !stopped; offset += concurrency) {
    const batch = candidates.slice(offset, offset + concurrency)
    useRedraftState.getState().startWriting(batch.map((project) => project.id))
    for (const project of batch) emit({ type: 'writing', projectId: project.id, completed, total: candidates.length })

    const results = await Promise.all(batch.map(async (project) => {
      try {
        const outcome = await aiSyncApp(project.id)
        return { project, outcome }
      } catch (error) {
        return { project, error }
      }
    }))

    for (const result of results) {
      completed += 1
      useRedraftState.getState().finishWriting(result.project.id)

      if ('error' in result) {
        const message = result.error instanceof Error ? result.error.message : "Tempo couldn't write this card."
        emit({ type: 'failed', projectId: result.project.id, completed, total: candidates.length, message })
        stopped = true
        continue
      }

      if (result.outcome.source !== 'ai') {
        const message = result.outcome.error ?? result.outcome.note ?? "Tempo couldn't write this card."
        emit({ type: 'failed', projectId: result.project.id, completed, total: candidates.length, message })
        stopped = true
        continue
      }

      useStore.getState().commitSync(
        result.project.id,
        { card: result.outcome.card, signals: result.outcome.signals, source: result.outcome.source },
      )
      emit({ type: 'written', projectId: result.project.id, completed, total: candidates.length })
    }
  }

  return events
}
