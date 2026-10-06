import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGitHub, handleSession, isAllowedGitHubPath, openToken, sealToken } from './githubProxy'

const key = randomBytes(32).toString('base64')
const otherKey = randomBytes(32).toString('base64')
const token = 'gho_0123456789abcdefghijklmnopqrstuv'
const refreshToken = 'ghr_0123456789abcdefghijklmnopqrstuv'
const nextToken = 'gho_abcdefghijklmnopqrstuvwxyz012345'
const nextRefreshToken = 'ghr_abcdefghijklmnopqrstuvwxyz012345'
const mockFetch = vi.fn<typeof fetch>()

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://tempo.example/api/github?path=${encodeURIComponent(path)}`, init)
const cookie = () => `__Host-tempo_gh=${sealToken(token, key)}`

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('token sealing', () => {
  it('round trips a token', () => {
    expect(openToken(sealToken(token, key), key)).toBe(token)
  })

  it('rejects tampering and the wrong key', () => {
    const sealed = sealToken(token, key)
    const at = Math.floor(sealed.length / 2)
    const replacement = sealed[at] === 'A' ? 'B' : 'A'
    expect(openToken(sealed.slice(0, at) + replacement + sealed.slice(at + 1), key)).toBeNull()
    expect(openToken(sealed, otherKey)).toBeNull()
  })
})

