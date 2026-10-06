import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCard, AppTask, Project, RepoSignals } from '../types'
import { useStore } from '../store/useStore'
import { makeMember } from '../store/migrate'
import { useUI } from '../components/uiState'
import { aiSyncApp, type SyncOutcome } from '../ai/router'
import { aiWriteTasks, appWantsTasks } from '../ai/keyTasks'
import { runGitHubGated } from '../components/ConnectGitHubDialog'
import { GitHubError } from './github'
import { needsCard } from '../lib/claudeWork'
import { SYNC_CONCURRENCY, claudeHasWork, closeSyncWindow, openSyncWindow, summaryText, syncAll, syncableApps, useSyncAll, wantsCard } from './syncAll'

vi.mock('../ai/router', () => ({ aiSyncApp: vi.fn() }))
vi.mock('../ai/keyTasks', () => ({ appWantsTasks: vi.fn(() => false), aiWriteTasks: vi.fn(async () => ({ written: 0 })) }))
vi.mock('../components/ConnectGitHubDialog', () => ({ runGitHubGated: vi.fn(async (action: () => unknown) => action()) }))

const sync = vi.mocked(aiSyncApp)
const wantsTasks = vi.mocked(appWantsTasks)
const writeTasks = vi.mocked(aiWriteTasks)
const NOW = '2026-10-06T10:00:00.000Z'
const signals = (patch: Partial<RepoSignals> = {}): RepoSignals => ({ hasReadme: true, secretFiles: [], lastCommitAt: new Date().toISOString(), openIssues: 0, openPrs: 0, syncedAt: NOW, ...patch })
const repo = (name: string, isPrivate = true) => ({ fullName: `acme/${name}`, url: `https://github.com/acme/${name}`, private: isPrivate, defaultBranch: 'main' })
const card = (patch: Partial<AppCard> = {}): AppCard => ({ what: 'w', who: 'u', stage: 'live', status: 's', updatedAt: NOW, source: 'ai', checkedAt: NOW, ...patch })
const draftedBy = { client: 'Claude', clientId: 'c', memberId: null, at: NOW }
const task = (patch: Partial<AppTask> = {}): AppTask => ({ id: 't', problem: 'public-repo', title: 'Make it private', detail: null, createdAt: NOW, draftedBy, fixedAt: null, ...patch })

function outcome(id: string, patch: { private?: boolean; source?: SyncOutcome['source']; error?: string } = {}): SyncOutcome {
  const name = useStore.getState().projects.find((p) => p.id === id)!.repo!.fullName
  const ai = patch.source === 'ai'
  return {
    card: ai ? { what: 'AI what', who: 'AI who', stage: 'live', status: 'AI status' } : { what: 'Facts what', who: 'Facts who', stage: 'building', status: 'Facts status' },
    signals: signals(), source: patch.source ?? 'fallback', note: null, ...(patch.error ? { error: patch.error } : {}),
    facts: { meta: { fullName: name, private: patch.private ?? true } },
  } as unknown as SyncOutcome
}

