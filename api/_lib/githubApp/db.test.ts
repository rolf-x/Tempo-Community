import { describe, expect, it } from 'vitest'
import { dbConfig, dueRepos, recordDelivery, rpc, RpcError, saveFacts, unlinkInstallation } from './db'
import { ANON, backend, ENV, json, SERVER_KEY } from './testkit'

describe('rpc', () => {
  it('posts JSON to the function with the anon key as apikey and bearer', async () => {
    const api = backend({ rpc: { github_thing: () => ({ ok: 1 }) } })
    expect(await rpc(ENV, 'github_thing', { a: 1 }, { fetch: api.fetch })).toEqual({ ok: 1 })
    const [call] = api.rpcs()
    expect(call.url).toBe('https://db.test/rest/v1/rpc/github_thing')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ a: 1 })
    expect(call.headers).toMatchObject({ apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' })
  })

  it('uses the person\'s JWT as the bearer when given one, with the anon key still as apikey', async () => {
    const api = backend()
    await rpc(ENV, 'github_thing', {}, { jwt: 'user.jwt.token', fetch: api.fetch })
    expect(api.rpcs()[0].headers).toMatchObject({ apikey: ANON, authorization: 'Bearer user.jwt.token' })
  })

  it('reads the VITE_ names too, and trims a trailing slash', () => {
    expect(dbConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({ url: 'https://x.supabase.co', anon: 'k' })
    expect(dbConfig({ SUPABASE_URL: 'https://a', VITE_SUPABASE_URL: 'https://b', SUPABASE_ANON_KEY: 'k1', VITE_SUPABASE_ANON_KEY: 'k2' })).toEqual({ url: 'https://a', anon: 'k1' })
    expect(dbConfig({})).toBeNull()
  })

  it('surfaces a PostgREST error as { code, message }', async () => {
    const api = backend({ rpc: { github_thing: () => json({ code: '42501', message: 'not a manager', details: null, hint: null }, 403) } })
    const error = await rpc(ENV, 'github_thing', {}, { fetch: api.fetch }).catch((e) => e)
    expect(error).toBeInstanceOf(RpcError)
    expect(error).toMatchObject({ code: '42501', message: 'not a manager', status: 403 })
  })

  it('still reports a refusal that is not JSON, an unreachable database and a bad function name', async () => {
    const html = backend({ rpc: { github_thing: () => new Response('<html>bad gateway</html>', { status: 502 }) } })
    await expect(rpc(ENV, 'github_thing', {}, { fetch: html.fetch })).rejects.toMatchObject({ code: '502', status: 502 })
    await expect(rpc(ENV, 'github_thing', {}, { fetch: (async () => { throw new Error('offline') }) as typeof fetch })).rejects.toMatchObject({ code: 'unreachable' })
    await expect(rpc(ENV, '../auth/v1/admin', {}, { fetch: backend().fetch })).rejects.toBeInstanceOf(RpcError)
    await expect(rpc({}, 'github_thing', {}, { fetch: backend().fetch })).rejects.toMatchObject({ code: 'not_configured' })
  })
})

describe('the server-key functions', () => {
  it('pass TEMPO_SERVER_KEY as p_key with the documented argument names', async () => {
    const api = backend({ rpc: { github_due_repos: () => [{ installation_id: 1, full_name: 'a/b' }], github_unlink_installation: () => 2 } })
    const call = { env: ENV, fetch: api.fetch }
    await recordDelivery(call, 'abc')
    await saveFacts(call, { installationId: 5, repo: { id: 9, fullName: 'a/b', private: false, defaultBranch: 'main' }, signals: null, activeAt: '2026-10-06T00:00:00.000Z' })
    expect(await unlinkInstallation(call, 5)).toBe(2)
    expect(await dueRepos(call, 100)).toEqual([{ installation_id: 1, full_name: 'a/b' }])
    expect(api.rpcs().map((c) => c.body)).toEqual([
      { p_key: SERVER_KEY, p_id: 'abc' },
      { p_key: SERVER_KEY, p_installation: 5, p_repo: { id: 9, fullName: 'a/b', private: false, defaultBranch: 'main' }, p_signals: null, p_active_at: '2026-10-06T00:00:00.000Z', p_old_full_name: null },
      { p_key: SERVER_KEY, p_installation: 5 },
      { p_key: SERVER_KEY, p_limit: 100 },
    ])
  })

  it('refuse to run without a server key', () => {
    expect(() => recordDelivery({ env: { ...ENV, TEMPO_SERVER_KEY: undefined } }, 'abc')).toThrow(RpcError)
  })
})
