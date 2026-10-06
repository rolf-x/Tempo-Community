import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { clearGitHubCache, fetchRepoRaw, fetchRepoWork, getViewer, githubRateLimitMessage, waitForGitHubReset, GITHUB_CONNECTED_KEY, GitHubError, inferWorkspaceRepoScope, listGitHubAccounts, listRepos, PROXY_TOKEN, readRepoRoot, repoCanBePreselected, repoCountFromLink, repoListPath, setSetupRepoScope, setupRepoScope } from './github'
import { useSession } from './session'

const mockFetch = vi.fn<typeof fetch>()
const apiRepo = (full_name = 'acme/web') => ({
  full_name, html_url: `https://github.com/${full_name}`, private: true, default_branch: 'main',
  description: 'A repo description', pushed_at: '2026-10-04T12:00:00Z',
  fork: false, archived: false, is_template: false, size: 42, homepage: 'https://example.com', language: 'TypeScript',
})
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers })
const files = (...names: string[]) => json(names.map((name) => ({ name, type: 'file' })))

beforeEach(() => {
  vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  clearGitHubCache()
  useStore.setState({ workspace: null })
  useSession.setState({ githubToken: null })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('listRepos', () => {
  it('builds account-scoped repo paths', () => {
    expect(repoListPath(2, { kind: 'org', login: 'halden freight' })).toBe('/orgs/halden%20freight/repos?per_page=100&type=all&sort=pushed&direction=desc&page=2')
    expect(repoListPath(1, { kind: 'personal', login: 'maya' })).toContain('affiliation=owner&page=1')
    expect(repoListPath(1, null)).toContain('affiliation=owner,collaborator,organization_member&page=1')
  })

  it('prefers the workspace organization over browser scopes', () => {
    const local = new Map([['tempo.repoScopes', JSON.stringify({ 'ws-halden': { kind: 'org', login: 'old-local' } })]])
    const session = new Map([['tempo.setupRepoScope', JSON.stringify({ kind: 'org', login: 'old-session' })]])
    vi.stubGlobal('localStorage', { getItem: (key: string) => local.get(key) ?? null })
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => session.get(key) ?? null })
    useStore.setState({ workspace: { id: 'ws-halden', name: 'Halden', kind: 'org', githubOrg: 'Halden-Team' } })

    expect(setupRepoScope()).toEqual({ kind: 'org', login: 'Halden-Team' })
  })

  it('never suggests a repo outside a known workspace organization', () => {
    const scope = { kind: 'org' as const, login: 'halden' }
    expect(repoCanBePreselected('halden/web', 'org', scope)).toBe(true)
    expect(repoCanBePreselected('maya/personal', 'org', scope)).toBe(false)
    expect(repoCanBePreselected('other/collab', 'org', scope)).toBe(false)
    expect(repoCanBePreselected('maya/personal', 'org', null)).toBe(false)
    expect(repoCanBePreselected('other/collab', 'org', null)).toBe(false)
    expect(repoCanBePreselected('maya/personal', 'personal', null)).toBe(true)
  })

  it('infers one legacy workspace organization from tracked repos without trusting a personal repo', () => {
    const repo = (fullName: string) => ({ fullName, url: `https://github.com/${fullName}`, private: true, defaultBranch: 'main' })
    expect(inferWorkspaceRepoScope([repo('halden/web'), repo('maya/personal'), repo('halden/api')], 'maya')).toEqual({ kind: 'org', login: 'halden' })
    expect(inferWorkspaceRepoScope([repo('halden/web'), repo('other/api')], 'maya')).toBeNull()
    expect(inferWorkspaceRepoScope([repo('halden/web'), repo('halden/api'), repo('other/api')], 'maya')).toBeNull()
    expect(inferWorkspaceRepoScope([], 'maya')).toBeNull()
  })

  it('uses an inferred legacy scope to keep broad listings out of an org picker', async () => {
    mockFetch.mockResolvedValueOnce(json([apiRepo('halden/web'), apiRepo('maya/personal')]))

    await listRepos('test-token', { scope: { kind: 'org', login: 'halden' } })

    expect(String(mockFetch.mock.calls[0][0])).toContain('/orgs/halden/repos')
  })

  it('keeps every listing scoped to the setup account', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
      removeItem: vi.fn((key: string) => { values.delete(key) }),
    }
    vi.stubGlobal('sessionStorage', storage)
    setSetupRepoScope({ kind: 'org', login: 'halden' })
    mockFetch.mockResolvedValueOnce(json([apiRepo('halden/web'), apiRepo('maya/personal')]))
    expect((await listRepos('test-token')).map((repo) => repo.fullName)).toEqual(['halden/web'])
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/orgs/halden/repos?per_page=100&type=all&sort=pushed&direction=desc&page=1')
    mockFetch.mockResolvedValueOnce(json([apiRepo('halden/api')]))
    expect((await listRepos('test-token'))[0].fullName).toBe('halden/api')
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.github.com/orgs/halden/repos?per_page=100&type=all&sort=pushed&direction=desc&page=1')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('remembers the setup account per workspace, after a reload too', async () => {
    const store = (values: Map<string, string>) => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    const local = new Map<string, string>()
    vi.stubGlobal('localStorage', store(local))
    vi.stubGlobal('sessionStorage', store(new Map()))
    useStore.setState({ workspace: { id: 'ws-halden', name: 'Halden', kind: 'org' } })
    setSetupRepoScope({ kind: 'org', login: 'halden' })

    vi.stubGlobal('sessionStorage', store(new Map())) // a new tab
    mockFetch.mockResolvedValueOnce(json([apiRepo('halden/web')]))
    await listRepos('test-token')
    expect(String(mockFetch.mock.calls[0][0])).toContain('/orgs/halden/repos')

    useStore.setState({ workspace: { id: 'ws-other', name: 'Mine', kind: 'personal' } })
    mockFetch.mockResolvedValueOnce(json([apiRepo('maya/personal')]))
    await listRepos('test-token')
    expect(String(mockFetch.mock.calls[1][0])).toContain('/user/repos')
    useStore.setState({ workspace: null })
  })

  it('carries classification metadata and requests newest pushes first', async () => {
    mockFetch.mockResolvedValueOnce(json([apiRepo()]))
    expect(await listRepos('test-token')).toEqual([{
      fullName: 'acme/web', url: 'https://github.com/acme/web', private: true, defaultBranch: 'main',
      description: 'A repo description', pushedAt: '2026-10-04T12:00:00Z',
      fork: false, archived: false, is_template: false, size: 42, homepage: 'https://example.com', language: 'TypeScript',
    }])
    const [url, options] = mockFetch.mock.calls[0]
    expect(String(url)).toContain('sort=pushed&direction=desc')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('pages beyond 100, delivers pages early and deduplicates repos', async () => {
    mockFetch.mockResolvedValueOnce(json([apiRepo()], 200, { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }))
      .mockResolvedValueOnce(json([apiRepo(), apiRepo('acme/second')]))
    const onPage = vi.fn()
    expect((await listRepos('test-token', { onPage })).map((r) => r.fullName)).toEqual(['acme/web', 'acme/second'])
    expect(onPage.mock.calls.map(([page]) => page.length)).toEqual([1, 2])
    expect(String(mockFetch.mock.calls[1][0])).toContain('page=2')
  })

  it('preserves exclusions and null optional metadata', async () => {
    mockFetch.mockResolvedValueOnce(json([{ ...apiRepo(), fork: true, archived: true, is_template: true, size: 0, homepage: null, language: null }]))
    expect((await listRepos('test-token'))[0]).toMatchObject({ fork: true, archived: true, is_template: true, size: 0, homepage: null, language: null })
  })

  it('lists and paginates repositories from the selected installation in app mode', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    mockFetch.mockResolvedValueOnce(json({
      total_count: 1,
      installations: [{ id: 42, repository_selection: 'selected', account: { login: 'acme', avatar_url: '', type: 'Organization' } }],
    }))
      .mockResolvedValueOnce(json({ total_count: 2, repositories: [apiRepo('acme/older')] }))
      .mockResolvedValueOnce(json({ total_count: 2, repositories: [apiRepo('acme/newer')] }))
    const onPage = vi.fn()

    const repos = await listRepos('test-token', {
      scope: { kind: 'org', login: 'acme', installationId: 42 },
      onPage,
    })

    expect(repos.map((repo) => repo.fullName)).toEqual(['acme/older', 'acme/newer'])
    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/user/installations?per_page=100&page=1',
      'https://api.github.com/user/installations/42/repositories?per_page=100&page=1',
      'https://api.github.com/user/installations/42/repositories?per_page=100&page=2',
    ])
    expect(onPage.mock.calls.map(([page]) => page.length)).toEqual([1, 2])
  })

  it('resolves a changed installation id from the saved account identity', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    mockFetch.mockResolvedValueOnce(json({
      total_count: 1,
      installations: [{ id: 99, repository_selection: 'all', account: { login: 'Acme', avatar_url: '', type: 'Organization' } }],
    })).mockResolvedValueOnce(json({ total_count: 1, repositories: [apiRepo('acme/web')] }))

    const repos = await listRepos('test-token', { scope: { kind: 'org', login: 'acme', installationId: 42 } })

    expect(repos.map((repo) => repo.fullName)).toEqual(['acme/web'])
    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/user/installations?per_page=100&page=1',
      'https://api.github.com/user/installations/99/repositories?per_page=100&page=1',
    ])
  })

  it('returns no repos when the scoped account no longer has an installation', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    mockFetch.mockResolvedValueOnce(json({
      total_count: 1,
      installations: [{ id: 7, repository_selection: 'all', account: { login: 'maya', avatar_url: '', type: 'User' } }],
    }))

    expect(await listRepos('test-token', { scope: { kind: 'org', login: 'acme', installationId: 42 } })).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('single-flights refresh for parallel expired proxy requests and retries them once', async () => {
    useSession.setState({ githubToken: PROXY_TOKEN })
    let proxyRequests = 0
    let patchRequests = 0
    let finishRefresh!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => { finishRefresh = resolve })
    mockFetch.mockImplementation(async (url, init) => {
      if (url === '/api/github-session' && init?.method === 'PATCH') {
        patchRequests++
        return refresh
      }
      if (String(url).startsWith('/api/github?')) {
        proxyRequests++
        return proxyRequests <= 2 ? json({ error: 'token_expired' }, 401) : json([apiRepo()])
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })

    const requests = [listRepos(PROXY_TOKEN), listRepos(PROXY_TOKEN)]
    await vi.waitFor(() => {
      expect(proxyRequests).toBe(2)
      expect(patchRequests).toBe(1)
    })
    finishRefresh(json({ connected: true }))

    const results = await Promise.all(requests)
    expect(results.map(([repo]) => repo.fullName)).toEqual(['acme/web', 'acme/web'])
    expect(patchRequests).toBe(1)
    expect(proxyRequests).toBe(4)
  })

  it('retries once even when PATCH refresh fails', async () => {
    mockFetch.mockResolvedValueOnce(json({ error: 'token_expired' }, 401))
      .mockResolvedValueOnce(json({ error: 'refresh_failed' }, 401))
      .mockResolvedValueOnce(json([apiRepo()]))

    expect((await listRepos(PROXY_TOKEN))[0].fullName).toBe('acme/web')
    expect(mockFetch.mock.calls.map(([url, init]) => [String(url).split('?')[0], init?.method ?? 'GET'])).toEqual([
      ['/api/github', 'GET'],
      ['/api/github-session', 'PATCH'],
      ['/api/github', 'GET'],
    ])
  })
})

