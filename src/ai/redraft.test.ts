import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../lib/model'
import { useStore } from '../store/useStore'
import type { Project, RepoSignals } from '../types'
import { redraftFactCards } from './redraft'
import { useRedraftState } from './redraftState'
import { aiSyncApp } from './router'

vi.mock('./router', () => ({
  aiSyncApp: vi.fn(),
  isSampleRepo: (project: Project) => project.repo?.fullName.startsWith('acme-sample/') ?? false,
}))

const signals: RepoSignals = {
  hasReadme: true,
  secretFiles: [],
  lastCommitAt: '2026-10-04T10:00:00.000Z',
  openIssues: 0,
  openPrs: 0,
  syncedAt: '2026-10-04T10:00:00.000Z',
}

const project = (id: string, updatedAt: string, patch: Partial<Project> = {}): Project => ({
  ...appDefaults(),
  id,
  name: id,
  description: `${id} facts`,
  emoji: '🗂️',
  color: 'blue',
  createdAt: updatedAt,
  archived: false,
  repo: { fullName: `team/${id}`, url: `https://github.com/team/${id}`, private: true, defaultBranch: 'main' },
  signals: { ...signals, lastCommitAt: updatedAt },
  appCard: { what: `${id} facts`, who: 'Not stated.', stage: 'live', status: 'Facts only.', updatedAt, source: 'fallback' },
  ...patch,
})

const aiOutcome = (id: string) => ({
  card: { what: `${id} written`, who: 'Operators', stage: 'live' as const, status: 'Running' },
  signals,
  facts: { meta: { fullName: `team/${id}`, url: `https://github.com/team/${id}`, private: true, defaultBranch: 'main', description: null, pushedAt: null }, readme: null, files: [], deployFile: null, commits: [], pulls: [], issues: [] },
  source: 'ai' as const,
  note: null,
})

beforeEach(() => {
  // A saved key writes cards in legacy and both; mcp mode turns keys off.
  vi.stubEnv('VITE_AI_MODE', 'both')
  useStore.getState().resetAll()
  useRedraftState.getState().reset()
  useStore.getState().setAI({ provider: 'anthropic', apiKey: 'test-key' })
  vi.mocked(aiSyncApp).mockImplementation(async (id) => aiOutcome(id))
})

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

describe('redraftFactCards', () => {
  it('does nothing without an AI connection', async () => {
    useStore.getState().setAI({ provider: 'none' })
    useStore.setState({ projects: [project('facts', '2026-10-04T12:00:00.000Z')] })

    await expect(redraftFactCards()).resolves.toEqual([])
    expect(aiSyncApp).not.toHaveBeenCalled()
  })

  it('writes fallback cards newest first and skips AI, sample and archived cards', async () => {
    const projects = [
      project('old', '2026-10-04T09:00:00.000Z'),
      project('new', '2026-10-04T12:00:00.000Z'),
      project('middle', '2026-10-04T10:00:00.000Z'),
      project('sample', '2026-10-04T13:00:00.000Z', { repo: { fullName: 'acme-sample/sample', url: '#', private: true, defaultBranch: 'main' } }),
      project('archived', '2026-10-04T14:00:00.000Z', { archived: true }),
      project('done', '2026-10-04T15:00:00.000Z', { appCard: { what: 'Written', who: 'Team', stage: 'live', status: 'Running', updatedAt: '2026-10-04T15:00:00.000Z', source: 'ai' } }),
    ]
    useStore.setState({ projects })

    const events = await redraftFactCards({ concurrency: 2 })

    expect(vi.mocked(aiSyncApp).mock.calls.map(([id]) => id)).toEqual(['new', 'middle', 'old'])
    expect(events.filter((event) => event.type === 'written').map((event) => event.projectId)).toEqual(['new', 'middle', 'old'])
    expect(useStore.getState().projects.find((item) => item.id === 'new')?.appCard).toMatchObject({ what: 'new written', source: 'ai', checkedAt: null })
    expect(useRedraftState.getState().writingIds.size).toBe(0)
  })

  it('redrafts a selected AI card without adding AI cards to the automatic facts-only batch', async () => {
    const written = project('written', '2026-10-04T12:00:00.000Z', {
      appCard: { what: 'Old draft', who: 'Team', stage: 'live', status: 'Running', updatedAt: '2026-10-04T12:00:00.000Z', source: 'ai', checkedAt: null },
    })
    useStore.setState({ projects: [written] })

    await expect(redraftFactCards()).resolves.toEqual([])
    expect(aiSyncApp).not.toHaveBeenCalled()

    const events = await redraftFactCards({ projectIds: ['written'], concurrency: 1 })
    expect(aiSyncApp).toHaveBeenCalledWith('written')
    expect(events).toContainEqual(expect.objectContaining({ type: 'written', projectId: 'written' }))
  })

  it('keeps facts and stops before the next batch when drafting fails', async () => {
    useStore.setState({ projects: [
      project('new', '2026-10-04T12:00:00.000Z'),
      project('fails', '2026-10-04T11:00:00.000Z'),
      project('not-started', '2026-10-04T10:00:00.000Z'),
    ] })
    vi.mocked(aiSyncApp).mockImplementation(async (id) => id === 'fails'
      ? { ...aiOutcome(id), source: 'fallback', note: 'Provider is out of credit.' }
      : aiOutcome(id))

    const events = await redraftFactCards({ concurrency: 2 })

    expect(vi.mocked(aiSyncApp).mock.calls.map(([id]) => id)).toEqual(['new', 'fails'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'failed', projectId: 'fails' }))
    expect(useStore.getState().projects.find((item) => item.id === 'fails')?.appCard).toMatchObject({ what: 'fails facts', source: 'fallback' })
    expect(useStore.getState().projects.find((item) => item.id === 'not-started')?.appCard?.source).toBe('fallback')
    expect(useRedraftState.getState().writingIds.size).toBe(0)
  })
})