const add = (name: string, patch: Partial<Project> = {}) => useStore.getState().createProject({ name, repo: repo(name), signals: signals(), appCard: card(), ...patch })
const notices = () => vi.spyOn(useUI.getState(), 'notify')
const project = (id: string) => useStore.getState().projects.find((p) => p.id === id)!

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_AI_MODE', 'mcp') // a local .env.local must not decide these tests
  vi.mocked(runGitHubGated).mockImplementation(async (action) => action())
  useStore.getState().resetAll()
  useStore.setState({ hydrated: true })
  useStore.getState().setAI({ provider: 'none' }) // no key unless a test saves one (the dev default is the local bridge)
  useUI.setState({ claudeWindow: null, toast: null })
  useSyncAll.setState({ running: false, done: 0, total: 0, failed: [], ai: false, apps: [], view: null, summary: null })
  sync.mockImplementation(async (id) => outcome(id))
  wantsTasks.mockReturnValue(false)
  writeTasks.mockResolvedValue({ written: 0 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('which apps Sync all takes', () => {
  it('skips archived, repo-less and sample apps', () => {
    const real = add('web')
    const apps = [
      real,
      add('old', { archived: true }),
      add('bare', { repo: null }),
      add('sample', { repo: { ...repo('x'), fullName: 'acme-sample/x' } }),
    ]
    expect(syncableApps(apps, null, null).map((p) => p.id)).toEqual([real.id])
  })

  it('takes only the apps the person can edit in a team workspace', () => {
    const me = makeMember('Me')
    const other = makeMember('Other')
    const workspace = { id: 'w', name: 'Acme', kind: 'org' as const }
    const mine = add('mine', { ownerId: me.id })
    const theirs = add('theirs', { ownerId: other.id })
    expect(syncableApps([mine, theirs], me, workspace).map((p) => p.id)).toEqual([mine.id])
    expect(syncableApps([mine, theirs], { ...me, role: 'owner' }, workspace)).toHaveLength(2)
    expect(syncableApps([mine, theirs], null, null)).toHaveLength(2)
  })
})

describe('Sync all', () => {
  it('says so when there is nothing to sync', async () => {
    add('old', { archived: true })
    const notify = notices()
    await syncAll()
    expect(sync).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('No apps to sync')
    expect(useSyncAll.getState().running).toBe(false)
  })

  it('syncs two at a time, counts as it goes and ignores clicks while running', async () => {
    const apps = ['a', 'b', 'c', 'd', 'e'].map((name) => add(name))
    let active = 0
    let most = 0
    const release: Array<() => void> = []
    sync.mockImplementation((id) => new Promise((resolve) => {
      active++
      most = Math.max(most, active)
      release.push(() => { active--; resolve(outcome(id)) })
    }))
    const notify = notices()
    const run = syncAll()
    expect(useSyncAll.getState()).toMatchObject({ running: true, done: 0, total: 5 })
    await vi.waitFor(() => expect(release).toHaveLength(SYNC_CONCURRENCY))
    void syncAll() // a second click does nothing
    expect(sync).toHaveBeenCalledTimes(SYNC_CONCURRENCY)
    // Facts only: Sync all never spends an AI call on a card it won't apply.
    expect(sync).toHaveBeenCalledWith(expect.any(String), { factsOnly: true })

    release.shift()!()
    await vi.waitFor(() => expect(useSyncAll.getState().done).toBe(1))
    await vi.waitFor(() => expect(release).toHaveLength(SYNC_CONCURRENCY))
    while (useSyncAll.getState().running) {
      release.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await run
    expect(most).toBe(SYNC_CONCURRENCY)
    expect(sync).toHaveBeenCalledTimes(apps.length)
    expect(useSyncAll.getState()).toMatchObject({ running: false, done: 5, total: 5, failed: [] })
    expect(notify).toHaveBeenCalledWith('Synced 5 apps', 'success')
  })

  it('reports one app in the singular', async () => {
    add('solo')
    const notify = notices()
    await syncAll()
    expect(notify).toHaveBeenCalledWith('Synced 1 app', 'success')
  })

  it('counts the apps that could not sync and carries on with the rest', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map((name) => add(name))
    sync.mockImplementation(async (id) => {
      if (id === b.id) throw new Error('GitHub said no')
      return outcome(id)
    })
    const notify = notices()
    await syncAll()
    expect(sync).toHaveBeenCalledTimes(3)
    expect(useSyncAll.getState()).toMatchObject({ running: false, done: 3, total: 3, failed: [b.id] })
    expect(notify).toHaveBeenCalledWith("Synced 2 of 3 apps. 1 couldn't sync.", 'danger')
    expect([a, c].every((p) => project(p.id))).toBe(true)
  })

  it('stops and asks again when the GitHub sign-in has expired, without counting the app as failed', async () => {
    add('a')
    add('b')
    sync.mockRejectedValue(new GitHubError('expired', 'auth'))
    vi.mocked(runGitHubGated).mockImplementation(async (action) => {
      await expect(Promise.resolve().then(action)).rejects.toMatchObject({ kind: 'auth' })
      return undefined
    })
    const notify = notices()
    await syncAll()
    expect(sync.mock.calls.length).toBeLessThanOrEqual(SYNC_CONCURRENCY)
    expect(notify).not.toHaveBeenCalled()
    expect(useSyncAll.getState().running).toBe(false)
  })

  it('stops quietly when GitHub is not connected', async () => {
    add('a')
    vi.mocked(runGitHubGated).mockResolvedValue(undefined)
    const notify = notices()
    await syncAll()
    expect(sync).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(useSyncAll.getState().running).toBe(false)
    expect(useUI.getState().claudeWindow).toBeNull()
  })
})

describe('what Sync all applies', () => {
  it('never replaces an existing card, including a draft waiting in Review', async () => {
    const checked = add('checked', { appCard: card() })
    const draft = add('draft', { appCard: card({ checkedAt: null, draftedBy }) })
    await syncAll()
    expect(project(checked.id).appCard).toEqual(checked.appCard)
    expect(project(draft.id).appCard).toEqual(draft.appCard)
  })

  it('saves the facts-only card when an app has none, as the repo scan does for new apps', async () => {
    const bare = add('bare', { appCard: null })
    await syncAll()
    expect(project(bare.id).appCard).toMatchObject({ what: 'Facts what', source: 'fallback' })
    expect(useStore.getState().activity.some((item) => item.projectId === bare.id && item.kind === 'sync')).toBe(true)
  })

  it('saves a visibility change on the repo and leaves the rest of it alone', async () => {
    const a = add('a')
    sync.mockImplementation(async (id) => outcome(id, { private: false }))
    await syncAll()
    expect(project(a.id).repo).toEqual({ ...repo('a'), private: false })
  })

  it('does not bring back an app that was deleted while syncing', async () => {
    const a = add('a', { appCard: null })
    sync.mockImplementation(async (id) => {
      useStore.getState().deleteProject(id)
      return outcome(a.id)
    })
    await syncAll()
    expect(useStore.getState().projects).toHaveLength(0)
  })
})

describe('when Claude has work', () => {
  const personal = { personal: true }

  it('is true when an app needs a card, and false when every card is current and nothing is flagged', () => {
    expect(claudeHasWork([add('needs', { appCard: null })], [], personal)).toBe(true)
    expect(claudeHasWork([add('fine')], [], personal)).toBe(false)
  })

  it('is true when a health flag has no open task, and false once a task covers it', () => {
    const flagged = add('flagged', { repo: repo('flagged', false) }) // public repo
    expect(claudeHasWork([flagged], [], personal)).toBe(true)
    expect(claudeHasWork([{ ...flagged, tasks: [task()] }], [], personal)).toBe(false)
  })

  it('needs a new task when the only one for a flag is already fixed, or is for another flag', () => {
    const flagged = add('flagged', { repo: repo('flagged', false) })
    expect(claudeHasWork([{ ...flagged, tasks: [task({ fixedAt: NOW })] }], [], personal)).toBe(true)
    expect(claudeHasWork([{ ...flagged, tasks: [task({ problem: 'stale' })] }], [], personal)).toBe(true)
  })

  it('ignores archived and sample apps', () => {
    const publicRepo = repo('x', false)
    expect(claudeHasWork([add('old', { archived: true, repo: publicRepo }), add('sample', { repo: { ...publicRepo, fullName: 'acme-sample/x' } })], [], personal)).toBe(false)
  })

  it.each(['mcp', 'both'])('opens the Claude window after Sync all in %s mode, where Claude is on and no key writes the cards', async (mode) => {
    vi.stubEnv('VITE_AI_MODE', mode)
    add('bare', { appCard: null })
    await syncAll()
    expect(useUI.getState().claudeWindow).toBe('sync')
  })

  it('leaves the Claude window shut in legacy mode, where Claude is not offered', async () => {
    vi.stubEnv('VITE_AI_MODE', 'legacy')
    add('bare', { appCard: null })
    await syncAll()
    expect(useUI.getState().claudeWindow).toBeNull()
  })

  it("doesn't ask Claude about a teammate's app the person can't edit", async () => {
    const me = makeMember('Me')
    const other = makeMember('Other')
    useStore.setState({ workspace: { id: 'w', name: 'Acme', kind: 'org' }, members: [me, other], meId: me.id })
    add('mine', { ownerId: me.id })
    add('theirs', { ownerId: other.id, appCard: null })
    await syncAll()
    expect(useUI.getState().claudeWindow).toBeNull()
  })

  it('leaves the Claude window shut when there is nothing for Claude to do', async () => {
    useStore.setState({ workspace: { id: 'w', name: 'Me', kind: 'personal' } })
    add('fine', { repo: repo('fine', true) })
    await syncAll()
    expect(useUI.getState().claudeWindow).toBeNull()
  })
})

describe('Sync all with an API key', () => {
  const draftedBy2 = draftedBy
  // With a key the progress window hears about each step, so every call carries onStep.
  const AI = { onStep: expect.any(Function) }
  const FACTS = { factsOnly: true, onStep: expect.any(Function) }
  const aiAnswer = (id: string, options?: { factsOnly?: boolean }) => (options?.factsOnly ? outcome(id) : outcome(id, { source: 'ai' }))
  const outOfDate = () => card({
    updatedAt: '2026-10-01T00:00:00.000Z',
    evidence: { readme: null, deployFile: null, lastCommit: null, repoFacts: { hasReadme: false, secretFiles: [], private: true, lastCommitAt: null } },
  })

  beforeEach(() => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    useStore.getState().setAI({ provider: 'anthropic', apiKey: 'sk-test' })
    sync.mockImplementation(async (id, options) => aiAnswer(id, options))
  })

  it('writes the descriptions that are missing or out of date, as drafts, and leaves a draft waiting in Review alone', async () => {
    const none = add('none', { appCard: null })
    const factsOnly = add('facts', { appCard: card({ source: 'fallback', checkedAt: null }) })
    const checked = add('checked', { appCard: card() })
    const draft = add('draft', { appCard: card({ checkedAt: null, draftedBy: draftedBy2 }) })
    const stale = add('stale', { appCard: outOfDate() })
    expect(needsCard(project(stale.id))).toBe(true)
    const notify = notices()
    await syncAll()

    // An out-of-date card a person checked is drafted again, as a new draft for Review.
    for (const written of [none, factsOnly, stale]) {
      expect(project(written.id).appCard).toMatchObject({ what: 'AI what', source: 'ai', checkedAt: null })
      expect(sync).toHaveBeenCalledWith(written.id, AI)
    }
    for (const kept of [checked, draft]) {
      expect(project(kept.id).appCard).toEqual(kept.appCard)
      expect(sync).toHaveBeenCalledWith(kept.id, FACTS) // no tokens spent on them
    }
    expect(sync).toHaveBeenCalledTimes(5)
    expect(notify).toHaveBeenCalledWith('Synced 5 apps. Wrote 3 descriptions. Check them in Review.', 'success')
    expect(useSyncAll.getState()).toMatchObject({ running: false, done: 5, total: 5, failed: [] })
  })

  it('writes a description for a card the sync itself just showed to be out of date', async () => {
    const lastCommitAt = '2026-10-05T09:00:00.000Z'
    const app = add('moved', {
      signals: signals({ lastCommitAt }),
      appCard: card({ evidence: { readme: null, deployFile: null, lastCommit: null, repoFacts: { hasReadme: true, secretFiles: [], private: true, lastCommitAt } } }),
    })
    expect(wantsCard(project(app.id))).toBe(false)
    // The facts read saves a newer commit, as aiSyncApp does: the card no longer matches the repo.
    sync.mockImplementation(async (id, options) => {
      if (options?.factsOnly) useStore.getState().updateProject(id, { signals: signals({ lastCommitAt: '2026-10-06T09:30:00.000Z', syncedAt: '2026-10-06T11:00:00.000Z' }) })
      return aiAnswer(id, options)
    })
    await syncAll()
    expect(sync.mock.calls.map(([, options]) => Boolean(options?.factsOnly))).toEqual([true, false])
    expect(project(app.id).appCard).toMatchObject({ what: 'AI what', source: 'ai', checkedAt: null })
  })

  it('says one description in the singular', async () => {
    add('solo', { appCard: null })
    const notify = notices()
    await syncAll()
    expect(notify).toHaveBeenCalledWith('Synced 1 app. Wrote 1 description. Check them in Review.', 'success')
  })

  it('never opens the Claude window, even when Claude has tasks left to add', async () => {
    add('stale', { appCard: outOfDate() })
    add('public', { repo: repo('public', false) }) // a flag with no task yet
    await syncAll()
    expect(useUI.getState().claudeWindow).toBeNull()
  })

  it('spends no AI call and writes nothing when every card is already fine', async () => {
    add('fine')
    const notify = notices()
    await syncAll()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith(expect.any(String), FACTS)
    expect(notify).toHaveBeenCalledWith('Synced 1 app', 'success')
  })

  it("doesn't write for a teammate's app the person can't edit", async () => {
    const me = makeMember('Me')
    const other = makeMember('Other')
    useStore.setState({ workspace: { id: 'w', name: 'Acme', kind: 'org' }, members: [me, other], meId: me.id })
    const mine = add('mine', { ownerId: me.id, appCard: null })
    const theirs = add('theirs', { ownerId: other.id, appCard: null })
    await syncAll()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith(mine.id, AI)
    expect(project(theirs.id).appCard).toBeNull()
  })

  it('keeps the facts-only card and stops asking the AI after it fails once', async () => {
    const apps = ['a', 'b', 'c'].map((name) => add(name, { appCard: null }))
    sync.mockImplementation(async (id, options) => (options?.factsOnly ? outcome(id) : outcome(id, { error: 'bad key' })))
    const notify = notices()
    await syncAll()
    // The first two ran at once and both failed; the third never reached the AI.
    expect(sync.mock.calls.filter(([, options]) => !options?.factsOnly)).toHaveLength(SYNC_CONCURRENCY)
    expect(sync).toHaveBeenLastCalledWith(apps[2].id, FACTS)
    for (const item of apps) expect(project(item.id).appCard).toMatchObject({ source: 'fallback', what: 'Facts what' })
    expect(notify).toHaveBeenCalledWith("Synced 3 apps. Your AI couldn't write 3 descriptions. Try Sync now on those apps.", 'neutral')
    expect(useSyncAll.getState().failed).toEqual([])
  })

  it('keeps going and counts both when a GitHub failure and a description share a run', async () => {
    const [bad, good] = ['bad', 'good'].map((name) => add(name, { appCard: null }))
    sync.mockImplementation(async (id, options) => {
      if (id === bad.id) throw new Error('GitHub said no')
      return aiAnswer(id, options)
    })
    const notify = notices()
    await syncAll()
    expect(project(good.id).appCard).toMatchObject({ source: 'ai', checkedAt: null })
    expect(useSyncAll.getState().failed).toEqual([bad.id])
    expect(notify).toHaveBeenCalledWith("Synced 1 of 2 apps. 1 couldn't sync. Wrote 1 description. Check them in Review.", 'danger')
  })

  it('does not replace a card that a person or Claude saved while the AI was working', async () => {
    const app = add('busy', { appCard: null })
    sync.mockImplementation(async (id, options) => {
      if (!options?.factsOnly) useStore.getState().updateProject(id, { appCard: card({ what: 'Claude wrote this', checkedAt: null, draftedBy }) })
      return aiAnswer(id, options)
    })
    const notify = notices()
    await syncAll()
    expect(project(app.id).appCard).toMatchObject({ what: 'Claude wrote this', checkedAt: null })
    expect(notify).toHaveBeenCalledWith('Synced 1 app', 'success')
  })

  it('uses the key in legacy mode too', async () => {
    vi.stubEnv('VITE_AI_MODE', 'legacy')
    const app = add('legacy', { appCard: null })
    await syncAll()
    expect(project(app.id).appCard).toMatchObject({ source: 'ai', checkedAt: null })
    expect(useUI.getState().claudeWindow).toBeNull()
  })

  it('ignores a leftover key in mcp mode, where the browser calls no AI: facts only, then the Claude window', async () => {
    vi.stubEnv('VITE_AI_MODE', 'mcp')
    add('bare', { appCard: null })
    await syncAll()
    expect(sync).toHaveBeenCalledWith(expect.any(String), { factsOnly: true })
    expect(useUI.getState().claudeWindow).toBe('sync')
  })

  it('does not treat sample mode as a key', async () => {
    useStore.getState().setAI({ provider: 'demo' })
    add('bare', { appCard: null })
    await syncAll()
    expect(sync).toHaveBeenCalledWith(expect.any(String), { factsOnly: true })
  })
})

describe('which cards a key writes', () => {
  const app = (patch: Partial<Project>) => ({ ...add('x'), ...patch }) as Project

  it('takes an app with no card or only the facts-only one', () => {
    expect(wantsCard(app({ appCard: null }))).toBe(true)
    expect(wantsCard(app({ appCard: card({ source: 'fallback', checkedAt: null }) }))).toBe(true)
  })

  it('takes a checked AI card the repo has moved past, but never a current one', () => {
    const stale = card({ updatedAt: '2026-10-01T00:00:00.000Z', evidence: { readme: null, deployFile: null, lastCommit: null, repoFacts: { hasReadme: false, secretFiles: [], private: true, lastCommitAt: null } } })
    expect(wantsCard(app({ appCard: stale }))).toBe(true)
    expect(wantsCard(app({ appCard: card() }))).toBe(false)
  })

  it('never takes a draft in Review (even an out-of-date one), an archived app or a sample', () => {
    const stale = card({ checkedAt: null, updatedAt: '2026-10-01T00:00:00.000Z', evidence: { readme: null, deployFile: null, lastCommit: null, repoFacts: { hasReadme: false, secretFiles: [], private: true, lastCommitAt: null } } })
    expect(needsCard(app({ appCard: stale }))).toBe(true)
    expect(wantsCard(app({ appCard: stale }))).toBe(false)
    expect(wantsCard(app({ appCard: card({ checkedAt: null }) }))).toBe(false)
    expect(wantsCard(app({ appCard: null, archived: true }))).toBe(false)
    expect(wantsCard(app({ appCard: null, repo: { ...repo('s'), fullName: 'acme-sample/s' } }))).toBe(false)
    expect(wantsCard(app({ appCard: null, repo: null }))).toBe(false)
  })
})

describe('Sync all with an API key: tasks', () => {
  const stepsOf = () => useSyncAll.getState().apps.map((app) => app.step)

  beforeEach(() => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    useStore.getState().setAI({ provider: 'anthropic', apiKey: 'sk-test' })
    sync.mockImplementation(async (id, options) => (options?.factsOnly ? outcome(id) : outcome(id, { source: 'ai' })))
  })

  it('writes the description first, then the tasks, and says so', async () => {
    const app = add('web', { appCard: null })
    wantsTasks.mockReturnValue(true)
    const order: string[] = []
    sync.mockImplementation(async (id) => { order.push('card'); return outcome(id, { source: 'ai' }) })
    writeTasks.mockImplementation(async () => { order.push('tasks'); return { written: 3 } })
    const notify = notices()
    await syncAll()
    expect(order).toEqual(['card', 'tasks'])
    expect(writeTasks).toHaveBeenCalledWith(app.id)
    expect(wantsTasks).toHaveBeenCalledWith(expect.objectContaining({ id: app.id, appCard: expect.objectContaining({ source: 'ai' }) }), expect.any(Array)) // asked after the card was saved
    expect(notify).toHaveBeenCalledWith('Synced 1 app. Wrote 1 description. Check them in Review. Added tasks to 1 app.', 'success')
    expect(useSyncAll.getState().apps).toEqual([{ id: app.id, name: 'web', step: 'done', wrote: true, tasks: 3 }])
    expect(useSyncAll.getState().summary).toMatchObject({ total: 1, failed: 0, wrote: 1, taskApps: 1, tasks: 3 })
  })

  it('writes tasks for an app whose description is fine, and for a draft waiting in Review, without touching either card', async () => {
    const checked = add('checked')
    const draft = add('draft', { appCard: card({ checkedAt: null, draftedBy }) })
    wantsTasks.mockReturnValue(true)
    writeTasks.mockResolvedValue({ written: 1 })
    await syncAll()
    expect(sync).toHaveBeenCalledTimes(2)
    expect(sync.mock.calls.every(([, options]) => options?.factsOnly)).toBe(true) // no description written for either
    expect(writeTasks.mock.calls.map(([id]) => id).sort()).toEqual([checked.id, draft.id].sort())
    expect(project(draft.id).appCard).toEqual(draft.appCard)
  })

  it('adds tasks only to the apps that want them, and counts an app that needed none as done', async () => {
    const [a, b] = ['a', 'b'].map((name) => add(name))
    wantsTasks.mockImplementation((p) => p.id === a.id)
    writeTasks.mockResolvedValue({ written: 0 }) // the AI found nothing to add
    await syncAll()
    expect(writeTasks).toHaveBeenCalledTimes(1)
    expect(writeTasks).toHaveBeenCalledWith(a.id)
    expect(useSyncAll.getState().summary).toMatchObject({ taskApps: 0, tasks: 0, couldntTasks: 0 })
    expect(useSyncAll.getState().apps.find((app) => app.id === b.id)).toMatchObject({ step: 'done', tasks: 0 })
  })

  it('stops using the AI after one failure writing tasks: the rest of the run is facts only', async () => {
    const apps = ['a', 'b', 'c', 'd'].map((name) => add(name, { appCard: name === 'd' ? null : card() }))
    wantsTasks.mockReturnValue(true)
    writeTasks.mockRejectedValue(new Error('bad key'))
    const notify = notices()
    await syncAll()
    // The first two ran at once; the others never reached the AI, not even for a missing description.
    expect(writeTasks.mock.calls.length).toBeLessThanOrEqual(SYNC_CONCURRENCY)
    expect(writeTasks).not.toHaveBeenCalledWith(apps[2].id)
    expect(sync).toHaveBeenCalledWith(apps[3].id, { factsOnly: true, onStep: expect.any(Function) })
    expect(project(apps[3].id).appCard).toMatchObject({ source: 'fallback' })
    const { summary } = useSyncAll.getState()
    expect(summary!.couldntTasks).toBeGreaterThan(0)
    expect(summary!.couldnt).toBe(1)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Your AI couldn't add tasks to"), 'neutral')
    expect(useSyncAll.getState().failed).toEqual([]) // the apps themselves synced
  })

  it('stops tasks too once a description failed', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map((name) => add(name, { appCard: name === 'c' ? card() : null }))
    sync.mockImplementation(async (id, options) => (options?.factsOnly ? outcome(id) : outcome(id, { error: 'bad key' })))
    wantsTasks.mockReturnValue(true)
    await syncAll()
    expect(writeTasks).not.toHaveBeenCalledWith(a.id)
    expect(writeTasks).not.toHaveBeenCalledWith(b.id)
    expect(writeTasks).not.toHaveBeenCalledWith(c.id) // c ran after the failure
  })

  it('does not add tasks or call the AI without a key: facts only, no window', async () => {
    useStore.getState().setAI({ provider: 'none' })
    add('web', { appCard: null })
    wantsTasks.mockReturnValue(true)
    await syncAll()
    expect(sync).toHaveBeenCalledWith(expect.any(String), { factsOnly: true })
    expect(wantsTasks).not.toHaveBeenCalled()
    expect(writeTasks).not.toHaveBeenCalled()
    expect(useSyncAll.getState()).toMatchObject({ ai: false, apps: [], view: null, summary: null })
  })

  it("doesn't add tasks to an app that was deleted while syncing", async () => {
    const app = add('gone')
    wantsTasks.mockReturnValue(true)
    sync.mockImplementation(async (id, options) => { useStore.setState((state) => ({ projects: state.projects.filter((p) => p.id !== id) })); return outcome(app.id, options?.factsOnly ? {} : { source: 'ai' }) })
    await syncAll()
    expect(writeTasks).not.toHaveBeenCalled()
  })

  it("shows each app's steps in order: waiting, reading, writing, adding tasks, done", async () => {
    const [first, second, third] = ['a', 'b', 'c'].map((name) => add(name, { appCard: name === 'a' ? null : card() }))
    wantsTasks.mockImplementation((p) => p.id === first.id)
    const seen: string[][] = []
    const row = (id: string) => useSyncAll.getState().apps.find((app) => app.id === id)!.step
    sync.mockImplementation(async (id, options) => {
      if (id === first.id) {
        seen.push([row(id)])
        options?.onStep?.('reading')
        seen.push([row(id), row(third.id)]) // the third app is still waiting its turn
        options?.onStep?.('writing')
        seen.push([row(id)])
        return outcome(id, { source: 'ai' })
      }
      return outcome(id)
    })
    writeTasks.mockImplementation(async (id) => { seen.push([row(id)]); return { written: 2 } })
    expect(useSyncAll.getState().apps).toEqual([])
    await syncAll()
    expect(seen).toEqual([['reading'], ['reading', 'waiting'], ['writing'], ['tasks']])
    expect(useSyncAll.getState().apps.map((app) => [app.id, app.step, app.wrote, app.tasks])).toEqual([
      [first.id, 'done', true, 2], [second.id, 'done', false, 0], [third.id, 'done', false, 0],
    ])
  })

  it('marks an app that could not sync as failed and keeps the others going', async () => {
    const bad = add('bad')
    add('good')
    sync.mockImplementation(async (id, options) => { if (id === bad.id) throw new Error('GitHub said no'); return outcome(id, options?.factsOnly ? {} : { source: 'ai' }) })
    await syncAll()
    expect(stepsOf()).toEqual(['failed', 'done'])
    expect(useSyncAll.getState().summary).toMatchObject({ total: 2, failed: 1 })
  })
})

