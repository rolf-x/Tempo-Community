import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { appJwt, githubGet, GitHubApiError, installationToken, optionalRead } from './auth'
import { backend, ENV, INSTALLATION_TOKEN, json, privateKeyPem, publicKeyPem } from './testkit'

const NOW = 1_791_000_000
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

describe('appJwt', () => {
  it('signs RS256 with the right claims, and the signature verifies with the public key', () => {
    const jwt = appJwt('12345', privateKeyPem, NOW)
    const [header, payload, signature] = jwt.split('.')
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(payload)).toEqual({ iat: NOW - 60, exp: NOW + 540, iss: '12345' })
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('accepts a PEM whose newlines arrive as a literal backslash-n, even in quotes', () => {
    const escaped = privateKeyPem.replace(/\n/g, '\\n')
    for (const pem of [escaped, `"${escaped}"`]) {
      const [header, payload, signature] = appJwt('12345', pem, NOW).split('.')
      expect(verify('sha256', Buffer.from(`${header}.${payload}`), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))).toBe(true)
    }
  })

  it('refuses a key that is not a key', () => {
    expect(() => appJwt('12345', 'not a key', NOW)).toThrow()
  })

  it('is base64url with no padding', () => {
    expect(appJwt('12345', privateKeyPem, NOW)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })
})

describe('installationToken', () => {
  it('asks for one repo, never for permissions, and signs with the App JWT', async () => {
    const api = backend()
    const token = await installationToken(ENV, 42, 'web', api.fetch, NOW)
    expect(token).toBe(INSTALLATION_TOKEN)
    const [call] = api.tokenRequests()
    expect(call.url).toBe('https://api.github.com/app/installations/42/access_tokens')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ repositories: ['web'] })
    expect(call.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': expect.any(String),
    })
    const jwt = call.headers.authorization.replace('Bearer ', '')
    expect(decode(jwt.split('.')[1])).toMatchObject({ iss: '12345', iat: NOW - 60, exp: NOW + 540 })
  })

  it.each([[404, 'not-found'], [401, 'auth'], [422, 'other'], [500, 'other']] as const)('maps %i to a typed error without the JWT in it', async (status, kind) => {
    const api = backend({ token: () => json({ message: 'nope' }, status) })
    const error = await installationToken(ENV, 42, 'web', api.fetch, NOW).catch((e) => e)
    expect(error).toBeInstanceOf(GitHubApiError)
    expect(error).toMatchObject({ kind, status })
    expect(error.message).not.toContain(api.tokenRequests()[0].headers.authorization.replace('Bearer ', ''))
  })

  it('fails on a missing token, a network error and a missing config', async () => {
    await expect(installationToken(ENV, 42, 'web', backend({ token: () => json({}, 201) }).fetch, NOW)).rejects.toBeInstanceOf(GitHubApiError)
    await expect(installationToken(ENV, 42, 'web', (async () => { throw new Error('offline') }) as typeof fetch, NOW)).rejects.toMatchObject({ kind: 'network' })
    await expect(installationToken({}, 42, 'web', backend().fetch, NOW)).rejects.toBeInstanceOf(GitHubApiError)
    await expect(installationToken(ENV, 0, 'web', backend().fetch, NOW)).rejects.toBeInstanceOf(GitHubApiError)
  })
})

