// /api/mcp: OAuth discovery documents, the Origin check, the bearer-token gate, then the MCP SDK's stateless handler.
// One fresh McpServer per request, bound to the caller's own token. Vercel routes the two well-known paths here with
// ?wk=prm / ?wk=as (vercel.json); the dev plugin does the same (server/mcpDev.ts).
import {
  McpServer, buildOAuthProtectedResourceMetadata, createMcpHandler, getOAuthProtectedResourceMetadataUrl, requireBearerAuth,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'
import { clientName } from '../../../src/ai/tools/mcpDrafts.js'
import { tempoSite } from '../../../src/lib/site.js'
import { clientLabel, makeVerifier, sameOrigin, supabaseClaims, supabaseLive } from './auth.js'
import { supabaseData, type TempoData } from './data.js'
import { registerTempo, serverInstructions } from './tools.js'

export interface McpDeps {
  verifier: OAuthTokenVerifier
  dataFor: (token: string) => TempoData
  /** Supabase's RFC 8414 document for this project's OAuth server. */
  authServerMetadata: () => Promise<Record<string, unknown>>
}

export interface McpEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

const METADATA_TTL_MS = 60 * 60 * 1000
const BEARER = /^Bearer [A-Za-z0-9\-._~+/]+=*$/i

export function depsFromEnv(env: McpEnv, fetchImpl: typeof fetch = fetch): McpDeps | null {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !anon) return null
  let cached: { at: number; doc: Record<string, unknown> } | null = null
  return {
    verifier: makeVerifier({ issuer: `${url}/auth/v1`, getClaims: supabaseClaims(url, anon), isLive: supabaseLive(url, anon) }),
    dataFor: (token) => supabaseData(url, anon, token),
    async authServerMetadata() {
      if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.doc
      const response = await fetchImpl(`${url}/.well-known/oauth-authorization-server/auth/v1`)
      if (!response.ok) throw new Error(`authorization server metadata: ${response.status}`)
      cached = { at: Date.now(), doc: await response.json() as Record<string, unknown> }
      return cached.doc
    },
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

const PUBLIC = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Cache-Control': 'public, max-age=300' }

async function discovery(kind: string, request: Request, resource: URL, deps: McpDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PUBLIC })
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, OPTIONS' })
  let as: Record<string, unknown>
  try {
    as = await deps.authServerMetadata()
  } catch {
    return json(503, { error: 'temporarily_unavailable' })
  }
  if (kind === 'as') return json(200, as, PUBLIC)
  if (kind !== 'prm') return json(404, { error: 'not_found' })
  const doc = buildOAuthProtectedResourceMetadata({
    oauthMetadata: as as unknown as Parameters<typeof buildOAuthProtectedResourceMetadata>[0]['oauthMetadata'],
    resourceServerUrl: resource,
    resourceName: 'Tempo',
    serviceDocumentationUrl: new URL('/#/privacy', resource.origin),
  })
  return json(200, doc, PUBLIC)
}

export function createTempoMcp(deps: McpDeps): (request: Request) => Promise<Response> {
  const handler = createMcpHandler((ctx) => {
    const request = ctx.requestInfo
    const token = ctx.authInfo?.token
    // The gate below runs before the handler, so both are always present; refuse loudly if that ever changes.
    if (!request || !token) throw new Error('MCP request without a verified token')
    // Named after this Tempo ("Tempo (staging)" on staging), so an AI app connected to live and staging can tell them apart.
    const site = tempoSite(request.url)
    const server = new McpServer({ name: site.id, title: site.label, version: '1.0.0' }, { instructions: serverInstructions(site, new URL(request.url).origin) })
    registerTempo(server, {
      data: deps.dataFor(token),
      client: clientName(clientLabel(request.headers.get('user-agent'))),
      baseUrl: new URL(request.url).origin,
    })
    return server
  }, { responseMode: 'json', maxRequestBodySize: 256 * 1024 })

  return async (request) => {
    const url = new URL(request.url)
    const resource = new URL('/api/mcp', url.origin)
    const wk = url.searchParams.get('wk')
    if (wk) return discovery(wk, request, resource, deps)
    if (!sameOrigin(request)) return json(403, { error: 'forbidden_origin' })
    const gate = requireBearerAuth({ verifier: deps.verifier, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) })
    // RFC 6750: exactly "Bearer <token>". Anything else ("Bearer a b", tabs) is treated as no token, so the gate answers
    // with its 401 challenge instead of the SDK picking one part of a malformed header.
    const header = request.headers.get('authorization')
    if (header !== null && !BEARER.test(header)) {
      const headers = new Headers(request.headers)
      headers.delete('authorization')
      return await gate(new Request(request, { headers })) as Response
    }
    const auth = await gate(request)
    if (auth instanceof Response) return auth
    return handler.fetch(request, { authInfo: auth })
  }
}
