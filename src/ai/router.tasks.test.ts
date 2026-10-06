import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { useSession } from '../data/session'
import { clearGitHubCache } from '../data/github'
import type { AppTask } from '../types'
import { aiSyncApp } from './router'

const mockFetch = vi.fn<typeof fetch>()
const json = (body: unknown) => new Response(JSON.stringify(body))
const task = (id: string, problem: AppTask['problem'], fixedAt: string | null = null): AppTask => ({
  id, problem, title: `Task ${id}`, detail: null, createdAt: '2026-10-05T09:00:00.000Z',
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: '2026-10-05T09:00:00.000Z' }, fixedAt,
})

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url) => {
    const u = String(url)
    if (u.endsWith('/acme/web')) return json({ full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: false, default_branch: 'main', description: null, pushed_at: null })
    if (u.includes('/readme')) return new Response('# Web')
    if (u.includes('/git/trees/')) return json({ tree: [] })
    return json([])
  })
  clearGitHubCache()
  useStore.getState().resetAll()
  useStore.getState().setAI({ provider: 'none' })
  useSession.setState({ githubToken: 'test-token' })
})
afterEach(() => vi.unstubAllGlobals())

const web = { fullName: 'acme/web', url: 'https://github.com/acme/web', private: false, defaultBranch: 'main' }
const tasksOf = (id: string) => useStore.getState().projects.find((p) => p.id === id)!.tasks

describe('a sync closes the tasks whose flag is gone', () => {
  it('saves fixedAt on tasks whose flag the repo read cleared, and leaves the rest', async () => {
    const id = useStore.getState().createProject({
      name: 'Web', repo: web, ownerId: null,
      signals: { hasReadme: false, secretFiles: ['.env'], lastCommitAt: null, openIssues: 0, openPrs: 0, syncedAt: '2026-10-01T00:00:00.000Z' },
      tasks: [task('a', 'no-readme'), task('b', 'secrets'), task('c', 'no-owner'), task('d', 'public-repo'), task('e', 'stale', '2026-10-02T00:00:00.000Z')],
    }).id
    await aiSyncApp(id)
    const tasks = tasksOf(id)!
    // The README exists now and no secret file was found; the repo is still public and still has no owner.
    expect(tasks.map((t) => [t.id, t.fixedAt === null ? null : 'closed'])).toEqual([['a', 'closed'], ['b', 'closed'], ['c', null], ['d', null], ['e', 'closed']])
    expect(tasks[0].fixedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(tasks[4].fixedAt).toBe('2026-10-02T00:00:00.000Z')
  })

  it('closes the public-repo task on the sync that finds the repo private, before the caller saves the visibility', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/acme/web')) return json({ full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: true, default_branch: 'main', description: null, pushed_at: null })
      if (u.includes('/readme')) return new Response('# Web')
      if (u.includes('/git/trees/')) return json({ tree: [] })
      return json([])
    })
    const id = useStore.getState().createProject({ name: 'Web', repo: web, ownerId: null, tasks: [task('d', 'public-repo')] }).id
    await aiSyncApp(id)
    expect(tasksOf(id)![0].fixedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps nothing when the repo was changed while GitHub answered', async () => {
    const id = useStore.getState().createProject({ name: 'Web', repo: web, ownerId: null, tasks: [task('d', 'public-repo')] }).id
    mockFetch.mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/acme/web')) {
        useStore.getState().updateProject(id, { repo: { ...web, fullName: 'acme/other', url: 'https://github.com/acme/other' } })
        return json({ full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: true, default_branch: 'main', description: null, pushed_at: null })
      }
      if (u.includes('/readme')) return new Response('# Web')
      if (u.includes('/git/trees/')) return json({ tree: [] })
      return json([])
    })
    await expect(aiSyncApp(id)).rejects.toThrow(/repo changed while syncing/)
    expect(tasksOf(id)![0].fixedAt).toBeNull()
    expect(useStore.getState().projects.find((p) => p.id === id)!.signals).toBeNull()
  })

  it('does the same for a sample repo', async () => {
    const id = useStore.getState().createProject({
      name: 'Demo', repo: { ...web, fullName: 'acme-sample/demo', url: 'https://github.com/acme-sample/demo' }, ownerId: null,
      signals: { hasReadme: true, secretFiles: [], lastCommitAt: null, openIssues: 0, openPrs: 0, syncedAt: '2026-10-01T00:00:00.000Z' },
      tasks: [task('a', 'no-readme'), task('b', 'no-owner')],
    }).id
    await aiSyncApp(id)
    expect(tasksOf(id)!.map((t) => t.fixedAt === null)).toEqual([false, true])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('leaves an app without tasks alone, and an archived app\'s tasks open', async () => {
    const plain = useStore.getState().createProject({ name: 'Plain', repo: web }).id
    const archived = useStore.getState().createProject({ name: 'Old', repo: web, archived: true, tasks: [task('a', 'no-readme')] }).id
    await aiSyncApp(plain)
    await aiSyncApp(archived)
    expect(tasksOf(plain)).toBeUndefined()
    expect(tasksOf(archived)![0].fixedAt).toBeNull()
  })
})