describe('githubGet', () => {
  const get = (api = backend()) => githubGet(INSTALLATION_TOKEN, api.fetch)

  it('sends the token, the version and the right Accept header', async () => {
    const api = backend()
    await get(api)('/repos/acme/web')
    await get(api)('/repos/acme/web/readme', { raw: true })
    expect(api.reads()[0].headers).toMatchObject({ authorization: `Bearer ${INSTALLATION_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' })
    expect(api.reads()[1].headers.accept).toBe('application/vnd.github.raw+json')
  })

  it('returns parsed JSON, or the text when raw', async () => {
    expect(await get()('/repos/acme/web')).toMatchObject({ id: 99 })
    expect(await get()('/repos/acme/web/readme', { raw: true })).toBe('# Web')
  })

  it('turns an allowed 404 into null and throws any other', async () => {
    const api = backend({ github: () => json({}, 404) })
    expect(await get(api)('/repos/acme/web/readme', { allow404: true })).toBeNull()
    await expect(get(api)('/repos/acme/web')).rejects.toMatchObject({ kind: 'not-found', status: 404 })
  })

  it('names a 409 (an empty repo) by its status so the shared reader can handle it', async () => {
    await expect(get(backend({ github: () => json({}, 409) }))('/repos/acme/web/commits?per_page=30', { allow404: true })).rejects.toMatchObject({ status: 409, kind: 'other' })
  })

  it('reports rate limits with the reset time, from either kind of limit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
    const reset = Math.floor(Date.now() / 1000) + 120
    const primary = backend({ github: () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }) })
    await expect(get(primary)('/repos/acme/web')).rejects.toMatchObject({ kind: 'rate-limit', status: 403, resetAt: reset * 1000 })
    const secondary = backend({ github: () => json({ message: 'slow down' }, 429, { 'retry-after': '30' }) })
    await expect(get(secondary)('/repos/acme/web')).rejects.toMatchObject({ kind: 'rate-limit', status: 429, resetAt: Date.now() + 30_000 })
    vi.useRealTimers()
  })

  it('treats a plain 403 as an error, 401 as auth, and 5xx as other', async () => {
    await expect(get(backend({ github: () => json({ message: 'Resource not accessible' }, 403) }))('/repos/acme/web')).rejects.toMatchObject({ kind: 'other', status: 403 })
    await expect(get(backend({ github: () => json({}, 401) }))('/repos/acme/web')).rejects.toMatchObject({ kind: 'auth' })
    await expect(get(backend({ github: () => json({}, 502) }))('/repos/acme/web')).rejects.toMatchObject({ kind: 'other', status: 502 })
  })

  it('follows a redirect inside api.github.com and refuses any other', async () => {
    const hops: string[] = []
    const inside = backend({
      github: (path) => {
        hops.push(path)
        return path.startsWith('/repositories/') ? json(repoStub()) : new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/99' } })
      },
    })
    expect(await get(inside)('/repos/acme/old-name')).toMatchObject({ id: 99 })
    expect(hops).toEqual(['/repos/acme/old-name', '/repositories/99'])
    const outside = backend({ github: () => new Response(null, { status: 301, headers: { location: 'https://evil.example/steal' } }) })
    await expect(get(outside)('/repos/acme/web')).rejects.toBeInstanceOf(GitHubApiError)
    expect(outside.calls).toHaveLength(1)
  })

  it('refuses a path that is not an api.github.com path, and an answer it cannot read', async () => {
    await expect(get()('//evil.example/x')).rejects.toBeInstanceOf(GitHubApiError)
    await expect(get()('repos/acme/web')).rejects.toBeInstanceOf(GitHubApiError)
    await expect(get(backend({ github: () => new Response('<html>') }))('/repos/acme/web')).rejects.toBeInstanceOf(GitHubApiError)
  })

  it('never puts the token in an error', async () => {
    const error = await get(backend({ github: () => json({ message: INSTALLATION_TOKEN }, 500) }))('/repos/acme/web').catch((e: Error) => e) as Error
    expect(error.message).not.toContain(INSTALLATION_TOKEN)
  })
})

describe('optionalRead', () => {
  it('lets a rate limit or lost access stop the read, and swallows the rest', () => {
    expect(() => optionalRead(new GitHubApiError('x', 'rate-limit', 403))).toThrow(GitHubApiError)
    expect(() => optionalRead(new GitHubApiError('x', 'auth', 401))).toThrow(GitHubApiError)
    expect(optionalRead(new GitHubApiError('x', 'other', 500))).toBeNull()
    expect(optionalRead(new Error('boom'))).toBeNull()
  })
})

const repoStub = () => ({ id: 99 })