describe('the progress window', () => {
  const keyed = () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    useStore.getState().setAI({ provider: 'anthropic', apiKey: 'sk-test' })
    sync.mockImplementation(async (id, options) => (options?.factsOnly ? outcome(id) : outcome(id, { source: 'ai' })))
  }
  /** A run that waits for the test to let each app finish. */
  const hold = () => {
    const release: Array<() => void> = []
    sync.mockImplementation((id, options) => new Promise((resolve) => release.push(() => resolve(options?.factsOnly ? outcome(id) : outcome(id, { source: 'ai' })))))
    return release
  }
  const finish = async (release: Array<() => void>, run: Promise<void>) => {
    while (useSyncAll.getState().running) {
      release.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await run
  }

  it('opens when the run starts and shrinks to the pill when it is closed, then opens again', async () => {
    keyed()
    ;['a', 'b', 'c'].forEach((name) => add(name, { appCard: null }))
    const release = hold()
    const run = syncAll()
    await vi.waitFor(() => expect(release).toHaveLength(SYNC_CONCURRENCY))
    expect(useSyncAll.getState()).toMatchObject({ running: true, ai: true, view: 'open', summary: null, total: 3 })
    closeSyncWindow()
    expect(useSyncAll.getState().view).toBe('mini')
    openSyncWindow()
    expect(useSyncAll.getState().view).toBe('open')
    closeSyncWindow()
    await finish(release, run)
    // Done while minimised: the pill stays, now saying so, until the summary is opened and closed.
    expect(useSyncAll.getState()).toMatchObject({ running: false, view: 'mini', summary: { total: 3, wrote: 3 } })
    openSyncWindow()
    expect(useSyncAll.getState().view).toBe('open')
    closeSyncWindow()
    expect(useSyncAll.getState()).toMatchObject({ view: null, summary: null })
  })

  it('shows the summary in the open window when the run ends, until it is closed', async () => {
    keyed()
    add('a', { appCard: null })
    await syncAll()
    expect(useSyncAll.getState()).toMatchObject({ running: false, view: 'open', summary: { total: 1, wrote: 1 } })
    closeSyncWindow()
    expect(useSyncAll.getState()).toMatchObject({ view: null, summary: null })
  })

  it('does nothing when asked to open with no run to show', () => {
    openSyncWindow()
    expect(useSyncAll.getState().view).toBeNull()
  })

  it('never opens without a key', async () => {
    add('a', { appCard: null })
    const release = hold()
    const run = syncAll()
    await vi.waitFor(() => expect(release).toHaveLength(1))
    expect(useSyncAll.getState()).toMatchObject({ running: true, ai: false, view: null, apps: [] })
    await finish(release, run)
    expect(useSyncAll.getState()).toMatchObject({ view: null, summary: null })
  })

  it('closes, with nothing to show, when GitHub is not connected', async () => {
    keyed()
    add('a')
    vi.mocked(runGitHubGated).mockResolvedValueOnce(undefined)
    await syncAll()
    expect(useSyncAll.getState()).toMatchObject({ running: false, view: null, summary: null })
  })

  it('starts a fresh window for a new run', async () => {
    keyed()
    add('a', { appCard: null })
    await syncAll()
    expect(useSyncAll.getState().summary).not.toBeNull()
    useStore.getState().updateProject(useStore.getState().projects[0].id, { appCard: null })
    const release = hold()
    const run = syncAll()
    await vi.waitFor(() => expect(release).toHaveLength(1))
    expect(useSyncAll.getState()).toMatchObject({ view: 'open', summary: null })
    await finish(release, run)
  })
})

describe('the summary line', () => {
  const base = { total: 50, failed: 0, wrote: 0, couldnt: 0, taskApps: 0, tasks: 0, couldntTasks: 0 }

  it('says what was synced, written and added', () => {
    expect(summaryText({ ...base, wrote: 12, taskApps: 9, tasks: 20 })).toBe('Done. Synced 50 apps. Wrote 12 descriptions. Added tasks to 9 apps.')
    expect(summaryText({ ...base, total: 1, wrote: 1, taskApps: 1, tasks: 1 })).toBe('Done. Synced 1 app. Wrote 1 description. Added tasks to 1 app.')
    expect(summaryText(base)).toBe('Done. Synced 50 apps.')
  })

  it("says what didn't work", () => {
    expect(summaryText({ ...base, failed: 2, couldnt: 3, couldntTasks: 1 })).toBe(
      "Done. Synced 48 of 50 apps. 2 couldn't sync. Your AI couldn't write 3 descriptions. Your AI couldn't add tasks to 1 app.",
    )
  })
})
