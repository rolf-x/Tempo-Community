import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCard, Project } from '../types'
import { useStore } from '../store/useStore'
import { useRedraftState } from '../ai/redraftState'
import { useUI } from '../components/uiState'
import { useSession } from './session'
import { QUIET_MS, STALL_MS, startClaudeWriting, stopClaudeWriting, useClaudeWriting } from './claudeWriting'

const START = new Date('2026-10-06T10:00:00.000Z')
const WORKSPACE = { id: 'w1', name: 'Acme', kind: 'org' as const }
const MINUTE = 60_000

const aiCard = (at: string, patch: Partial<AppCard> = {}): AppCard => ({
  what: 'w', who: 'u', stage: 'live', status: 's', updatedAt: at, source: 'ai', checkedAt: null,
  draftedBy: { client: 'Claude', clientId: 'c', memberId: null, at }, ...patch,
})
const app = (id: string, appCard: AppCard | null = null): Project => ({
  id, name: id, emoji: '', color: 'slate', description: '', createdAt: '2026-09-01T00:00:00Z', archived: false, ownerId: null,
  repo: null, signals: null, appCard, lastActivityAt: null, autoApply: false,
})

const setApps = (...ids: string[]) => useStore.setState({ projects: ids.map((id) => app(id)) })
const writeCard = (id: string, card: AppCard) => useStore.setState((s) => ({ projects: s.projects.map((p) => p.id === id ? { ...p, appCard: card } : p) }))
/** Claude's draft for an app lands, stamped with the current (fake) time. */
const arrive = (id: string) => writeCard(id, aiCard(new Date().toISOString()))
const begin = (ids: string[], workspaceId: string | null = WORKSPACE.id) => startClaudeWriting({ workspaceId, projectIds: ids, prompt: 'Use Tempo to draft the cards.' })
const writing = () => [...useRedraftState.getState().writingIds].sort()
const toast = () => useUI.getState().toast

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  stopClaudeWriting()
  useRedraftState.getState().reset()
  useSession.setState({ status: 'signed-in' })
  useStore.setState({ hydrated: true, workspace: WORKSPACE, projects: [] })
  useUI.setState({ toast: null })
})
afterEach(() => {
  stopClaudeWriting()
  useSession.setState({ status: 'off' })
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('starting', () => {
  it('waits for the apps it was asked about and marks them as being written', () => {
    setApps('a', 'b', 'c')
    begin(['a', 'b'])
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'waiting', workspaceId: 'w1', expected: ['a', 'b'], arrived: [], startedAt: START.getTime(), prompt: 'Use Tempo to draft the cards.' })
    expect(writing()).toEqual(['a', 'b'])
  })

  it('does nothing without apps', () => {
    begin([])
    expect(useClaudeWriting.getState().phase).toBeNull()
    expect(writing()).toEqual([])
  })

  it('adds to a wait already running in the same workspace and keeps what arrived', () => {
    setApps('a', 'b', 'c')
    begin(['a', 'b'])
    vi.advanceTimersByTime(MINUTE)
    arrive('a')
    begin(['b', 'c'])
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'writing', expected: ['a', 'b', 'c'], arrived: ['a'], startedAt: START.getTime() })
    expect(writing()).toEqual(['b', 'c'])
  })

  it('gives each app its own baseline: an app added later takes the card it has then, the others keep theirs', () => {
    const old = aiCard('2026-10-06T09:00:00.000Z')
    useStore.setState({ projects: [app('a'), app('b', old), app('c', old)] })
    begin(['a', 'b'])
    vi.advanceTimersByTime(2 * MINUTE)
    writeCard('c', aiCard('2026-10-06T10:01:00.000Z')) // c changes before it is added: that is its starting point
    begin(['b', 'c'])
    expect(useClaudeWriting.getState().fingerprints).toEqual({ a: '', b: 'ai|2026-10-06T09:00:00.000Z', c: 'ai|2026-10-06T10:01:00.000Z' })
    expect(useClaudeWriting.getState().startedAt).toBe(START.getTime())
  })

  it('starts over from stalled, and replaces a wait from another workspace', () => {
    setApps('a', 'b')
    begin(['a'])
    vi.advanceTimersByTime(STALL_MS)
    expect(useClaudeWriting.getState().phase).toBe('stalled')
    begin(['a'])
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'waiting', startedAt: Date.now() })
    expect(writing()).toEqual(['a'])

    // The app is still loading another workspace, so the old wait hasn't been dropped yet.
    useSession.setState({ status: 'loading' })
    useStore.setState({ workspace: { id: 'w2', name: 'Other', kind: 'org' } })
    begin(['b'], 'w2')
    expect(useClaudeWriting.getState()).toMatchObject({ workspaceId: 'w2', expected: ['b'], phase: 'waiting' })
    expect(writing()).toEqual(['b'])
  })
})

