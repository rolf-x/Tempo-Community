import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiSyncApp, type SyncOutcome } from '../../ai/router'
import { GitHubError } from '../../data/github'
import { useStore } from '../../store/useStore'
import { scanAI, syncAddedRepos } from './RepoPicker'

vi.mock('../../ai/router', () => ({ aiSyncApp: vi.fn() }))

const out: SyncOutcome = {
  card: { what: 'Web app', who: 'Team', stage: 'building', status: 'In progress' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: null, openIssues: 0, openPrs: 0, syncedAt: '2026-10-05' },
  facts: { meta: { fullName: 'acme/web', url: '', private: true, defaultBranch: 'main', description: null, pushedAt: null }, readme: null, files: [], deployFile: null, commits: [], pulls: [], issues: [] },
  source: 'fallback', note: null,
}

beforeEach(() => {
  vi.mocked(aiSyncApp).mockReset()
  useStore.getState().resetAll()
})

function apps() {
  return ['one', 'two', 'three'].map((name) => ({ name, id: useStore.getState().createProject({ name }).id }))
}

describe('bulk repo sync', () => {
  it('stops after a rate limit and leaves the current and remaining created apps for later', async () => {
    const created = apps()
    const error = new GitHubError('Sync after reset', 'rate-limit', Date.now() + 360_000)
    vi.mocked(aiSyncApp).mockResolvedValueOnce(out).mockRejectedValueOnce(error)
    const progress = vi.fn()
    const options = { signal: new AbortController().signal, onRateLimit: vi.fn() }
    const result = await syncAddedRepos(created, options, progress)
    expect([...result.rows.values()]).toEqual(['done', 'later', 'later'])
    expect(result.error).toBe(error)
    expect(aiSyncApp).toHaveBeenCalledTimes(2)
    expect(aiSyncApp).toHaveBeenLastCalledWith(created[1].id, options)
    expect(useStore.getState().projects).toHaveLength(3)
    expect(progress).toHaveBeenLastCalledWith(result.rows)
    expect([...result.rows.values()].some((state) => state === 'queued' || state === 'syncing')).toBe(false)
  })

  it('continues after ordinary failures and preserves successful cards', async () => {
    const created = apps()
    vi.mocked(aiSyncApp).mockRejectedValueOnce(new Error('Network')).mockResolvedValue(out)
    const result = await syncAddedRepos(created, {}, vi.fn())
    expect([...result.rows.values()]).toEqual(['failed', 'done', 'done'])
    expect(result.error).toBeNull()
    expect(aiSyncApp).toHaveBeenCalledTimes(3)
    expect(useStore.getState().projects.find((p) => p.id === created[2].id)?.appCard?.what).toBe('Web app')
  })

  it('finishes every row when all syncs succeed', async () => {
    vi.mocked(aiSyncApp).mockResolvedValue(out)
    const result = await syncAddedRepos(apps(), {}, vi.fn())
    expect([...result.rows.values()]).toEqual(['done', 'done', 'done'])
    expect(result.error).toBeNull()
  })
})

describe('what the end of the scan says about AI', () => {
  const base = { mcp: true, keyed: false, sample: false, signedIn: true, aiApps: 0 as number | null, claudeStepShown: false }
  const scan = (patch: Partial<typeof base> = {}) => scanAI({ ...base, ...patch })

  it('first visit with Claude on and no key: the button reads Next and opens the Claude window', () => {
    expect(scan()).toEqual({ aiConnected: false, claudeNext: true, claudeCanDraft: false })
  })

  it('skips that window once it has been shown, and offers to connect Claude instead', () => {
    expect(scan({ claudeStepShown: true })).toEqual({ aiConnected: false, claudeNext: false, claudeCanDraft: false })
  })

  it('with a key the cards are already written: no Claude window, no "facts only" line, no "ask Claude" line', () => {
    expect(scan({ keyed: true })).toEqual({ aiConnected: true, claudeNext: false, claudeCanDraft: false })
    expect(scan({ keyed: true, aiApps: 2, claudeStepShown: true })).toEqual({ aiConnected: true, claudeNext: false, claudeCanDraft: false })
  })

  it('with Claude connected and no key, after the window: "Ask Claude to draft them"', () => {
    expect(scan({ aiApps: 1, claudeStepShown: true })).toEqual({ aiConnected: true, claudeNext: false, claudeCanDraft: true })
  })

  it("doesn't call a still-loading list a missing connection", () => {
    expect(scan({ aiApps: null, claudeStepShown: true }).aiConnected).toBe(true)
  })

  it('leaves the sample and legacy mode as they were', () => {
    expect(scan({ sample: true })).toEqual({ aiConnected: true, claudeNext: false, claudeCanDraft: false })
    expect(scan({ mcp: false })).toEqual({ aiConnected: false, claudeNext: false, claudeCanDraft: false })
    expect(scan({ mcp: false, keyed: true }).aiConnected).toBe(true)
  })

  it('needs a signed-in person for the Claude window', () => {
    expect(scan({ signedIn: false }).claudeNext).toBe(false)
  })
})
