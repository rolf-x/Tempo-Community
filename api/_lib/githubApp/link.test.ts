import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealToken } from '../githubProxy'
import { handleLink } from './link'
import { ANON, backend, ENV, json, SERVER_KEY, type BackendOptions } from './testkit'

const KEY = randomBytes(32).toString('base64')
const LINK_ENV = { ...ENV, GITHUB_TOKEN_KEY: KEY }
const WORKSPACE = '5b0f2d5e-1b35-4f4e-9d44-0c1a2b3c4d5e'
const USER_JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln'
const GH_TOKEN = 'gho_0123456789abcdefghijklmnopqrstuv'
const links = [{ installationId: 7, login: 'acme', linkedAt: '2026-10-06T12:00:00Z' }]

interface Over {
  method?: string
  origin?: string | null
  body?: unknown
  jwt?: string | null
  cookie?: string | null
  env?: Record<string, string | undefined>
}

async function call(over: Over = {}, options: BackendOptions = {}) {
  const api = backend(options)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (over.origin !== null) headers.Origin = over.origin ?? 'https://tempo.test'
  if (over.jwt !== null) headers.Authorization = `Bearer ${over.jwt ?? USER_JWT}`
  if (over.cookie !== null) headers.Cookie = over.cookie ?? `__Host-tempo_gh=${sealToken(GH_TOKEN, KEY)}`
  const method = over.method ?? 'POST'
  const request = new Request('https://tempo.test/api/github-link', {
    method, headers, body: method === 'GET' ? undefined : typeof over.body === 'string' ? over.body : JSON.stringify(over.body === undefined ? { workspaceId: WORKSPACE } : over.body),
  })
  const response = await handleLink(request, over.env ?? LINK_ENV, { fetch: api.fetch })
  return { response, api }
}

const installations = (list: unknown[]): BackendOptions => ({
  github: (path) => path.startsWith('/user/installations') ? json({ total_count: list.length, installations: list }) : undefined,
})

afterEach(() => vi.restoreAllMocks())

describe('who may ask', () => {
  it('answers 405 to anything but POST', async () => {
    expect((await call({ method: 'GET' })).response.status).toBe(405)
  })

  it('answers 503 when the server is not set up', async () => {
    for (const name of ['TEMPO_SERVER_KEY', 'GITHUB_TOKEN_KEY', 'SUPABASE_URL']) {
      expect((await call({ env: { ...LINK_ENV, [name]: undefined } })).response.status, name).toBe(503)
    }
  })

  it('answers 403 to another origin and to no Origin at all, before anything else happens', async () => {
    for (const origin of ['https://evil.example', 'https://tempo.test.evil.example', null]) {
      const { response, api } = await call({ origin })
      expect(response.status, String(origin)).toBe(403)
      expect(api.calls).toHaveLength(0)
    }
  })

  it('answers 400 for a body that is not { workspaceId: uuid }', async () => {
    for (const body of [{}, { workspaceId: 'abc' }, { workspaceId: 7 }, { workspaceId: `${WORKSPACE}x` }, null, [], '{nope', 'x'.repeat(5000)]) {
      const { response, api } = await call({ body })
      expect(response.status, JSON.stringify(body)?.slice(0, 40)).toBe(400)
      expect(api.calls).toHaveLength(0)
    }
  })

  it('answers 401 not_signed_in without a Supabase token', async () => {
    for (const jwt of [null, '']) {
      const { response, api } = await call({ jwt })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'not_signed_in' })
      expect(api.calls).toHaveLength(0)
    }
  })

  it('answers 401 not_connected without a GitHub cookie, or with one that does not open', async () => {
    for (const cookie of [null, '__Host-tempo_gh=garbage', `__Host-tempo_gh=${sealToken(GH_TOKEN, randomBytes(32).toString('base64'))}`]) {
      const { response, api } = await call({ cookie })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'not_connected' })
      expect(api.calls).toHaveLength(0)
    }
  })

  it('answers 401 token_expired for an access token past its expiry that can be refreshed', async () => {
    const cookie = `__Host-tempo_gh=${sealToken(GH_TOKEN, KEY, { refreshToken: 'ghr_0123456789abcdefghijklmnopqrstuv', expiresAt: Date.now() - 1000 })}`
    const env = { ...LINK_ENV, GITHUB_APP_CLIENT_ID: 'Iv1.x', GITHUB_APP_CLIENT_SECRET: 'secret' }
    const { response, api } = await call({ cookie, env })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'token_expired' })
    expect(api.calls).toHaveLength(0)
  })
})

