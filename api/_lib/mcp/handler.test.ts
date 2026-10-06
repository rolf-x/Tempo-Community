import { describe, expect, it, vi } from 'vitest'
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server'
import type { TempoData } from './data'
import { createTempoMcp, depsFromEnv, type McpDeps } from './handler'

const ISSUER = 'https://ref.supabase.co/auth/v1'
const AS = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  registration_endpoint: `${ISSUER}/oauth/clients/register`,
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
}
const data: TempoData = {
  listApps: vi.fn(async () => []),
  getApp: vi.fn(async () => { throw new Error('unused') }),
  submitCard: vi.fn(async () => undefined),
  submitHandover: vi.fn(async () => undefined),
  submitTasks: vi.fn(async () => undefined),
}
const deps: McpDeps = {
  verifier: {
    async verifyAccessToken(token) {
      if (token !== 'good') throw new OAuthError(OAuthErrorCode.InvalidToken, 'bad token')
      return { token, clientId: 'c1', scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 600 }
    },
  },
  dataFor: () => data,
  authServerMetadata: async () => AS,
}
const handle = createTempoMcp(deps)
const URL_ = 'https://tempo.test/api/mcp'

const rpc = (body: unknown, headers: Record<string, string> = {}) => new Request(URL_, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer good', ...headers },
  body: JSON.stringify(body),
})
const INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
}
async function result(response: Response) {
  const raw = await response.text()
  const line = raw.startsWith('{') ? raw : raw.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? raw
  return JSON.parse(line)
}

describe('discovery', () => {
  it('serves protected resource metadata that points at the Supabase OAuth server', async () => {
    const response = await handle(new Request(`${URL_}?wk=prm`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ resource: URL_, authorization_servers: [ISSUER] })
  })
  it("passes Supabase's authorization server metadata through", async () => {
    expect(await (await handle(new Request(`${URL_}?wk=as`))).json()).toEqual(AS)
  })
  it('answers 503 when Supabase is unreachable', async () => {
    const down = createTempoMcp({ ...deps, authServerMetadata: async () => { throw new Error('down') } })
    expect((await down(new Request(`${URL_}?wk=prm`))).status).toBe(503)
  })
})

describe('the gate', () => {
  it('refuses a request without a token with 401 and tells the client where to sign in', async () => {
    const response = await handle(rpc(INIT, { Authorization: '' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata="https://tempo.test/.well-known/oauth-protected-resource/api/mcp"')
  })
  it('refuses a bad token with 401 invalid_token', async () => {
    const response = await handle(rpc(INIT, { Authorization: 'Bearer forged' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('invalid_token')
  })
  it('refuses a web page on another site with 403, before looking at the token', async () => {
    expect((await handle(rpc(INIT, { Origin: 'https://evil.example' }))).status).toBe(403)
  })
})

describe('MCP over HTTP', () => {
  it('initializes', async () => {
    const response = await handle(rpc(INIT))
    expect(response.status).toBe(200)
    expect((await result(response)).result.serverInfo.name).toBe('tempo')
  })
  it('introduces itself as staging on the staging site, so an AI app connected to both can tell them apart', async () => {
    const at = (url: string) => handle(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer good' },
      body: JSON.stringify(INIT),
    }))
    const staging = (await result(await at('https://tempo-staging.example.com/api/mcp'))).result
    expect(staging.serverInfo).toMatchObject({ name: 'tempo-staging', title: 'Tempo (staging)' })
    expect(staging.instructions).toMatch(/^This is Tempo \(staging\), at https:\/\/tempo-staging\.example\.com: a separate Tempo/)
    const live = (await result(await at('https://tempo.example.com/api/mcp'))).result
    expect(live.serverInfo).toMatchObject({ name: 'tempo', title: 'Tempo' })
    expect(live.instructions).toMatch(/^Tempo is a portfolio/)
  })
  it('lists the eight tools and two prompts', async () => {
    const tools = await result(await handle(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { 'mcp-protocol-version': '2025-06-18' })))
    expect(tools.result.tools.map((t: { name: string }) => t.name).sort())
      .toEqual(['find_app', 'get_app', 'get_apps', 'list_apps', 'submit_app_card', 'submit_app_cards', 'submit_handover', 'submit_tasks'])
    const prompts = await result(await handle(rpc({ jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} }, { 'mcp-protocol-version': '2025-06-18' })))
    expect(prompts.result.prompts.map((p: { name: string }) => p.name).sort()).toEqual(['handover', 'sync_app'])
  })
  it('the sync_app prompt tells the agent to save with submit_app_card', async () => {
    const out = await result(await handle(rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'sync_app' } }, { 'mcp-protocol-version': '2025-06-18' })))
    const text = out.result.messages[0].content.text as string
    expect(text).toContain('submit_app_card')
    expect(text).not.toContain('calling the sync_app tool')
  })
  it('the sync_app prompt asks for tasks after the card, for each problem in healthDetail', async () => {
    const out = await result(await handle(rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'sync_app' } }, { 'mcp-protocol-version': '2025-06-18' })))
    const text = out.result.messages[0].content.text as string
    expect(text.indexOf('submit_app_card')).toBeGreaterThan(-1)
    expect(text.indexOf('submit_tasks')).toBeGreaterThan(text.indexOf('submit_app_card'))
    expect(text).toMatch(/each problem in healthDetail/)
    expect(text).toMatch(/Skip this step when healthDetail is empty/)
  })
  it('the handover prompt does not ask for tasks', async () => {
    const out = await result(await handle(rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'handover' } }, { 'mcp-protocol-version': '2025-06-18' })))
    expect(out.result.messages[0].content.text).not.toContain('submit_tasks')
  })
  it('the server instructions mention submit_tasks', async () => {
    const init = await result(await handle(rpc(INIT)))
    expect(init.result.instructions).toContain('submit_tasks')
  })
  it('runs a tool with the caller\'s data', async () => {
    const out = await result(await handle(rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_apps', arguments: {} } }, { 'mcp-protocol-version': '2025-06-18' })))
    expect(JSON.parse(out.result.content[0].text)).toEqual({ apps: [], reviewUrl: 'https://tempo.test/#/review' })
  })
})

describe('depsFromEnv', () => {
  it('needs the Supabase URL and anon key', () => {
    expect(depsFromEnv({})).toBeNull()
    expect(depsFromEnv({ VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' })).not.toBeNull()
  })
  it('caches the authorization server metadata', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(AS)))
    const live = depsFromEnv({ VITE_SUPABASE_URL: 'https://ref.supabase.co/', VITE_SUPABASE_ANON_KEY: 'anon' }, fetchImpl as unknown as typeof fetch)!
    await live.authServerMetadata()
    await live.authServerMetadata()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://ref.supabase.co/.well-known/oauth-authorization-server/auth/v1')
  })
})