describe('GitHub accounts', () => {
  const viewer = { login: 'maya', name: 'Maya Chen', avatar_url: 'maya.png', public_repos: 3, total_private_repos: 8 }
  const org = { login: 'halden', avatar_url: 'halden.png' }

  it('lists organizations before the personal account and adds visible private repos', async () => {
    mockFetch.mockResolvedValueOnce(json(viewer))
      .mockResolvedValueOnce(json([org]))
      .mockResolvedValueOnce(json({ ...org, name: 'Halden Freight', public_repos: 12, total_private_repos: 30 }))
    expect(await listGitHubAccounts('test-token')).toEqual([
      { kind: 'org', login: 'halden', name: 'Halden Freight', avatarUrl: 'halden.png', repoCount: 42, approvalRequired: false },
      { kind: 'personal', login: 'maya', name: 'Maya Chen', avatarUrl: 'maya.png', repoCount: 11, approvalRequired: false },
    ])
    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/user/orgs?per_page=100&page=1',
      'https://api.github.com/orgs/halden',
    ])
  })

  it('counts an organization from a per-page-one Link header when private totals are absent', async () => {
    mockFetch.mockResolvedValueOnce(json(viewer))
      .mockResolvedValueOnce(json([org]))
      .mockResolvedValueOnce(json({ ...org, name: null, public_repos: 6 }))
      .mockResolvedValueOnce(json([{}], 200, { link: '<https://api.github.com/organizations/1/repos?per_page=1&page=19>; rel="last"' }))
    expect((await listGitHubAccounts('test-token'))[0]).toMatchObject({ name: 'halden', repoCount: 19, approvalRequired: false })
    expect(mockFetch.mock.calls[3][0]).toBe('https://api.github.com/orgs/halden/repos?type=all&per_page=1')
  })

  it('marks an organization that blocks the OAuth app without blocking the personal path', async () => {
    mockFetch.mockResolvedValueOnce(json(viewer))
      .mockResolvedValueOnce(json([org]))
      .mockResolvedValueOnce(json({ message: 'Resource protected by organization SAML enforcement.' }, 403))
    expect(await listGitHubAccounts('test-token')).toEqual([
      { kind: 'org', login: 'halden', name: 'halden', avatarUrl: 'halden.png', repoCount: null, approvalRequired: true },
      { kind: 'personal', login: 'maya', name: 'Maya Chen', avatarUrl: 'maya.png', repoCount: 11, approvalRequired: false },
    ])
  })

  it('does not mistake an organization rate limit for missing approval', async () => {
    mockFetch.mockResolvedValueOnce(json(viewer))
      .mockResolvedValueOnce(json([org]))
      .mockResolvedValueOnce(json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((Date.now() + 60_000) / 1000) }))
    await expect(listGitHubAccounts('test-token')).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it('returns only the personal account when the user has no organizations', async () => {
    mockFetch.mockResolvedValueOnce(json(viewer)).mockResolvedValueOnce(json([]))
    expect(await listGitHubAccounts('test-token')).toEqual([
      { kind: 'personal', login: 'maya', name: 'Maya Chen', avatarUrl: 'maya.png', repoCount: 11, approvalRequired: false },
    ])
  })

  it('parses a last-page count and otherwise keeps the known public count', () => {
    expect(repoCountFromLink('<https://api.github.com/orgs/acme/repos?per_page=1&page=2>; rel="next", <https://api.github.com/orgs/acme/repos?per_page=1&page=42>; rel="last"', 1, 6)).toBe(42)
    expect(repoCountFromLink(null, 1, 6)).toBe(6)
  })

  it('maps GitHub App installations to accounts', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    mockFetch.mockResolvedValueOnce(json({
      total_count: 2,
      installations: [
        { id: 7, repository_selection: 'selected', account: { login: 'maya', avatar_url: 'maya.png', type: 'User' } },
        { id: 42, repository_selection: 'all', account: { login: 'halden', avatar_url: 'halden.png', type: 'Organization' } },
      ],
    }))

    expect(await listGitHubAccounts('test-token')).toEqual([
      { kind: 'org', login: 'halden', name: 'halden', avatarUrl: 'halden.png', repoCount: null, approvalRequired: false, installationId: 42, repositorySelection: 'all' },
      { kind: 'personal', login: 'maya', name: 'maya', avatarUrl: 'maya.png', repoCount: null, approvalRequired: false, installationId: 7, repositorySelection: 'selected' },
    ])
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/user/installations?per_page=100&page=1')
  })
})

