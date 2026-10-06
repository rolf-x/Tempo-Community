import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { useUI } from '../components/uiState'
import type { SyncOutcome } from '../ai/router'
import { aiSyncApp } from '../ai/router'
import { aiWriteTasks } from '../ai/keyTasks'
import { syncAppNow, type SyncNowIO } from './appSyncNow'

vi.mock('../ai/router', async (importOriginal) => ({ ...(await importOriginal<typeof import('../ai/router')>()), aiSyncApp: vi.fn() }))
vi.mock('../ai/keyTasks', async (importOriginal) => ({ ...(await importOriginal<typeof import('../ai/keyTasks')>()), aiWriteTasks: vi.fn() }))
const sync = vi.mocked(aiSyncApp)
const write = vi.mocked(aiWriteTasks)

const now = () => new Date().toISOString()
const repo = { fullName: 'acme/web', url: 'https://github.com/acme/web', private: true, defaultBranch: 'main' }
const signals = { hasReadme: true, secretFiles: [], lastCommitAt: now(), openIssues: 0, openPrs: 0, syncedAt: now() }
const outcome = (patch: Partial<SyncOutcome> = {}): SyncOutcome => ({
  card: { what: 'Tracks invoices.', who: 'Finance', stage: 'live', status: 'Quiet' }, signals, source: 'ai', note: null,
  facts: { meta: { fullName: 'acme/web', url: repo.url, private: true, defaultBranch: 'main', description: null, pushedAt: null }, readme: null, files: [], deployFile: null, commits: [], pulls: [], issues: [] },
  ...patch,
})
const toast = () => useUI.getState().toast
const state = () => useStore.getState()

let events: string[]
let io: SyncNowIO
/** An app with no owner, so it has a flag and no task for it. */
const app = (patch: Record<string, unknown> = {}) => state().createProject({ name: 'Web', repo, ownerId: null, signals, ...patch }).id

beforeEach(() => {
  vi.stubEnv('VITE_AI_MODE', 'both')
  state().resetAll()
  state().setAI({ provider: 'anthropic', apiKey: 'k' })
  useUI.setState({ toast: null })
  sync.mockReset()
  write.mockReset()
  events = []
  sync.mockImplementation(async () => { events.push('card'); return outcome() })
  write.mockImplementation(async () => { events.push('tasks'); return { written: 3 } })
  io = {
    run: async (action) => action(),
    onFacts: () => events.push('facts'),
    onReview: () => events.push('review'),
    onAddingTasks: (adding) => events.push(adding ? 'adding' : 'done'),
  }
})
afterEach(() => vi.unstubAllEnvs())

describe('Sync now with an AI key', () => {
  it('adds tasks after the card step, shows "Adding tasks…" around it, and says how many', async () => {
    const id = app()
    await syncAppNow(id, io)
    expect(events).toEqual(['card', 'facts', 'review', 'adding', 'tasks', 'done'])
    expect(write).toHaveBeenCalledWith(id)
    expect(toast()).toMatchObject({ message: 'Added 3 tasks', tone: 'success' })
  })

  it('says "Added 1 task" for one', async () => {
    write.mockResolvedValue({ written: 1 })
    await syncAppNow(app(), io)
    expect(toast()!.message).toBe('Added 1 task')
  })

  it('saves the card first with auto-apply, and reports both in one notice', async () => {
    const id = app({ autoApply: true })
    await syncAppNow(id, io)
    expect(events).toEqual(['card', 'facts', 'adding', 'tasks', 'done'])
    expect(state().projects[0].appCard).toMatchObject({ what: 'Tracks invoices.', source: 'ai' })
    expect(toast()!.message).toBe('Card refreshed · Added 3 tasks')
  })

  it('stays quiet about tasks when none were written', async () => {
    write.mockResolvedValue({ written: 0 })
    await syncAppNow(app({ autoApply: true }), io)
    expect(toast()!.message).toBe('Card refreshed')
    useUI.setState({ toast: null })
    await syncAppNow(app(), io)
    expect(toast()).toBeNull()
  })

  it('does not ask for tasks when the app has no flag without a task', async () => {
    await syncAppNow(app({ ownerId: state().meId }), io)
    expect(write).not.toHaveBeenCalled()
    expect(events).toEqual(['card', 'facts', 'review'])
  })

  it('does not add tasks when the card step failed', async () => {
    sync.mockResolvedValue(outcome({ source: 'fallback', error: 'OpenAI is out of credit.' }))
    await syncAppNow(app(), io)
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps the synced card when the tasks fail, with a short neutral notice', async () => {
    write.mockRejectedValue(new Error('boom'))
    const id = app({ autoApply: true })
    await expect(syncAppNow(id, io)).resolves.toBeUndefined()
    expect(events.slice(-2)).toEqual(['adding', 'done'])
    expect(state().projects.find((p) => p.id === id)!.appCard?.what).toBe('Tracks invoices.')
    expect(toast()).toMatchObject({ message: "Card refreshed, but Tempo couldn't add tasks this time.", tone: 'neutral' })
    await syncAppNow(app(), io)
    expect(toast()!.message).toBe("Synced, but Tempo couldn't add tasks this time.")
  })

  it('still reports a sync that failed', async () => {
    sync.mockRejectedValue(new Error('GitHub is down'))
    await expect(syncAppNow(app(), io)).rejects.toThrow('GitHub is down')
    expect(write).not.toHaveBeenCalled()
  })

  it('does nothing more when the person did not connect GitHub', async () => {
    io.run = async () => undefined
    await syncAppNow(app(), io)
    expect(events).toEqual([])
    expect(write).not.toHaveBeenCalled()
  })
})

describe('Sync now without a key', () => {
  it.each(['none', 'demo'] as const)('never asks for tasks (%s)', async (provider) => {
    state().setAI({ provider })
    await syncAppNow(app({ autoApply: true }), io)
    expect(write).not.toHaveBeenCalled()
    expect(events).toEqual(['card', 'facts'])
    expect(toast()!.message).toBe('Card refreshed')
  })

  it('never asks for tasks when the browser makes no AI calls, even with a key saved', async () => {
    vi.stubEnv('VITE_AI_MODE', 'mcp')
    await syncAppNow(app(), io)
    expect(write).not.toHaveBeenCalled()
  })
})