describe('what it asks GitHub and the database', () => {
  it('answers 401 token_expired when GitHub refuses the person\'s token', async () => {
    const { response, api } = await call({}, { github: () => json({ message: 'Bad credentials' }, 401) })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'token_expired' })
    expect(api.rpcs()).toHaveLength(0)
  })

  it('answers 502 when GitHub fails', async () => {
    const { response } = await call({}, { github: () => json({}, 500) })
    expect(response.status).toBe(502)
  })

  it('sends only what the person\'s own token can see: [{ id, login }], with their JWT, and returns the links', async () => {
    const { response, api } = await call({}, {
      ...installations([
        { id: 7, account: { login: 'acme', type: 'Organization' }, repository_selection: 'all' },
        { id: 8, account: { login: 'maya' } },
        { id: 'x', account: { login: 'bad-id' } },
        { id: 9, account: null },
        { id: 10, account: { login: '../../evil' } },
      ]),
      rpc: { github_link_installations: () => links },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ links })

    const [read] = api.reads()
    expect(read.url).toBe('https://api.github.com/user/installations?per_page=100')
    expect(read.headers.authorization).toBe(`Bearer ${GH_TOKEN}`)

    const [rpc] = api.rpcs('github_link_installations')
    expect(rpc.body).toEqual({ p_key: SERVER_KEY, p_workspace: WORKSPACE, p_installations: [{ id: 7, login: 'acme' }, { id: 8, login: 'maya' }] })
    expect(rpc.headers.authorization).toBe(`Bearer ${USER_JWT}`)
    expect(rpc.headers.apikey).toBe(ANON)
  })

  it('links nothing, successfully, when the person can see no installation', async () => {
    const { response, api } = await call({}, { ...installations([]), rpc: { github_link_installations: () => [] } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ links: [] })
    expect(api.rpcs('github_link_installations')[0].body.p_installations).toEqual([])
  })

  it('never trusts an installation id from the request', async () => {
    const { api } = await call({ body: { workspaceId: WORKSPACE, installations: [{ id: 999, login: 'victim' }], installationId: 999 } }, {
      ...installations([{ id: 7, account: { login: 'acme' } }]), rpc: { github_link_installations: () => [] },
    })
    expect(api.rpcs('github_link_installations')[0].body.p_installations).toEqual([{ id: 7, login: 'acme' }])
  })

  it('maps the database refusals: 42501 to 403 not_manager, 28000 to 401, 22023 to 400', async () => {
    const fail = (code: string, status: number): BackendOptions => ({
      ...installations([{ id: 7, account: { login: 'acme' } }]),
      rpc: { github_link_installations: () => json({ code, message: 'words for people' }, status) },
    })
    const manager = await call({}, fail('42501', 403))
    expect(manager.response.status).toBe(403)
    expect(await manager.response.json()).toEqual({ error: 'not_manager' })
    const signedOut = await call({}, fail('28000', 401))
    expect(signedOut.response.status).toBe(401)
    expect(await signedOut.response.json()).toEqual({ error: 'not_signed_in' })
    expect((await call({}, fail('22023', 400))).response.status).toBe(400)
  })

  it('answers 500 with a generic body for anything else', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response } = await call({}, {
      ...installations([]),
      rpc: { github_link_installations: () => json({ code: 'XX000', message: `internal ${GH_TOKEN}` }, 500) },
    })
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain(GH_TOKEN)
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' })
  })
})
