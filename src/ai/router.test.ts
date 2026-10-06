import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { useSession } from '../data/session'
import { clearGitHubCache } from '../data/github'
import { aiSyncApp } from './router'

const mockFetch = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers })
let projectId: string

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  clearGitHubCache()
  useStore.getState().resetAll()
  useStore.getState().setAI({ provider: 'none' })
  useSession.setState({ githubToken: 'test-token' })
  projectId = useStore.getState().createProject({
    name: 'Web', repo: { fullName: 'acme/web', url: 'https://github.com/acme/web', private: false, defaultBranch: 'main' },
  }).id
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function repoResponse(url: string) {
  if (url.endsWith('/acme/web')) return json({ full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: true, default_branch: 'main', description: null, pushed_at: null })
  if (url.includes('/commits?')) return json([{ sha: 'abcdef123', html_url: 'https://github.com/acme/web/commit/abcdef123', commit: { message: 'Ship it', author: { name: 'Maya', date: '2026-10-04' } }, author: null }])
  if (url.includes('/readme')) return new Response('# Web')
  if (url.includes('/git/trees/')) return json({ tree: [] })
  return json([])
}

describe('app sync GitHub reads', () => {
  it('returns fresh visibility and commits from one full repo read', async () => {
    mockFetch.mockImplementation(async (url) => repoResponse(String(url)))
    const out = await aiSyncApp(projectId)
    expect(out.facts.meta.private).toBe(true)
    expect(out.facts.commits).toMatchObject([{ author: 'Maya', message: 'Ship it', date: '2026-10-04' }])
    expect(mockFetch).toHaveBeenCalledTimes(7)
    expect(new Set(mockFetch.mock.calls.map(([url]) => url)).size).toBe(7)
  })

  it('waits and retries a single sync when the reset is within 60 seconds', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(json({}, 429, { 'retry-after': '60' }))
      .mockImplementation(async (url) => repoResponse(String(url)))
    const pending = aiSyncApp(projectId)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).facts.meta.private).toBe(true)
    expect(mockFetch.mock.calls[1][0]).toBe(mockFetch.mock.calls[0][0])
  })

  it('does not retry a single sync beyond 60 seconds', async () => {
    mockFetch.mockResolvedValueOnce(json({}, 429, { 'retry-after': '61' }))
    await expect(aiSyncApp(projectId)).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('honours caller rate-limit handling and cancellation', async () => {
    const controller = new AbortController()
    const onRateLimit = vi.fn(async () => { controller.abort() })
    mockFetch.mockResolvedValueOnce(json({}, 429, { 'retry-after': '120' }))
    await expect(aiSyncApp(projectId, { onRateLimit, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(onRateLimit).toHaveBeenCalledOnce()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
