import { describe, expect, it, vi } from 'vitest'
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server'
import type { TempoData } from './data'
import { createTempoMcp, type McpDeps } from './handler'

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
      return { token, clientId: 'c1', scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 600, extra: { userId: 'u1' } }
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

async function result(response: Response) {
  const raw = await response.text()
  const line = raw.startsWith('{') ? raw : raw.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? raw
  return JSON.parse(line)
}

describe('edge cases - auth gate', () => {
  it('accepts a lower-case scheme (RFC 7235: auth schemes are case-insensitive)', async () => {
    const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { Authorization: 'bearer good', 'mcp-protocol-version': '2025-06-18' }))
    expect(response.status).toBe(200)
  })

  it('Authorization header variants', async () => {
    const authHeaders = [
      'Bearer   good',
      'Bearer good good',
      'Bearer ',
      'Basic good',
      'Bearer\tgood'
    ]
    for (const auth of authHeaders) {
      const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { Authorization: auth, 'mcp-protocol-version': '2025-06-18' }))
      expect(response.status).toBe(401)
    }
  })

  it('Origin variants', async () => {
    const origins = [
      'http://tempo.test',
      'https://tempo.test:8443',
      'null',
      'HTTPS://TEMPO.TEST'
    ]
    for (const origin of origins) {
      const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { Origin: origin, 'mcp-protocol-version': '2025-06-18' }))
      expect(response.status).toBe(403)
    }
  })

  it('discovery paths with POST/PUT', async () => {
    expect((await handle(new Request(`${URL_}?wk=prm`, { method: 'POST' }))).status).toBe(405)
    expect((await handle(new Request(`${URL_}?wk=as`, { method: 'PUT' }))).status).toBe(405)
  })

  it('body larger than 256 KB', async () => {
    const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'ping', params: { data: 'a'.repeat(256 * 1024 + 1) } }))
    expect(response.status).toBeGreaterThanOrEqual(400) // 413 or 400
  })

  // The SDK still serves 2025-era batches statelessly; what matters is that a batch is answered and still needs the token.
  it('JSON-RPC batch arrays are answered behind the same gate', async () => {
    const batch = [{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]
    expect((await handle(rpc(batch, { 'mcp-protocol-version': '2025-06-18' }))).status).toBe(200)
    expect((await handle(rpc(batch, { Authorization: 'Bearer forged', 'mcp-protocol-version': '2025-06-18' }))).status).toBe(401)
  })

  it('unknown methods', async () => {
    const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'unknown' }, { 'mcp-protocol-version': '2025-06-18' }))
    const res = await result(response)
    expect(res.error).toBeDefined()
  })

  it('tools/call for a tool that does not exist', async () => {
    const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nonexistent', arguments: {} } }, { 'mcp-protocol-version': '2025-06-18' }))
    const res = await result(response)
    expect(res.error).toBeDefined()
  })

  // MCP (2025-06-18 on) reports invalid tool arguments as a tool result with isError, not as a JSON-RPC error.
  it('tools/call with arguments that break the zod limits', async () => {
    const response = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_app', arguments: { appId: 'a'.repeat(101) } } }, { 'mcp-protocol-version': '2025-06-18' }))
    const res = await result(response)
    expect(res.result.isError).toBe(true)
    expect(data.getApp).not.toHaveBeenCalled()
  })
})