describe('drafts arriving', () => {
  it('moves to writing on the first draft, and clears that app from the tiles', () => {
    setApps('a', 'b', 'c')
    begin(['a', 'b', 'c'])
    vi.advanceTimersByTime(2 * MINUTE)
    arrive('b')
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'writing', arrived: ['b'], lastArrivalAt: Date.now() })
    expect(writing()).toEqual(['a', 'c'])
  })

  it('does not count the draft an app already had, cards that are not from Claude, or apps it was not asked about', () => {
    const old = aiCard(new Date(START.getTime() - 5 * MINUTE).toISOString())
    useStore.setState({ projects: [app('a', old), app('b'), app('c')] })
    begin(['a', 'b'])
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'waiting', arrived: [] })
    writeCard('a', { ...old, what: 'The person edited the old draft' }) // still the same draft as far as the wait can tell
    writeCard('b', aiCard(new Date().toISOString(), { source: 'fallback', draftedBy: undefined }))
    arrive('c')
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'waiting', arrived: [] })
  })

  it('does not count an app added to a running wait for a draft written before it was added', () => {
    setApps('a', 'b')
    begin(['a'])
    vi.advanceTimersByTime(MINUTE)
    arrive('b') // Claude drafted b in answer to something else, before b was part of the wait
    vi.advanceTimersByTime(MINUTE)
    begin(['a', 'b'])
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'waiting', expected: ['a', 'b'], arrived: [] })
    expect(writing()).toEqual(['a', 'b'])
  })

  it('counts an added app once a draft is written after it was added', () => {
    setApps('a', 'b')
    begin(['a'])
    vi.advanceTimersByTime(MINUTE)
    arrive('b')
    vi.advanceTimersByTime(MINUTE)
    begin(['a', 'b'])
    vi.advanceTimersByTime(MINUTE)
    arrive('b')
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'writing', arrived: ['b'] })
    expect(writing()).toEqual(['a'])
  })

  it('counts a new draft whatever the server clock says: a day behind the browser, or a week ahead', () => {
    setApps('a', 'b', 'c')
    begin(['a', 'b', 'c'])
    writeCard('a', aiCard(new Date(START.getTime() - 24 * 60 * MINUTE).toISOString()))
    expect(useClaudeWriting.getState().arrived).toEqual(['a'])
    writeCard('b', aiCard(new Date(START.getTime() + 7 * 24 * 60 * MINUTE).toISOString()))
    expect(useClaudeWriting.getState().arrived).toEqual(['a', 'b'])
  })

  it('does not count a draft stamped in the future by a fast server clock when it was already there', () => {
    const early = aiCard(new Date(START.getTime() + 3 * 60 * MINUTE).toISOString()) // "3 hours from now" by the browser's clock
    useStore.setState({ projects: [app('a', early), app('b')] })
    begin(['a', 'b'])
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'waiting', arrived: [] })
    writeCard('a', aiCard(new Date(START.getTime() + 3 * 60 * MINUTE + 1000).toISOString())) // Claude rewrites it: a different stamp
    expect(useClaudeWriting.getState().arrived).toEqual(['a'])
  })

  it('counts a rewritten draft: the card was already from Claude, the stamp is new', () => {
    useStore.setState({ projects: [app('a', aiCard('2026-10-06T08:00:00.000Z')), app('b')] })
    begin(['a', 'b'])
    expect(useClaudeWriting.getState().arrived).toEqual([])
    writeCard('a', aiCard('2026-10-06T08:00:00.000Z', { what: 'Same stamp, different words' }))
    expect(useClaudeWriting.getState().arrived).toEqual([])
    writeCard('a', aiCard('2026-10-06T10:02:00.000Z'))
    expect(useClaudeWriting.getState().arrived).toEqual(['a'])
  })

  it('counts a draft over a card from another source, and goes by the card stamp only to tell cards apart', () => {
    useStore.setState({ projects: [app('a', aiCard('2026-10-06T10:00:00.000Z', { source: 'fallback', draftedBy: undefined }))] })
    begin(['a'])
    writeCard('a', aiCard('2026-10-06T10:00:00.000Z')) // same stamp, but now from Claude
    expect(toast()?.message).toBe('Claude wrote 1 description. Check them in Review.')
  })

  it('needs a draftedBy: a card the browser wrote itself is not Claude\'s answer', () => {
    setApps('a', 'b')
    begin(['a', 'b'])
    writeCard('a', aiCard(new Date().toISOString(), { draftedBy: undefined }))
    expect(useClaudeWriting.getState().arrived).toEqual([])
  })

  it('finishes when every app has arrived, tells the person and resets', () => {
    setApps('a', 'b')
    begin(['a', 'b'])
    arrive('a')
    expect(toast()).toBeNull()
    arrive('b')
    expect(toast()).toMatchObject({ message: 'Claude wrote 2 descriptions. Check them in Review.', tone: 'success' })
    expect(useClaudeWriting.getState()).toMatchObject({ phase: null, expected: [], arrived: [] })
    expect(writing()).toEqual([])
  })

  it('says description for a single app', () => {
    setApps('a')
    begin(['a'])
    arrive('a')
    expect(toast()?.message).toBe('Claude wrote 1 description. Check them in Review.')
  })

  it('stops expecting an app that was deleted meanwhile', () => {
    setApps('a', 'b')
    begin(['a', 'b'])
    arrive('a')
    useStore.setState((s) => ({ projects: s.projects.filter((p) => p.id !== 'b') }))
    expect(toast()?.message).toBe('Claude wrote 1 description. Check them in Review.')
    expect(useClaudeWriting.getState().phase).toBeNull()
  })

  it('just stops when every expected app was deleted', () => {
    setApps('a')
    begin(['a'])
    setApps()
    expect(useClaudeWriting.getState().phase).toBeNull()
    expect(toast()).toBeNull()
  })
})

