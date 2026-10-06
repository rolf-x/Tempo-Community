// Shared by the tests in this folder: a throwaway App key, the env a configured server has, and one fake `fetch` that plays
// GitHub (installation tokens and repo reads) and the database (PostgREST rpc) and records every call.
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { vi } from 'vitest'

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
})
export const publicKeyPem = keys.publicKey
export const privateKeyPem = keys.privateKey

export const SECRET = 'whsec_test_secret'
export const SERVER_KEY = 'server-key-test'
export const CRON_SECRET = 'cron-secret-test'
export const ANON = 'anon-key-test'
export const INSTALLATION_TOKEN = 'ghs_' + 'T'.repeat(36)

/** What a configured deployment has. The private key arrives with literal `\n`, as pasted into Vercel. */
export const ENV = {
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: privateKeyPem.replace(/\n/g, '\\n'),
  GITHUB_WEBHOOK_SECRET: SECRET,
  TEMPO_SERVER_KEY: SERVER_KEY,
  CRON_SECRET,
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: ANON,
}

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  /** Parsed JSON body, if any. */
  body: any
}

export interface Backend {
  fetch: typeof fetch
  calls: Call[]
  /** The database functions called, in order. */
  rpcs: (fn?: string) => Call[]
  /** The GitHub reads (GET), in order. */
  reads: () => Call[]
  tokenRequests: () => Call[]
}

export interface BackendOptions {
  /** Answer for a database function: a value (sent as JSON 200) or a Response. Default: null / true for record_delivery. */
  rpc?: Record<string, (args: any, call: Call) => unknown | Promise<unknown>>
  /** Answer for a GitHub GET: a Response, or undefined to use the default repo fixtures. */
  github?: (path: string, call: Call) => Response | undefined | Promise<Response | undefined>
  /** Answer for the installation-token request. */
  token?: (call: Call) => Response | Promise<Response>
}

export const REPO_ID = 99

export const repoJson = (over: Record<string, unknown> = {}) => ({
  id: REPO_ID, full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: true, default_branch: 'main',
  description: 'A repo', pushed_at: '2026-10-05T12:00:00Z', fork: false, archived: false, is_template: false, size: 5,
  homepage: 'https://web.example', language: 'TypeScript', ...over,
})

function defaultGitHub(path: string): Response {
  if (/^\/repos\/[^/]+\/[^/?]+$/.test(path)) return json(repoJson())
  if (path.includes('/readme')) return new Response('# Web')
  if (path.includes('/commits?')) return json([{ sha: 'abcdef1234', html_url: 'u', commit: { message: 'Ship it', author: { name: 'Maya', date: '2026-10-05T11:00:00Z' } }, author: { login: 'maya' } }])
  if (path.includes('/pulls?')) return json([{ number: 1, title: 'Release', html_url: 'p', user: { login: 'sam' }, created_at: '2026-10-04T00:00:00Z' }])
  if (path.includes('/issues?')) return json([{ number: 2, title: 'Fix', html_url: 'i', labels: [], created_at: '2026-10-04T00:00:00Z' }])
  if (path.includes('/git/trees/')) return json({ tree: [{ type: 'blob', path: '.env' }, { type: 'blob', path: 'README.md' }, { type: 'blob', path: 'CLAUDE.md' }] })
  if (path.includes('/contents/')) return new Response('Memory notes')
  if (path.includes('/statuses?')) return json([{ state: 'success', environment_url: 'https://web.example' }])
  if (path.includes('/deployments?')) return json([{ id: 7 }])
  return json({}, 404)
}

export function backend(options: BackendOptions = {}): Backend {
  const calls: Call[] = []
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => { headers[name] = value })
    const call: Call = { url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    if (url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/rpc/`)) {
      const fn = url.slice(`${ENV.SUPABASE_URL}/rest/v1/rpc/`.length)
      const handler = options.rpc?.[fn]
      const answer = handler ? await handler(call.body, call) : fn === 'github_record_delivery' ? true : fn === 'github_save_facts' ? 1 : null
      return answer instanceof Response ? answer : json(answer)
    }
    if (call.method === 'POST' && /^https:\/\/api\.github\.com\/app\/installations\/\d+\/access_tokens$/.test(url)) {
      return options.token ? options.token(call) : json({ token: INSTALLATION_TOKEN, expires_at: '2026-10-06T13:00:00Z' }, 201)
    }
    if (url.startsWith('https://api.github.com/')) {
      const path = url.slice('https://api.github.com'.length)
      return (await options.github?.(path, call)) ?? defaultGitHub(path)
    }
    throw new Error(`unexpected request to ${url}`)
  })
  return {
    fetch: fake as unknown as typeof fetch,
    calls,
    rpcs: (fn) => calls.filter((call) => call.url.includes('/rest/v1/rpc/') && (!fn || call.url.endsWith(`/${fn}`))),
    reads: () => calls.filter((call) => call.method === 'GET' && call.url.startsWith('https://api.github.com/')),
    tokenRequests: () => calls.filter((call) => call.url.endsWith('/access_tokens')),
  }
}

/** A webhook delivery GitHub would send: the raw body, its X-Hub-Signature-256, event and delivery headers. */
export function delivery(event: string, payload: unknown, over: { delivery?: string | null; secret?: string; signature?: string | null; raw?: string; method?: string; headers?: Record<string, string> } = {}): Request {
  const raw = over.raw ?? JSON.stringify(payload)
  const signature = over.signature === undefined ? `sha256=${createHmac('sha256', over.secret ?? SECRET).update(raw).digest('hex')}` : over.signature
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-GitHub-Event': event, ...over.headers }
  if (over.delivery !== null) headers['X-GitHub-Delivery'] = over.delivery ?? 'delivery-1'
  if (signature !== null) headers['X-Hub-Signature-256'] = signature
  const method = over.method ?? 'POST'
  return new Request('https://tempo.test/api/github-webhook', { method, headers, body: method === 'GET' ? undefined : raw })
}