describe('readRepoRoot', () => {
  it('reads only root files and package scripts as raw content', async () => {
    mockFetch.mockResolvedValueOnce(json([{ name: 'Dockerfile', type: 'dir' }, { name: 'package.json', type: 'file' }, { name: 'vercel.json', type: 'file' }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ scripts: { start: 'vite', build: 'tsc', blank: ' ', wrong: false } })))
    expect(await readRepoRoot('test-token', 'acme/web')).toEqual({ files: ['package.json', 'vercel.json'], scripts: { start: 'vite', build: 'tsc' } })
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/web/contents/')
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.github.com/repos/acme/web/contents/package.json')
    expect(mockFetch.mock.calls[1][1]?.headers).toMatchObject({ Accept: 'application/vnd.github.raw+json' })
  })

  it('does not request package.json when it is absent or a directory', async () => {
    mockFetch.mockResolvedValueOnce(json([{ name: 'package.json', type: 'dir' }, { name: 'README.md', type: 'file' }]))
    expect(await readRepoRoot('test-token', 'acme/web')).toEqual({ files: ['README.md'], scripts: {} })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each(['invalid JSON', 'null', '[]', '{"scripts":null}', '{"scripts":[]}', '{"scripts":"start"}'])('ignores invalid package scripts: %s', async (raw) => {
    mockFetch.mockResolvedValueOnce(files('package.json', 'fly.toml')).mockResolvedValueOnce(new Response(raw))
    expect(await readRepoRoot('test-token', 'acme/web')).toEqual({ files: ['package.json', 'fly.toml'], scripts: {} })
  })

  it('tolerates a package removed since the listing without hiding an unreadable repo', async () => {
    mockFetch.mockResolvedValueOnce(files('package.json')).mockResolvedValueOnce(json({}, 404))
    expect((await readRepoRoot('test-token', 'acme/web')).scripts).toEqual({})
    mockFetch.mockResolvedValueOnce(json({}, 404))
    await expect(readRepoRoot('test-token', 'acme/web')).rejects.toMatchObject({ kind: 'not-found' })
  })
})

describe('GitHub errors and recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')) })

  it.each([403, 429])('returns a reset timestamp for a %i primary limit', async (status) => {
    const reset = Date.now() + 42_000
    mockFetch.mockResolvedValueOnce(json({}, status, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset / 1000) }))
    await expect(listRepos('test-token')).rejects.toMatchObject({ name: 'GitHubError', kind: 'rate-limit', resetAt: reset })
  })

  it.each([403, 429])('honours Retry-After on a %i secondary limit with quota remaining', async (status) => {
    mockFetch.mockResolvedValueOnce(json({}, status, { 'retry-after': '42', 'x-ratelimit-remaining': '500' }))
    await expect(listRepos('test-token')).rejects.toMatchObject({ kind: 'rate-limit', resetAt: Date.now() + 42_000 })
  })

  it('accepts HTTP date Retry-After and waits for the later reset when both apply', async () => {
    mockFetch.mockResolvedValueOnce(json({}, 429, { 'retry-after': new Date(Date.now() + 42_000).toUTCString(), 'x-ratelimit-reset': String((Date.now() + 60_000) / 1000) }))
    await expect(listRepos('test-token')).rejects.toMatchObject({ resetAt: Date.now() + 60_000 })
  })

  it.each([
    [429, {}, {}],
    [403, { message: 'You have exceeded a secondary rate limit.' }, {}],
    [429, {}, { 'retry-after': 'invalid', 'x-ratelimit-reset': 'invalid' }],
  ])('uses a one-minute fallback without usable rate headers (%s)', async (status, body, headers) => {
    mockFetch.mockResolvedValueOnce(json(body, status as number, headers as HeadersInit))
    await expect(listRepos('test-token')).rejects.toMatchObject({ kind: 'rate-limit', resetAt: Date.now() + 60_000 })
  })

  it.each([[401, 'auth'], [403, 'other'], [404, 'not-found'], [500, 'other']])('keeps non-rate HTTP %s errors distinct', async (status, kind) => {
    mockFetch.mockResolvedValueOnce(json({ message: 'Permission denied' }, status as number))
    await expect(listRepos('test-token')).rejects.toMatchObject({ kind })
  })

  it('uses the same-origin proxy and disconnects its marker after a 401', async () => {
    const removeItem = vi.fn()
    vi.stubGlobal('localStorage', { removeItem })
    useSession.setState({ githubToken: PROXY_TOKEN })
    mockFetch.mockResolvedValueOnce(json({ error: 'not_connected' }, 401))

    await expect(listRepos(PROXY_TOKEN)).rejects.toMatchObject({ kind: 'auth' })

    expect(mockFetch.mock.calls[0]).toEqual([
      expect.stringMatching(/^\/api\/github\?path=/),
      expect.objectContaining({ credentials: 'same-origin' }),
    ])
    expect(mockFetch.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
    expect(removeItem).toHaveBeenCalledWith(GITHUB_CONNECTED_KEY)
    expect(useSession.getState().githubToken).toBeNull()
  })

  it('keeps connection failures distinct', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(listRepos('test-token')).rejects.toMatchObject({ kind: 'network' })
  })

  it('resumes the rate-limited page, preserving earlier pages', async () => {
    mockFetch.mockResolvedValueOnce(json([apiRepo()], 200, { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }))
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '42' }))
      .mockResolvedValueOnce(json([apiRepo('acme/second')]))
    const onRateLimit = vi.fn(async (error: GitHubError) => { await new Promise((resolve) => setTimeout(resolve, error.resetAt! - Date.now())) })
    const result = listRepos('test-token', { onRateLimit })
    await vi.advanceTimersByTimeAsync(41_999)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toHaveLength(2)
    expect(mockFetch.mock.calls[2][0]).toBe(mockFetch.mock.calls[1][0])
    expect(onRateLimit).toHaveBeenCalledTimes(1)
  })

  it('retries the package request and gates every request', async () => {
    mockFetch.mockResolvedValueOnce(files('package.json'))
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(new Response('{"scripts":{"dev":"vite"}}'))
    const beforeRequest = vi.fn(async () => {})
    const onRateLimit = vi.fn(async () => {})
    expect((await readRepoRoot('test-token', 'acme/web', { beforeRequest, onRateLimit })).scripts).toEqual({ dev: 'vite' })
    expect(beforeRequest).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[2][0]).toBe(mockFetch.mock.calls[1][0])
  })

  it('aborts an active request without converting cancellation to a network error', async () => {
    const controller = new AbortController()
    mockFetch.mockImplementationOnce(async (_url, options) => {
      controller.abort()
      options?.signal?.throwIfAborted()
      return json([])
    })
    await expect(listRepos('test-token', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not send a request after cancellation during a rate-limit pause', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce(json({}, 429))
    await expect(listRepos('test-token', { signal: controller.signal, onRateLimit: async () => { controller.abort() } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('GitHub conditional requests', () => {
  const viewer = { login: 'maya', name: 'Maya', avatar_url: 'maya.png' }

  it.each(['test-token', PROXY_TOKEN])('sends the etag and reuses a 304 body with %s', async (token) => {
    mockFetch.mockResolvedValueOnce(json(viewer, 200, { etag: '"v1"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const first = await getViewer(token)
    expect(await getViewer(token)).toEqual(first)
    expect(mockFetch.mock.calls[0][1]?.headers).not.toHaveProperty('If-None-Match')
    expect(mockFetch.mock.calls[1][1]?.headers).toMatchObject({ 'If-None-Match': '"v1"' })
  })

  it('clears cached bodies when the session token changes', async () => {
    useSession.setState({ githubToken: 'old-token' })
    mockFetch.mockImplementation(async () => json(viewer, 200, { etag: '"v1"' }))
    await getViewer('old-token')
    useSession.setState({ githubToken: 'new-token' })
    await getViewer('old-token') // Same argument proves the subscription cleared it.
    expect(mockFetch.mock.calls[1][1]?.headers).not.toHaveProperty('If-None-Match')
  })

  it('does not cache a response that arrives after a session change', async () => {
    let finish!: (response: Response) => void
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = getViewer('test-token')
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    useSession.setState({ githubToken: 'new-token' })
    finish(json(viewer, 200, { etag: '"old"' }))
    await pending
    mockFetch.mockResolvedValueOnce(json(viewer))
    await getViewer('test-token')
    expect(mockFetch.mock.calls[1][1]?.headers).not.toHaveProperty('If-None-Match')
  })

  it('leaves paginated onResponse reads uncached', async () => {
    mockFetch.mockImplementation(async () => json([apiRepo()], 200, { etag: '"page"' }))
    await listRepos('test-token')
    await listRepos('test-token')
    for (const [, options] of mockFetch.mock.calls) expect(options?.headers).not.toHaveProperty('If-None-Match')
  })

  it('caches raw content separately from JSON and skips oversized bodies', async () => {
    mockFetch.mockImplementation(async (url, options) => {
      if (String(url).endsWith('/contents/')) return files('package.json')
      if (new Headers(options?.headers).has('If-None-Match')) return new Response(null, { status: 304 })
      return new Response('{"scripts":{"dev":"vite"}}', { headers: { etag: '"raw"' } })
    })
    await readRepoRoot('test-token', 'acme/web')
    expect((await readRepoRoot('test-token', 'acme/web')).scripts).toEqual({ dev: 'vite' })
    expect(mockFetch.mock.calls[3][1]?.headers).toMatchObject({ 'If-None-Match': '"raw"' })
    mockFetch.mockReset()
    mockFetch.mockImplementation(async () => json({ ...viewer, name: 'x'.repeat(1_000_001) }, 200, { etag: '"big"' }))
    await getViewer('test-token')
    await getViewer('test-token')
    expect(mockFetch.mock.calls[1][1]?.headers).not.toHaveProperty('If-None-Match')
  })

  it('evicts the oldest entry at 300 and refreshes insertion order on a hit', async () => {
    mockFetch.mockImplementation(async () => json([], 200, { etag: '"files"' }))
    for (let index = 0; index < 300; index++) await readRepoRoot('test-token', `acme/repo${index}`)
    await readRepoRoot('test-token', 'acme/repo0')
    await readRepoRoot('test-token', 'acme/repo300')
    await readRepoRoot('test-token', 'acme/repo0')
    await readRepoRoot('test-token', 'acme/repo1')
    expect(mockFetch.mock.calls[302][1]?.headers).toHaveProperty('If-None-Match')
    expect(mockFetch.mock.calls[303][1]?.headers).not.toHaveProperty('If-None-Match')
  })

  it('clears the cache on 401', async () => {
    mockFetch.mockResolvedValueOnce(json(viewer, 200, { etag: '"v1"' }))
      .mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(viewer))
    await getViewer('test-token')
    await expect(getViewer('test-token')).rejects.toMatchObject({ kind: 'auth' })
    await getViewer('test-token')
    expect(mockFetch.mock.calls[2][1]?.headers).not.toHaveProperty('If-None-Match')
  })
})

describe('repo reads', () => {
  const commit = { sha: 'abcdef123', html_url: 'commit-url', commit: { message: 'Ship it', author: { name: 'Maya', date: '2026-10-04' } }, author: null }
  const pull = { number: 1, title: 'Release', html_url: 'pull-url', user: null, created_at: '2026-10-04' }
  const issue = { number: 2, title: 'Fix', html_url: 'issue-url', labels: ['bug', { name: 'urgent' }, {}], created_at: '2026-10-04' }
  const repoResponse = (url: string) => {
    if (url.endsWith('/acme/web')) return json(apiRepo())
    if (url.includes('/readme')) return new Response('# Web')
    if (url.includes('/commits?')) return json([commit])
    if (url.includes('/pulls?')) return json([pull])
    if (url.includes('/issues?')) return json([{ ...issue, pull_request: {} }, issue])
    if (url.includes('/git/trees/')) return json({ tree: [{ type: 'blob', path: 'CLAUDE.md' }] })
    if (url.includes('/contents/')) return new Response('Memory')
    if (url.includes('/statuses?')) return json([{ state: 'success', environment_url: 'https://web.example' }])
    return json([{ id: 1 }])
  }

  it('reads work with exactly three calls and shares the full read mappings', async () => {
    mockFetch.mockImplementation(async (url) => repoResponse(String(url)))
    const work = await fetchRepoWork('test-token', 'acme/web')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(work).toEqual({
      commits: [{ sha: commit.sha, message: 'Ship it', author: 'Maya', date: '2026-10-04', url: 'commit-url' }],
      pulls: [{ number: 1, title: 'Release', author: 'unknown', url: 'pull-url', draft: false, createdAt: '2026-10-04' }],
      issues: [{ number: 2, title: 'Fix', url: 'issue-url', labels: ['bug', 'urgent'], createdAt: '2026-10-04' }],
    })
    const raw = await fetchRepoRaw('test-token', 'acme/web')
    expect(raw).toMatchObject(work)
  })

  it.each([fetchRepoWork, fetchRepoRaw])('treats 409 commits as empty without dropping open work', async (read) => {
    mockFetch.mockImplementation(async (url) => String(url).includes('/commits?') ? json({}, 409) : repoResponse(String(url)))
    expect(await read('test-token', 'acme/web')).toMatchObject({ commits: [], pulls: [{ number: 1 }], issues: [{ number: 2 }] })
  })

  it('passes the gate, signal and retry handler to every full-read endpoint', async () => {
    const seen = new Set<string>()
    mockFetch.mockImplementation(async (url) => {
      if (!seen.has(String(url))) { seen.add(String(url)); return json({}, 429) }
      return repoResponse(String(url))
    })
    const beforeRequest = vi.fn(async () => {})
    const onRateLimit = vi.fn(async () => {})
    const signal = new AbortController().signal
    const raw = await fetchRepoRaw('test-token', 'acme/web', { beforeRequest, onRateLimit, signal })
    expect(raw.deployUrl).toBe('https://web.example')
    expect(onRateLimit).toHaveBeenCalledTimes(9)
    expect(beforeRequest).toHaveBeenCalledTimes(18)
    for (const [, options] of mockFetch.mock.calls) expect(options?.signal).toBe(signal)
  })

  it.each(['/git/trees/', '/deployments?', '/statuses?'])('does not swallow rate limits from %s', async (endpoint) => {
    mockFetch.mockImplementation(async (url) => String(url).includes(endpoint) ? json({}, 429) : repoResponse(String(url)))
    await expect(fetchRepoRaw('test-token', 'acme/web')).rejects.toMatchObject({ kind: 'rate-limit' })
  })
})

describe('bounded rate-limit waits', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')) })

  it.each([60_000, 300_000])('waits at the %i boundary and rejects longer pauses', async (maxWait) => {
    const error = new GitHubError('Limit', 'rate-limit', Date.now() + maxWait)
    let done = false
    const pending = waitForGitHubReset(error, maxWait).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(maxWait - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(done).toBe(true)
    await expect(waitForGitHubReset(new GitHubError('Limit', 'rate-limit', Date.now() + maxWait + 1), maxWait)).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it('cancels a wait immediately', async () => {
    const controller = new AbortController()
    const result = waitForGitHubReset(new GitHubError('Limit', 'rate-limit', Date.now() + 60_000), 60_000, controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('names the local reset time in the error', async () => {
    const resetAt = Date.now() + 120_000
    mockFetch.mockResolvedValueOnce(json({}, 429, { 'x-ratelimit-reset': String(resetAt / 1000) }))
    const time = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    expect(githubRateLimitMessage(resetAt)).toBe(`GitHub's hourly limit is used up. Try again after ${time}.`)
    await expect(getViewer('test-token')).rejects.toThrow(githubRateLimitMessage(resetAt))
  })
})