describe('time passing', () => {
  it('stalls when nothing arrives within 10 minutes, and the tiles stop saying Writing', () => {
    setApps('a', 'b')
    begin(['a', 'b'])
    vi.advanceTimersByTime(STALL_MS - 1)
    expect(useClaudeWriting.getState().phase).toBe('waiting')
    vi.advanceTimersByTime(1)
    expect(useClaudeWriting.getState().phase).toBe('stalled')
    expect(writing()).toEqual([])
    expect(toast()).toBeNull()
  })

  it('recovers from stalled when a draft arrives late, and the rest show Writing again', () => {
    setApps('a', 'b')
    begin(['a', 'b'])
    vi.advanceTimersByTime(STALL_MS)
    arrive('a')
    expect(useClaudeWriting.getState()).toMatchObject({ phase: 'writing', arrived: ['a'] })
    expect(writing()).toEqual(['b'])
  })

  it('finishes with what it has when nothing new arrives for 5 minutes', () => {
    setApps('a', 'b', 'c', 'd', 'e')
    begin(['a', 'b', 'c', 'd', 'e'])
    arrive('a')
    vi.advanceTimersByTime(2 * MINUTE)
    arrive('b')
    arrive('c')
    vi.advanceTimersByTime(QUIET_MS - 1)
    expect(useClaudeWriting.getState().phase).toBe('writing')
    vi.advanceTimersByTime(1)
    expect(toast()).toMatchObject({ message: 'Claude wrote 3 of 5 descriptions. Check them in Review.', tone: 'success' })
    expect(useClaudeWriting.getState().phase).toBeNull()
    expect(writing()).toEqual([])
  })

  it('does not finish early while drafts keep coming', () => {
    setApps('a', 'b', 'c')
    begin(['a', 'b', 'c'])
    arrive('a')
    vi.advanceTimersByTime(QUIET_MS - MINUTE)
    arrive('b')
    vi.advanceTimersByTime(QUIET_MS - MINUTE)
    expect(useClaudeWriting.getState().phase).toBe('writing')
    expect(toast()).toBeNull()
  })

  it('does nothing in the background once it is over', () => {
    setApps('a')
    begin(['a'])
    stopClaudeWriting()
    vi.advanceTimersByTime(STALL_MS * 2)
    expect(toast()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('ending the wait', () => {
  it('stops on request and clears the tiles', () => {
    setApps('a', 'b')
    begin(['a', 'b'])
    arrive('a')
    stopClaudeWriting()
    expect(useClaudeWriting.getState()).toMatchObject({ phase: null, expected: [], arrived: [], prompt: '' })
    expect(writing()).toEqual([])
    expect(toast()).toBeNull()
  })

  it('resets when the workspace changes', () => {
    setApps('a')
    begin(['a'])
    useStore.setState({ workspace: { id: 'w2', name: 'Other', kind: 'org' } })
    expect(useClaudeWriting.getState().phase).toBeNull()
    expect(writing()).toEqual([])
  })

  it('resets when the person signs out', () => {
    setApps('a')
    begin(['a'])
    useSession.setState({ status: 'signed-out' })
    expect(useClaudeWriting.getState().phase).toBeNull()
    expect(writing()).toEqual([])
  })

  it('waits while the app is still loading instead of concluding anything', () => {
    setApps('a')
    begin(['a'])
    useSession.setState({ status: 'loading' })
    useStore.setState({ workspace: null })
    expect(useClaudeWriting.getState().phase).toBe('waiting')
    vi.advanceTimersByTime(STALL_MS)
    expect(useClaudeWriting.getState().phase).toBe('waiting')
    useStore.setState({ workspace: WORKSPACE })
    useSession.setState({ status: 'signed-in' })
    expect(useClaudeWriting.getState().phase).toBe('stalled')
  })
})

describe('per tab storage', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
  }

  it('saves the wait in sessionStorage', () => {
    const tab = memory()
    vi.stubGlobal('sessionStorage', tab)
    setApps('a', 'b')
    begin(['a', 'b'])
    arrive('a')
    expect(JSON.parse(tab.data.get('tempo.claudeWriting')!).state).toMatchObject({ phase: 'writing', expected: ['a', 'b'], fingerprints: { a: '', b: '' }, arrived: ['a'], workspaceId: 'w1' })
    stopClaudeWriting()
    expect(JSON.parse(tab.data.get('tempo.claudeWriting')!).state.phase).toBeNull()
  })

  it('works when sessionStorage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('denied') },
    })
    setApps('a')
    expect(() => begin(['a'])).not.toThrow()
    arrive('a')
    expect(toast()?.message).toBe('Claude wrote 1 description. Check them in Review.')
  })

  it('works when sessionStorage is missing', () => {
    vi.stubGlobal('sessionStorage', undefined)
    setApps('a')
    expect(() => begin(['a'])).not.toThrow()
    expect(useClaudeWriting.getState().phase).toBe('waiting')
  })

  it('picks the wait up again after a reload, once the apps are in', async () => {
    const saved = {
      version: 1,
      state: { workspaceId: 'w1', startedAt: START.getTime(), prompt: 'p', expected: ['a', 'b'], arrived: ['a'], lastArrivalAt: START.getTime() + MINUTE, phase: 'writing' },
    }
    vi.resetModules()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => k === 'tempo.claudeWriting' ? JSON.stringify(saved) : null, setItem: () => {}, removeItem: () => {} })
    const { useClaudeWriting: tab } = await import('./claudeWriting')
    const { useRedraftState: tiles } = await import('../ai/redraftState')
    const { useStore: apps } = await import('../store/useStore')
    const { useSession: session } = await import('./session')
    session.setState({ status: 'signed-in' })
    expect(tab.getState()).toMatchObject({ phase: 'writing', expected: ['a', 'b'], arrived: ['a'], prompt: 'p' })
    expect([...tiles.getState().writingIds]).toEqual(['b'])

    apps.setState({ hydrated: true, workspace: WORKSPACE, projects: [app('a', aiCard(START.toISOString())), app('b')] })
    expect(tab.getState().phase).toBe('writing')
    vi.advanceTimersByTime(QUIET_MS)
    expect(tab.getState().phase).toBe('writing')
    vi.advanceTimersByTime(MINUTE)
    expect(tab.getState().phase).toBeNull()
    expect([...tiles.getState().writingIds]).toEqual([])
  })

  it('keeps each app\'s saved card across a reload, and starts the rest from the card they have then', async () => {
    const saved = {
      version: 1,
      state: { workspaceId: 'w1', startedAt: START.getTime(), prompt: 'p', expected: ['a', 'b', 'c'], fingerprints: { b: 'ai|2026-10-06T09:00:00.000Z', c: 7, z: 'ai|x' }, arrived: [], lastArrivalAt: null, phase: 'waiting' },
    }
    vi.resetModules()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => k === 'tempo.claudeWriting' ? JSON.stringify(saved) : null, setItem: () => {}, removeItem: () => {} })
    const { useClaudeWriting: tab } = await import('./claudeWriting')
    expect(tab.getState().fingerprints).toEqual({ b: 'ai|2026-10-06T09:00:00.000Z' })

    const { useStore: apps } = await import('../store/useStore')
    const { useSession: session } = await import('./session')
    session.setState({ status: 'signed-in' })
    // a and c are not drafts yet; b's card has changed since the saved fingerprint, so it is Claude's answer.
    apps.setState({ hydrated: true, workspace: WORKSPACE, projects: [app('a'), app('b', aiCard('2026-10-06T10:03:00.000Z')), app('c', aiCard('2026-10-06T08:00:00.000Z'))] })
    expect(tab.getState()).toMatchObject({ phase: 'writing', arrived: ['b'], fingerprints: { a: '', b: 'ai|2026-10-06T09:00:00.000Z', c: 'ai|2026-10-06T08:00:00.000Z' } })
  })

  it('treats a wait saved without fingerprints as starting now: the cards it finds are not answers, later ones are', async () => {
    const saved = {
      version: 1,
      state: { workspaceId: 'w1', startedAt: START.getTime(), prompt: 'p', expected: ['a', 'b'], since: { a: START.getTime(), b: START.getTime() }, arrived: [], lastArrivalAt: null, phase: 'waiting' },
    }
    vi.resetModules()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => k === 'tempo.claudeWriting' ? JSON.stringify(saved) : null, setItem: () => {}, removeItem: () => {} })
    const { useClaudeWriting: tab } = await import('./claudeWriting')
    expect(tab.getState()).toMatchObject({ phase: 'waiting', expected: ['a', 'b'], fingerprints: {} })

    const { useStore: apps } = await import('../store/useStore')
    const { useSession: session } = await import('./session')
    session.setState({ status: 'signed-in' })
    apps.setState({ hydrated: true, workspace: WORKSPACE, projects: [app('a', aiCard('2026-10-06T09:00:00.000Z')), app('b')] })
    expect(tab.getState()).toMatchObject({ phase: 'waiting', arrived: [], fingerprints: { a: 'ai|2026-10-06T09:00:00.000Z', b: '' } })
    apps.setState((s) => ({ projects: s.projects.map((p) => p.id === 'b' ? { ...p, appCard: aiCard('2026-10-06T10:04:00.000Z') } : p) }))
    expect(tab.getState()).toMatchObject({ phase: 'writing', arrived: ['b'] })
  })

  it('ignores junk left in storage', async () => {
    vi.resetModules()
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ version: 1, state: { phase: 'writing', expected: 'nope' } }), setItem: () => {}, removeItem: () => {} })
    const { useClaudeWriting: tab } = await import('./claudeWriting')
    expect(tab.getState()).toMatchObject({ phase: null, expected: [] })
  })
})