describe('GitHub proxy', () => {
  it.each([
    '/user',
    '/user/orgs?per_page=100&page=1',
    '/user/repos?per_page=100',
    '/user/installations?per_page=100&page=1',
    '/user/installations/42/repositories?per_page=100&page=2',
    '/orgs/acme',
    '/orgs/acme/repos?type=all',
    '/repos/acme/web',
    '/repos/acme/web/contents/',
    '/repos/acme/web/contents/memory/progress.md',
    '/repos/acme/web/readme',
    '/repos/acme/web/commits?per_page=30',
    '/repos/acme/web/pulls?state=open',
    '/repos/acme/web/issues?state=open',
    '/repos/acme/web/git/trees/feature/work?recursive=1',
    '/repos/acme/web/deployments?environment=Production',
    '/repos/acme/web/deployments/42/statuses?per_page=1',
  ])('allows the read path %s', (path) => {
    expect(isAllowedGitHubPath(path)).toBe(true)
  })

  it('rejects non-GET requests', async () => {
    expect((await handleGitHub(request('/user', { method: 'POST' }), { GITHUB_TOKEN_KEY: key })).status).toBe(405)
  })

  it.each([
    '/repos/a/b/../../user',
    '//evil.com',
    'https://x',
    '/gists',
  ])('rejects unsafe or unlisted path %s', async (path) => {
    const response = await handleGitHub(request(path, { headers: { Cookie: cookie() } }), { GITHUB_TOKEN_KEY: key })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 401 without a cookie', async () => {
    const response = await handleGitHub(request('/user'), { GITHUB_TOKEN_KEY: key })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'not_connected' })
  })

  it('returns 503 without a configured key', async () => {
    const response = await handleGitHub(request('/user'), {})
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'not_configured' })
  })

  it('clears a cookie that cannot be opened', async () => {
    const response = await handleGitHub(request('/user', {
      headers: { Cookie: '__Host-tempo_gh=tampered' },
    }), { GITHUB_TOKEN_KEY: key })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('forwards the allow-listed request, safe headers, status and body', async () => {
    mockFetch.mockResolvedValue(new Response('slow down', {
      status: 429,
      headers: {
        'Content-Type': 'text/plain',
        Link: '<next>; rel="next"',
        ETag: 'abc',
        'Retry-After': '42',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '123',
        'X-Secret-Upstream': 'nope',
      },
    }))
    const path = '/repos/acme/web/commits?per_page=30'
    const response = await handleGitHub(request(path, {
      headers: { Cookie: cookie(), Accept: 'application/vnd.github.raw+json' },
    }), { GITHUB_TOKEN_KEY: key })

    expect(mockFetch).toHaveBeenCalledWith(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    })
    expect(response.status).toBe(429)
    expect(await response.text()).toBe('slow down')
    expect(response.headers.get('retry-after')).toBe('42')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(response.headers.get('x-secret-upstream')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns token_expired without clearing or forwarding an expired refreshable cookie', async () => {
    const expired = sealToken(token, key, { refreshToken, expiresAt: Date.now() - 1 })
    const response = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${expired}` } }), {
      GITHUB_TOKEN_KEY: key,
      GITHUB_APP_CLIENT_ID: 'client-id',
      GITHUB_APP_CLIENT_SECRET: 'client-secret',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'token_expired' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns token_expired without clearing after GitHub rejects a refreshable token', async () => {
    mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    const current = sealToken(token, key, { refreshToken, expiresAt: Date.now() + 60_000 })
    const response = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${current}` } }), {
      GITHUB_TOKEN_KEY: key,
      GITHUB_APP_CLIENT_ID: 'client-id',
      GITHUB_APP_CLIENT_SECRET: 'client-secret',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'token_expired' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('opens old-format cookies', async () => {
    mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    const oldCookie = sealToken(token, key)
    expect(openToken(oldCookie, key)).toBe(token)
    const response = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${oldCookie}` } }), {
      GITHUB_TOKEN_KEY: key,
    })

    expect(response.status).toBe(401)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://api.github.com/user')
  })

  it('passes GitHub 401 through when the cookie is not refreshable', async () => {
    mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    const expired = sealToken(token, key, { refreshToken, expiresAt: Date.now() - 1 })
    const response = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${expired}` } }), {
      GITHUB_TOKEN_KEY: key,
    })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('unauthorized')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://api.github.com/user')
  })

  it('rejects a session cookie sealed more than 30 days ago and clears it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const sealed = sealToken(token, key)
    vi.setSystemTime(new Date('2026-10-01T00:00:01Z'))
    expect(openToken(sealed, key)).toBeNull()
    expect(openToken(sealed, key, { allowStale: true })).toBe(token)

    const response = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${sealed}` } }), { GITHUB_TOKEN_KEY: key })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'not_connected' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still opens a session cookie just inside 30 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const sealed = sealToken(token, key)
    vi.setSystemTime(new Date('2026-09-30T23:59:59Z'))
    expect(openToken(sealed, key)).toBe(token)
  })

  it('follows a same-host GitHub redirect without ever following it automatically', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: 'https://api.github.com/repositories/42/commits?per_page=30' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
    const response = await handleGitHub(request('/repos/acme/old-name/commits?per_page=30', { headers: { Cookie: cookie() } }), { GITHUB_TOKEN_KEY: key })

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(String(mockFetch.mock.calls[1][0])).toBe('https://api.github.com/repositories/42/commits?per_page=30')
    for (const call of mockFetch.mock.calls) expect(call[1]).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) })
  })

  it.each([
    'https://evil.example/steal',
    'http://api.github.com/user',
    'https://api.github.com.evil.example/user',
  ])('does not follow a redirect to %s', async (location) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: location } }))
    const response = await handleGitHub(request('/user', { headers: { Cookie: cookie() } }), { GITHUB_TOKEN_KEY: key })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'github_unavailable' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('gives up on a redirect loop', async () => {
    mockFetch.mockImplementation(async () => new Response(null, { status: 307, headers: { Location: 'https://api.github.com/user' } }))
    const response = await handleGitHub(request('/user', { headers: { Cookie: cookie() } }), { GITHUB_TOKEN_KEY: key })

    expect(response.status).toBe(502)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns 502 when GitHub does not answer in time', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
    const response = await handleGitHub(request('/user', { headers: { Cookie: cookie() } }), { GITHUB_TOKEN_KEY: key })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'github_unavailable' })
  })
})

describe('GitHub session', () => {
  const sessionRequest = (method: string, body?: unknown, origin = 'https://tempo.example', sealed?: string, revoke = false) => new Request(
    `https://tempo.example/api/github-session${revoke ? '?revoke=1' : ''}`,
    {
      method,
      headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(sealed ? { Cookie: `__Host-tempo_gh=${sealed}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )

  it('rejects cross-origin requests and malformed tokens', async () => {
    expect((await handleSession(sessionRequest('POST', { token }, 'https://evil.example'), { GITHUB_TOKEN_KEY: key })).status).toBe(403)
    expect((await handleSession(sessionRequest('PATCH', undefined, 'https://evil.example', sealToken(token, key, { refreshToken })), { GITHUB_TOKEN_KEY: key })).status).toBe(403)
    expect((await handleSession(sessionRequest('POST', { token: 'short' }), { GITHUB_TOKEN_KEY: key })).status).toBe(400)
    expect((await handleSession(sessionRequest('POST', { token, refreshToken: 'short' }), { GITHUB_TOKEN_KEY: key })).status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 503 without a configured key', async () => {
    const response = await handleSession(sessionRequest('GET'), {})
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'not_configured' })
  })

  it('validates the token and sets the encrypted cookie', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ login: 'maya' }), { status: 200 }))
    const response = await handleSession(sessionRequest('POST', { token }), { GITHUB_TOKEN_KEY: key })
    const setCookie = response.headers.get('set-cookie') ?? ''

    expect(await response.json()).toEqual({ connected: true, login: 'maya' })
    expect(setCookie).toContain('__Host-tempo_gh=')
    expect(setCookie).toContain('Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000')
    const sealed = setCookie.match(/__Host-tempo_gh=([^;]+)/)?.[1] ?? ''
    expect(openToken(sealed, key)).toBe(token)
  })

  it('sets an early expiry for app-mode sessions with a refresh token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ login: 'maya' }), { status: 200 }))
    const env = { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' }
    const session = await handleSession(sessionRequest('POST', { token, refreshToken }), env)
    const sealed = session.headers.get('set-cookie')?.match(/__Host-tempo_gh=([^;]+)/)?.[1] ?? ''
    mockFetch.mockReset()
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 - 5 * 60 * 1000 + 1)

    const response = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${sealed}` } }), env)

    await expect(response.json()).resolves.toEqual({ error: 'token_expired' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refreshes with PATCH and seals the rotated refresh token and early expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const env = { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' }
    const sealed = sealToken(token, key, { refreshToken, expiresAt: Date.now() - 1 })
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: nextToken,
      refresh_token: nextRefreshToken,
      expires_in: 28_800,
    }), { status: 200 }))

    const response = await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', sealed), env)
    const nextSealed = response.headers.get('set-cookie')?.match(/__Host-tempo_gh=([^;]+)/)?.[1] ?? ''
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ connected: true })
    expect(openToken(nextSealed, key)).toBe(nextToken)
    expect(String(mockFetch.mock.calls[0][1]?.body)).toContain(`refresh_token=${refreshToken}`)

    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: token, refresh_token: refreshToken, expires_in: 28_800 }), { status: 200 }))
    await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', nextSealed), env)
    expect(String(mockFetch.mock.calls[0][1]?.body)).toContain(`refresh_token=${nextRefreshToken}`)

    mockFetch.mockReset()
    vi.advanceTimersByTime(28_800_000 - 5 * 60 * 1000 + 1)
    const expired = await handleGitHub(request('/user', { headers: { Cookie: `__Host-tempo_gh=${nextSealed}` } }), env)
    await expect(expired.json()).resolves.toEqual({ error: 'token_expired' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('keeps the cookie when PATCH refresh fails', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad_refresh_token' }), { status: 401 }))
    const sealed = sealToken(token, key, { refreshToken, expiresAt: Date.now() - 1 })
    const response = await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', sealed), {
      GITHUB_TOKEN_KEY: key,
      GITHUB_APP_CLIENT_ID: 'client-id',
      GITHUB_APP_CLIENT_SECRET: 'client-secret',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'refresh_failed' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('rejects unusable PATCH sessions without erasing a readable cookie', async () => {
    const noCookie = await handleSession(sessionRequest('PATCH'), { GITHUB_TOKEN_KEY: key })
    expect(noCookie.status).toBe(401)
    expect(noCookie.headers.get('set-cookie')).toBeNull()

    const unreadable = await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', 'tampered'), { GITHUB_TOKEN_KEY: key })
    expect(unreadable.status).toBe(401)
    expect(unreadable.headers.get('set-cookie')).toContain('Max-Age=0')

    const notRefreshable = await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', sealToken(token, key)), { GITHUB_TOKEN_KEY: key })
    expect(notRefreshable.status).toBe(400)
    await expect(notRefreshable.json()).resolves.toEqual({ error: 'not_refreshable' })
    expect(notRefreshable.headers.get('set-cookie')).toBeNull()
  })

  it('reports an existing cookie and clears it on same-origin DELETE', async () => {
    const get = new Request('https://tempo.example/api/github-session', { headers: { Cookie: cookie() } })
    await expect((await handleSession(get, { GITHUB_TOKEN_KEY: key })).json()).resolves.toEqual({ connected: true })

    const response = await handleSession(sessionRequest('DELETE'), { GITHUB_TOKEN_KEY: key })
    expect(await response.json()).toEqual({ connected: false })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('revokes the GitHub grant and clears the cookie', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await handleSession(
      sessionRequest('DELETE', undefined, 'https://tempo.example', sealToken(token, key), true),
      { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ connected: false, revoked: true })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/applications/client-id/grant', {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: token }),
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    })
  })

  it('clears the cookie when GitHub refuses the revoke', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }))
    const response = await handleSession(
      sessionRequest('DELETE', undefined, 'https://tempo.example', sealToken(token, key), true),
      { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' },
    )

    await expect(response.json()).resolves.toEqual({ connected: false, revoked: false })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('refuses to refresh a session sealed more than 30 days ago, but a refresh restarts the 30 days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const env = { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' }
    const sealed = sealToken(token, key, { refreshToken, expiresAt: Date.now() + 60_000 })

    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: nextToken, refresh_token: nextRefreshToken, expires_in: 28_800 }), { status: 200 }))
    const refreshed = await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', sealed), env)
    expect(refreshed.status).toBe(200)
    const nextSealed = refreshed.headers.get('set-cookie')?.match(/__Host-tempo_gh=([^;]+)/)?.[1] ?? ''

    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
    expect(openToken(nextSealed, key)).toBe(nextToken)
    mockFetch.mockReset()
    const stale = await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', sealed), env)
    expect(stale.status).toBe(401)
    expect(stale.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports a session sealed more than 30 days ago as not connected', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const sealed = sealToken(token, key)
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
    const get = new Request('https://tempo.example/api/github-session', { headers: { Cookie: `__Host-tempo_gh=${sealed}` } })
    await expect((await handleSession(get, { GITHUB_TOKEN_KEY: key })).json()).resolves.toEqual({ connected: false })
  })

  it('still revokes the grant when the cookie is older than 30 days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const sealed = sealToken(token, key)
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await handleSession(
      sessionRequest('DELETE', undefined, 'https://tempo.example', sealed, true),
      { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' },
    )

    await expect(response.json()).resolves.toEqual({ connected: false, revoked: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('gives every upstream call a deadline and refuses redirects', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ login: 'maya' }), { status: 200 }))
    await handleSession(sessionRequest('POST', { token }), { GITHUB_TOKEN_KEY: key })
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) })

    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'x' }), { status: 200 }))
    await handleSession(sessionRequest('PATCH', undefined, 'https://tempo.example', sealToken(token, key, { refreshToken })), {
      GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret',
    })
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) })
  })

  it('treats a redirect from the token check as an invalid token', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }))
    const response = await handleSession(sessionRequest('POST', { token }), { GITHUB_TOKEN_KEY: key })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('clears the cookie without calling GitHub when app credentials are missing', async () => {
    const response = await handleSession(
      sessionRequest('DELETE', undefined, 'https://tempo.example', sealToken(token, key), true),
      { GITHUB_TOKEN_KEY: key },
    )

    await expect(response.json()).resolves.toEqual({ connected: false, revoked: false })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects cross-origin revoke requests without clearing or calling GitHub', async () => {
    const response = await handleSession(
      sessionRequest('DELETE', undefined, 'https://evil.example', sealToken(token, key), true),
      { GITHUB_TOKEN_KEY: key, GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' },
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('conditional GitHub proxy reads', () => {
  it('forwards If-None-Match and passes a bodyless 304 and rate headers through', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, {
      status: 304, headers: { etag: '"v1"', 'x-ratelimit-remaining': '4999' },
    }))
    const response = await handleGitHub(request('/user', {
      headers: { Cookie: cookie(), 'If-None-Match': '"v1"' },
    }), { GITHUB_TOKEN_KEY: key })
    expect(new Headers(mockFetch.mock.calls[0][1]?.headers).get('if-none-match')).toBe('"v1"')
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"v1"')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('4999')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.body).toBeNull()
    expect(await response.text()).toBe('')
  })

  it.each(['x'.repeat(257), 'bad\tvalue', 'bad\x7fvalue', 'bad\x01value'])('drops an unsafe conditional header %j', async (etag) => {
    mockFetch.mockResolvedValueOnce(new Response('{}'))
    await handleGitHub(request('/user', {
      headers: { Cookie: cookie(), 'If-None-Match': etag },
    }), { GITHUB_TOKEN_KEY: key })
    expect(new Headers(mockFetch.mock.calls[0][1]?.headers).has('if-none-match')).toBe(false)
  })

  it.each([204, 205])('passes bodyless status %i without constructing a body', async (status) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status }))
    const response = await handleGitHub(request('/user', { headers: { Cookie: cookie() } }), { GITHUB_TOKEN_KEY: key })
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
  })
})
