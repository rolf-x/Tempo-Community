import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../lib/model'
import { defaultSettings, useStore } from '../store/useStore'
import type { AppTask, Member, Project, Provider } from '../types'
import AppView, { needsRepoCommits, repoWorkDependencyKey, newest, NextSteps, shouldShowOwnerSuggestion } from './AppView'
import type { HealthFlag } from '../ai/tools/health'

const storeState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('../store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/useStore')>()
  storeState.current = { ...actual.useStore.getState() }
  const useStore = Object.assign(
    (selector: (state: never) => unknown) => selector(storeState.current as never),
    {
      getState: () => storeState.current,
      setState: (patch: Record<string, unknown>) => Object.assign(storeState.current, patch),
    },
  )
  return { ...actual, useStore }
})
vi.mock('../components/app/HandoverModal', () => ({ HandoverModal: () => null }))
vi.mock('../components/app/SyncPreview', () => ({ SyncPreview: () => null }))
vi.mock('../components/app/ConnectRepo', () => ({ ConnectRepo: () => null }))

const owner: Member = {
  id: 'owner', name: 'Maya', email: null, avatarUrl: null, githubLogin: 'maya', userId: 'user', role: 'owner', active: true, leavingOn: null,
}
const repo = { fullName: 'acme/tempo', url: 'https://github.com/acme/tempo', private: true, defaultBranch: 'main' }
const signals = { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-04T00:00:00.000Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00.000Z' }

function app(patch: Partial<Project> = {}): Project {
  return {
    id: 'app', name: 'Tempo', emoji: '🎯', color: 'violet', description: '', createdAt: '2026-10-01T00:00:00.000Z', archived: false,
    ...appDefaults(), ownerId: owner.id, repo, signals,
    ...patch,
  }
}

function render(project: Project, provider: Provider = 'none') {
  useStore.setState({
    hydrated: true,
    projects: [project],
    members: [owner],
    meId: owner.id,
    activity: [],
    workspace: null,
    settings: { ...defaultSettings(), ai: { provider, preset: null, baseUrl: null, apiKey: null, model: null } },
  })
  return renderToStaticMarkup(createElement(AppView, { projectId: project.id }))
}

// These cards are the legacy (own key) ones; a local .env.local with VITE_AI_MODE=both must not change what they say.
beforeEach(() => {
  vi.stubEnv('VITE_AI_MODE', 'legacy')
  useStore.setState({ projects: [], activity: [], hydrated: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('AppView rail', () => {
  it('orders Health, Owner, Repo, Sync and Where it lives', () => {
    const html = render(app({ repo: { ...repo, private: false } }))
    const labels = ['Health', 'Owner', 'Repo', 'Sync', 'Where it lives']
    const positions = labels.map((label) => html.indexOf(`aria-label="${label}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('never asks to connect coding agents (an optional extra, Settings only)', () => {
    const html = render(app({ repo: { ...repo, private: false } }))
    expect(html).not.toContain('Connect your agents')
    expect(html).not.toContain('Connect agents')
  })

  it('hides Health when the app has no flags', () => {
    const html = render(app())
    expect(html).not.toContain('aria-label="Health"')
    expect(html).not.toContain('No health flags')
  })
})

describe('repo commit evidence', () => {
  const flag = (kind: HealthFlag['kind']): HealthFlag => ({ kind, severity: 'high', label: kind })

  it('loads commits for ownership and secret fixes', () => {
    expect(needsRepoCommits([flag('secrets')])).toBe(true)
    expect(needsRepoCommits([flag('no-owner')])).toBe(true)
    expect(needsRepoCommits([flag('owner-leaving')])).toBe(true)
    expect(needsRepoCommits([flag('no-readme')])).toBe(false)
  })
})

describe('owner suggestion visibility', () => {
  const suggestion = { name: 'Nadia', login: 'nadia', email: null, memberId: 'nadia', commits: 7, totalCommits: 10, share: 70, since: '2026-07-01T00:00:00.000Z' }
  const nadia: Member = { ...owner, id: 'nadia', name: 'Nadia', githubLogin: 'nadia', role: 'member' }
  it('offers a joined majority committer even when the active owner is someone else', () => {
    expect(shouldShowOwnerSuggestion(owner, suggestion, [owner, nadia])).toBe(true)
    expect(shouldShowOwnerSuggestion(owner, { ...suggestion, share: 50 }, [owner, nadia])).toBe(false)
    expect(shouldShowOwnerSuggestion(owner, suggestion, [owner, { ...nadia, userId: null }])).toBe(false)
    expect(shouldShowOwnerSuggestion(owner, { ...suggestion, memberId: owner.id }, [owner, nadia])).toBe(false)
  })

  it('still suggests a different person when the owner needs replacing', () => {
    expect(shouldShowOwnerSuggestion({ ...owner, leavingOn: '2026-10-18' }, suggestion)).toBe(true)
    expect(shouldShowOwnerSuggestion({ ...owner, active: false }, suggestion)).toBe(true)
    expect(shouldShowOwnerSuggestion({ ...owner, userId: null }, suggestion)).toBe(true)
    expect(shouldShowOwnerSuggestion(null, suggestion)).toBe(true)
    expect(shouldShowOwnerSuggestion({ ...owner, active: false }, { ...suggestion, memberId: owner.id })).toBe(false)
  })
})

describe('AppView repo empty state', () => {
  it('shows one connect action and hides repo-dependent modules', () => {
    const html = render(app({ ownerId: null, repo: null, signals: null, appCard: null }))
    expect(html).toContain('Connect a repo and Tempo writes this card')
    expect(html.match(/>Connect repo<\/button>/g)).toHaveLength(1)
    expect(html).not.toContain('No app card yet')
    expect(html).not.toContain('Handover pack')
    expect(html).not.toContain('aria-label="Repo"')
    expect(html).not.toContain('aria-label="Sync"')
    expect(html).toContain('Link a repo to see next steps.')
  })
})

describe('Next steps', () => {
  it('keeps the newest eight items', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ number: index, title: String(index), url: String(index), createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z` }))
    expect(newest(items).map((item) => item.number)).toEqual([9, 8, 7, 6, 5, 4, 3, 2])
  })

  it('shows the recommendation, linked issues and pull requests read-only', () => {
    const html = renderToStaticMarkup(createElement(NextSteps, {
      repo,
      cardStatus: 'Review the open release pull request.',
      loading: false,
      work: {
        issues: [{ number: 12, title: 'Fix owner lookup', url: 'https://github.com/acme/tempo/issues/12', createdAt: '2026-10-03T00:00:00Z' }],
        pulls: [{ number: 9, title: 'Ship repo health', url: 'https://github.com/acme/tempo/pull/9', createdAt: '2026-10-02T00:00:00Z' }],
      },
    }))
    expect(html).toContain('Review the open release pull request.')
    expect(html).toContain('Fix owner lookup')
    expect(html).toContain('#12')
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('type="checkbox"')
  })

  it('uses the repo and work empty states', () => {
    const empty = { issues: [], pulls: [] }
    expect(renderToStaticMarkup(createElement(NextSteps, { repo: null, cardStatus: null, work: empty, loading: false }))).toContain('Link a repo to see next steps.')
    expect(renderToStaticMarkup(createElement(NextSteps, { repo, cardStatus: null, work: empty, loading: false }))).toContain('No open issues or pull requests.')
  })
})

describe('AppView app card', () => {
  it('keeps the source label without offering Pick your AI', () => {
    const html = render(app({ appCard: { what: 'Tracks delivery.', who: 'Product teams', stage: 'live', status: 'In use', updatedAt: '2026-10-04T00:00:00.000Z', source: 'fallback' } }))
    expect(html).toContain('Written from repo data')
    expect(html).not.toContain('Pick your AI')
    expect(html).not.toContain('🎯')
    expect(html).toContain('bg-p-violet-soft')
    expect(html).toContain('>T</span>')
  })

  it('offers to redraft a kept AI card when newer repo facts contradict it', () => {
    const stale = app({
      appCard: {
        what: 'Tracks delivery.', who: 'Product teams', stage: 'live', status: 'The .env file was removed.', updatedAt: '2026-10-01T00:00:00.000Z', source: 'ai',
        evidence: { readme: null, deployFile: null, lastCommit: { message: 'Remove .env', author: 'Maya', at: '2026-10-01T00:00:00.000Z', url: 'https://github.com/acme/tempo/commit/old' } },
      },
    })
    const html = render(stale, 'anthropic')
    expect(html).toContain('Out of date · Draft again')

    const noAI = render(stale)
    expect(noAI).toContain('>Out of date</a>')
    expect(noAI).toContain('title="Pick your AI to draft this card again"')
    expect(noAI).toContain('href="#/settings"')
    expect(noAI).not.toContain('Out of date · Draft again')
  })

  it('keeps a foreign app readable without showing write controls', () => {
    const viewer: Member = { ...owner, id: 'viewer', name: 'Viewer', role: 'member' }
    useStore.setState({
      hydrated: true,
      projects: [app({ appCard: { what: 'Tracks delivery.', who: 'Product teams', stage: 'live', status: 'In use', updatedAt: '2026-10-04T00:00:00.000Z', source: 'fallback' } })],
      members: [owner, viewer], meId: viewer.id, activity: [], workspace: { id: 'team', name: 'Team' },
      settings: { ...defaultSettings(), ai: { provider: 'anthropic', preset: null, baseUrl: null, apiKey: null, model: null } },
    })
    const html = renderToStaticMarkup(createElement(AppView, { projectId: 'app' }))
    expect(html).toContain('Only Maya or an admin can change this app.')
    expect(html).toContain('Tracks delivery.')
    expect(html).not.toContain('Sync now')
    expect(html).not.toContain('Draft again')
    expect(html).not.toContain('Auto-apply updates')
    expect(html).not.toContain('Connect agents')
    expect(html).not.toContain('aria-label="App link"')
  })
})


describe('AppView tasks', () => {
  const task = (id: string, problem: 'public-repo' | 'no-readme', title: string): AppTask => ({
    id, problem, title, detail: null, createdAt: '2026-10-05T12:00:00.000Z',
    draftedBy: { client: 'Claude', clientId: 'c1', memberId: 'owner', at: '2026-10-05T12:00:00.000Z' }, fixedAt: null,
  })
  const publicApp = (patch: Partial<Project> = {}) => app({ repo: { ...repo, private: false }, ...patch })

  it('sits right above Next steps, with the open task and a remove button', () => {
    const html = render(publicApp({ tasks: [task('a', 'public-repo', 'Make the repo private')] }))
    const tasks = html.indexOf('aria-label="Tasks"')
    expect(tasks).toBeGreaterThan(-1)
    expect(tasks).toBeLessThan(html.indexOf('aria-label="Next steps"'))
    expect(tasks).toBeGreaterThan(html.indexOf('Handover pack'))
    expect(html).toContain('Make the repo private')
    expect(html).toContain('aria-label="Remove task Make the repo private"')
  })

  it('is hidden when the app has no tasks', () => {
    expect(render(publicApp())).not.toContain('aria-label="Tasks"')
  })

  it('counts a task as fixed as soon as its flag is gone', () => {
    // The repo is private now (no public-repo flag), so the task is fixed before any sync saved it.
    const html = render(app({ tasks: [task('a', 'public-repo', 'Make the repo private')] }))
    expect(html).toContain('1 fixed')
    expect(html).not.toContain('Remove task')
  })

  it('shows a person who cannot edit the app its tasks without remove buttons', () => {
    const viewer: Member = { ...owner, id: 'viewer', name: 'Viewer', role: 'member' }
    useStore.setState({
      hydrated: true, projects: [publicApp({ tasks: [task('a', 'public-repo', 'Make the repo private')] })],
      members: [owner, viewer], meId: viewer.id, activity: [], workspace: { id: 'team', name: 'Team' },
    })
    const html = renderToStaticMarkup(createElement(AppView, { projectId: 'app' }))
    expect(html).toContain('Make the repo private')
    expect(html).not.toContain('Remove task')
  })
})


describe('repo work dependencies', () => {
  it('ignores activity and feed updates, but tracks project, repo and token changes', () => {
    const state = { projectId: 'app', fullName: 'acme/web', token: 'token', activity: [], feed: [] }
    const key = repoWorkDependencyKey(state)
    const updated = { ...state, activity: ['new commit'], feed: ['new issue'] }
    expect(repoWorkDependencyKey(updated)).toBe(key)
    expect(repoWorkDependencyKey({ ...state, fullName: 'acme/api' })).not.toBe(key)
    expect(repoWorkDependencyKey({ ...state, projectId: 'other' })).not.toBe(key)
    expect(repoWorkDependencyKey({ ...state, token: 'new-token' })).not.toBe(key)
  })
})
