import { describe, expect, it, vi } from 'vitest'
import { clientLabel, makeVerifier, sameOrigin, supabaseLive } from './auth'

const ISSUER = 'https://ref.supabase.co/auth/v1'
const now = 1_800_000_000
const good = { iss: ISSUER, sub: 'user-1', role: 'authenticated', client_id: 'client-1', exp: now + 600, scope: 'openid email' }
const verifier = (claims: Record<string, unknown> | Error) =>
  makeVerifier({ issuer: ISSUER, now: () => now * 1000, getClaims: async () => { if (claims instanceof Error) throw claims; return claims } })

describe('makeVerifier', () => {
  it('accepts a token Supabase issued to an OAuth client', async () => {
    const info = await verifier(good).verifyAccessToken('tok')
    expect(info).toMatchObject({ token: 'tok', clientId: 'client-1', scopes: ['openid', 'email'], expiresAt: now + 600, extra: { userId: 'user-1' } })
  })

  it.each([
    ['a browser session (no client_id)', { ...good, client_id: undefined }],
    ['an empty client_id', { ...good, client_id: '' }],
    ['another issuer', { ...good, iss: 'https://evil.supabase.co/auth/v1' }],
    ['an anon token', { ...good, role: 'anon' }],
    ['no expiry', { ...good, exp: undefined }],
    ['an expired token', { ...good, exp: now - 1 }],
    ['no subject', { ...good, sub: undefined }],
  ])('refuses %s as invalid_token', async (_, claims) => {
    await expect(verifier(claims as Record<string, unknown>).verifyAccessToken('tok')).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('turns a failed signature check into invalid_token, without the library message', async () => {
    const error = await verifier(new Error('JWS signature verification failed: key abc')).verifyAccessToken('tok').catch((e) => e)
    expect(error).toMatchObject({ code: 'invalid_token' })
    expect(String(error.message)).not.toContain('key abc')
  })

  it('refuses a token whose sign-in was revoked, and checks liveness only after the claims pass', async () => {
    const isLive = vi.fn(async () => false)
    const revoked = makeVerifier({ issuer: ISSUER, now: () => now * 1000, getClaims: async () => good, isLive })
    await expect(revoked.verifyAccessToken('tok')).rejects.toMatchObject({ code: 'invalid_token' })
    const browser = makeVerifier({ issuer: ISSUER, now: () => now * 1000, getClaims: async () => ({ ...good, client_id: undefined }), isLive })
    await expect(browser.verifyAccessToken('tok')).rejects.toMatchObject({ code: 'invalid_token' })
    expect(isLive).toHaveBeenCalledTimes(1)
  })

  it('lets an outage in the liveness check surface as a server error, not as a sign-out', async () => {
    const down = makeVerifier({ issuer: ISSUER, now: () => now * 1000, getClaims: async () => good, isLive: async () => { throw new Error('Supabase Auth is unavailable') } })
    const error = await down.verifyAccessToken('tok').catch((e) => e)
    expect(error).not.toMatchObject({ code: 'invalid_token' })
  })
})

describe('sameOrigin', () => {
  it('allows requests without an Origin (CLI clients and servers)', () => {
    expect(sameOrigin(new Request('https://tempo.test/api/mcp', { method: 'POST' }))).toBe(true)
  })
  it('allows the site itself', () => {
    expect(sameOrigin(new Request('https://tempo.test/api/mcp', { method: 'POST', headers: { Origin: 'https://tempo.test' } }))).toBe(true)
  })
  it('refuses a web page on another site', () => {
    expect(sameOrigin(new Request('https://tempo.test/api/mcp', { method: 'POST', headers: { Origin: 'https://evil.example' } }))).toBe(false)
    expect(sameOrigin(new Request('https://tempo.test/api/mcp', { method: 'POST', headers: { Origin: 'null' } }))).toBe(false)
  })
})

describe('clientLabel', () => {
  it.each([
    ['claude-code/2.1.289 (cli)', 'Claude Code'],
    ['codex_cli_rs/0.154.0 (Mac OS 27.0.0; arm64)', 'Codex'],
    ['Cursor/2.3.1', 'Cursor'],
    ['Claude-User', 'Claude'],
    ['python-httpx/0.28', null],
    [null, null],
  ])('%s → %s', (agent, label) => {
    expect(clientLabel(agent)).toBe(label)
  })
})

describe('supabaseLive', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  const live = (fetchImpl: typeof fetch) => supabaseLive('https://ref.supabase.co', 'anon', fetchImpl)('tok')

  it('is live while Supabase still knows the user and session', async () => {
    await expect(live(reply(200, { id: 'user-1', aud: 'authenticated', role: 'authenticated' }))).resolves.toBe(true)
  })

  it('is not live after a revoke: Supabase answers 403 session_not_found', async () => {
    await expect(live(reply(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }))).resolves.toBe(false)
  })

  it('is not live for a deleted user', async () => {
    await expect(live(reply(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' }))).resolves.toBe(false)
  })

  it('throws on an outage instead of signing the client out', async () => {
    await expect(live(reply(503, { msg: 'unavailable' }))).rejects.toThrow('unavailable')
  })
})

