import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const COOKIE = '__Host-tempo_gh'
const COOKIE_MAX_AGE = 2_592_000
// The browser drops the cookie after COOKIE_MAX_AGE seconds; the server enforces the same limit from the `iat` sealed inside it.
const SESSION_MAX_AGE_MS = COOKIE_MAX_AGE * 1000
const UPSTREAM_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const GITHUB_API = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const ACCESS_TOKEN_LIFETIME = 8 * 60 * 60 * 1000
const EXPIRY_SKEW = 5 * 60 * 1000

export type GitHubProxyEnv = Record<string, string | undefined>

interface TokenPayload {
  t: string
  r?: string
  exp?: number
  iat: number
}

interface SealOptions {
  refreshToken?: string
  expiresAt?: number
}

const cookieValue = (value: string, maxAge = COOKIE_MAX_AGE) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`

function keyFrom(keyB64: string): Buffer | null {
  try {
    const key = Buffer.from(keyB64, 'base64')
    return key.length === 32 ? key : null
  } catch {
    return null
  }
}

export function sealToken(token: string, keyB64: string, options: SealOptions = {}): string {
  const key = keyFrom(keyB64)
  if (!key) throw new Error('GITHUB_TOKEN_KEY must decode to 32 bytes')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify({
    t: token,
    ...(options.refreshToken ? { r: options.refreshToken } : {}),
    ...(options.expiresAt ? { exp: options.expiresAt } : {}),
    iat: Date.now(),
  }))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function openPayload(value: string, keyB64: string, options: { allowStale?: boolean } = {}): TokenPayload | null {
  const key = keyFrom(keyB64)
  if (!key) return null
  try {
    const sealed = Buffer.from(value, 'base64url')
    if (sealed.length <= 28) return null
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12))
    decipher.setAuthTag(sealed.subarray(12, 28))
    const data: unknown = JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString())
    if (!data || typeof data !== 'object') return null
    const payload = data as { t?: unknown; r?: unknown; exp?: unknown; iat?: unknown }
    if (typeof payload.t !== 'string' || typeof payload.iat !== 'number') return null
    if (payload.r !== undefined && typeof payload.r !== 'string') return null
    if (payload.exp !== undefined && typeof payload.exp !== 'number') return null
    if (!options.allowStale && Date.now() - payload.iat > SESSION_MAX_AGE_MS) return null
    return { t: payload.t, ...(payload.r ? { r: payload.r } : {}), ...(payload.exp ? { exp: payload.exp } : {}), iat: payload.iat }
  } catch {
    return null
  }
}

export function openToken(value: string, keyB64: string, options: { allowStale?: boolean } = {}): string | null {
  return openPayload(value, keyB64, options)?.t ?? null
}

/**
 * Every upstream call gets a deadline and never follows a redirect on its own: a redirect would re-send our request
 * (and its Authorization header) wherever the response points.
 */
function upstreamFetch(url: string, init: RequestInit = {}, signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)): Promise<Response> {
  return fetch(url, { ...init, redirect: 'manual', signal })
}

/** GitHub answers a renamed repo with a 301 to api.github.com: follow that, and only that, a few times. */
async function fetchGitHubApi(path: string, init: RequestInit): Promise<Response> {
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  let url = GITHUB_API + path
  for (let hop = 0; ; hop++) {
    const response = await upstreamFetch(url, init, signal)
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    let next: URL | null = null
    try {
      next = location ? new URL(location, url) : null
    } catch { /* Treated as a bad redirect below. */ }
    if (!next || next.origin !== GITHUB_API || hop >= MAX_REDIRECTS) throw new Error('unsafe redirect')
    url = next.href
  }
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

function readCookie(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE) return value.join('=') || null
  }
  return null
}

export type SessionToken = { token: string } | { error: 'not_connected' | 'token_expired' }

/**
 * The signed-in person's own GitHub token from the sealed cookie, for server code that acts as them (api/_lib/githubApp/link.ts).
 * The same rules as handleGitHub: no cookie, a bad one or one past its 30 days is not_connected, and an access token past its
 * expiry that the refresh flow can renew is token_expired. The token is for one request and is never stored or logged.
 */
export function readSessionToken(request: Request, env: GitHubProxyEnv): SessionToken {
  const key = env.GITHUB_TOKEN_KEY
  const sealed = readCookie(request)
  const payload = key && keyFrom(key) && sealed ? openPayload(sealed, key) : null
  if (!payload) return { error: 'not_connected' }
  const canRefresh = !!payload.r && !!env.GITHUB_APP_CLIENT_ID && !!env.GITHUB_APP_CLIENT_SECRET
  if (payload.exp !== undefined && payload.exp <= Date.now() && canRefresh) return { error: 'token_expired' }
  return { token: payload.t }
}

const repo = '[A-Za-z0-9_.-]+'
const ALLOWED_PATHS = [
  /^\/user$/,
  /^\/user\/orgs$/,
  /^\/user\/repos$/,
  /^\/user\/installations$/,
  /^\/user\/installations\/\d+\/repositories$/,
  new RegExp(`^/orgs/${repo}$`),
  new RegExp(`^/orgs/${repo}/repos$`),
  new RegExp(`^/repos/${repo}/${repo}$`),
  new RegExp(`^/repos/${repo}/${repo}/(?:readme|commits|pulls|issues|deployments)$`),
  new RegExp(`^/repos/${repo}/${repo}/contents/.*$`),
  new RegExp(`^/repos/${repo}/${repo}/git/trees/.+$`),
  new RegExp(`^/repos/${repo}/${repo}/deployments/\\d+/statuses$`),
]

export function isAllowedGitHubPath(value: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return false
  if (decoded.includes('..') || decoded.includes('//') || decoded.includes('://') || /[\\@#\u0000-\u001f\u007f]/.test(decoded)) return false
  if (/(?:^|\/)[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) return false
  const pathname = decoded.split('?', 1)[0]
  return ALLOWED_PATHS.some((allowed) => allowed.test(pathname))
}

export async function handleSession(request: Request, env: GitHubProxyEnv): Promise<Response> {
  if (request.method === 'DELETE') {
    if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403)
    const clearCookie = { 'Set-Cookie': cookieValue('', 0) }
    if (new URL(request.url).searchParams.get('revoke') !== '1') {
      return json({ connected: false }, 200, clearCookie)
    }

    let revoked = false
    const key = env.GITHUB_TOKEN_KEY
    const sealed = readCookie(request)
    const token = key && keyFrom(key) && sealed ? openToken(sealed, key, { allowStale: true }) : null
    if (token && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET) {
      try {
        const response = await upstreamFetch(`${GITHUB_API}/applications/${encodeURIComponent(env.GITHUB_APP_CLIENT_ID)}/grant`, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.GITHUB_APP_CLIENT_ID}:${env.GITHUB_APP_CLIENT_SECRET}`).toString('base64')}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': API_VERSION,
          },
          body: JSON.stringify({ access_token: token }),
        })
        revoked = response.status === 204
      } catch { /* The local session is still disconnected below. */ }
    }
    return json({ connected: false, revoked }, 200, clearCookie)
  }

  const key = env.GITHUB_TOKEN_KEY
  if (!key || !keyFrom(key)) return json({ error: 'not_configured' }, 503)

  if (request.method === 'GET') {
    const sealed = readCookie(request)
    return json({ connected: !!sealed && openToken(sealed, key) !== null })
  }
  if (request.method === 'PATCH') {
    if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403)
    const sealed = readCookie(request)
    if (!sealed) return json({ error: 'not_connected' }, 401)
    const payload = openPayload(sealed, key)
    if (!payload) return json({ error: 'not_connected' }, 401, { 'Set-Cookie': cookieValue('', 0) })
    if (!payload.r || !env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
      return json({ error: 'not_refreshable' }, 400)
    }

    let response: Response
    try {
      response = await upstreamFetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: payload.r,
        }),
      })
    } catch {
      return json({ error: 'refresh_failed' }, 401)
    }
    if (!response.ok) return json({ error: 'refresh_failed' }, 401)
    let refreshed: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    try {
      refreshed = await response.json() as typeof refreshed
    } catch {
      return json({ error: 'refresh_failed' }, 401)
    }
    if (typeof refreshed.access_token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(refreshed.access_token)
      || typeof refreshed.refresh_token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(refreshed.refresh_token)) {
      return json({ error: 'refresh_failed' }, 401)
    }
    const lifetime = typeof refreshed.expires_in === 'number' && Number.isFinite(refreshed.expires_in) && refreshed.expires_in > 0
      ? refreshed.expires_in * 1000
      : ACCESS_TOKEN_LIFETIME
    return json({ connected: true }, 200, {
      'Set-Cookie': cookieValue(sealToken(refreshed.access_token, key, {
        refreshToken: refreshed.refresh_token,
        expiresAt: Date.now() + Math.max(0, lifetime - EXPIRY_SKEW),
      })),
    })
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, PATCH, DELETE' })
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403)
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'invalid_content_type' }, 415)
  }

  let token: unknown
  let refreshToken: unknown
  try {
    const body = await request.json() as { token?: unknown; refreshToken?: unknown }
    token = body.token
    refreshToken = body.refreshToken
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(token)) return json({ error: 'invalid_token' }, 400)
  if (refreshToken !== undefined && (typeof refreshToken !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(refreshToken))) {
    return json({ error: 'invalid_token' }, 400)
  }

  let response: Response
  try {
    response = await upstreamFetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
      },
    })
  } catch {
    return json({ error: 'github_unavailable' }, 502)
  }
  if (response.status !== 200) return json({ error: 'invalid_token' }, 401)
  let user: { login?: unknown }
  try {
    user = await response.json() as { login?: unknown }
  } catch {
    return json({ error: 'github_unavailable' }, 502)
  }
  if (typeof user.login !== 'string') return json({ error: 'invalid_token' }, 401)
  const refreshable = typeof refreshToken === 'string' && !!env.GITHUB_APP_CLIENT_ID && !!env.GITHUB_APP_CLIENT_SECRET
  return json({ connected: true, login: user.login }, 200, {
    'Set-Cookie': cookieValue(sealToken(token, key, refreshable
      ? { refreshToken, expiresAt: Date.now() + ACCESS_TOKEN_LIFETIME - EXPIRY_SKEW }
      : typeof refreshToken === 'string' ? { refreshToken } : {})),
  })
}

const PASSTHROUGH_HEADERS = [
  'content-type', 'link', 'etag', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining',
  'x-ratelimit-reset', 'x-ratelimit-used', 'x-ratelimit-resource',
]

export async function handleGitHub(request: Request, env: GitHubProxyEnv): Promise<Response> {
  const key = env.GITHUB_TOKEN_KEY
  if (!key || !keyFrom(key)) return json({ error: 'not_configured' }, 503)
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' })
  const path = new URL(request.url).searchParams.get('path')
  if (!path || !isAllowedGitHubPath(path)) return json({ error: 'invalid_path' }, 400)

  const sealed = readCookie(request)
  if (!sealed) return json({ error: 'not_connected' }, 401)
  const payload = openPayload(sealed, key)
  if (!payload) return json({ error: 'not_connected' }, 401, { 'Set-Cookie': cookieValue('', 0) })

  const canRefresh = !!payload.r && !!env.GITHUB_APP_CLIENT_ID && !!env.GITHUB_APP_CLIENT_SECRET
  if (payload.exp !== undefined && payload.exp <= Date.now() && canRefresh) {
    return json({ error: 'token_expired' }, 401)
  }

  const requestedAccept = request.headers.get('accept')
  const accept = requestedAccept === 'application/vnd.github.raw+json' ? requestedAccept : 'application/vnd.github+json'
  const etag = request.headers.get('if-none-match')
  const safeEtag = typeof etag === 'string' && etag.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(etag)
  let upstream: Response
  try {
    upstream = await fetchGitHubApi(path, {
      headers: {
        Authorization: `Bearer ${payload.t}`,
        Accept: accept,
        ...(safeEtag ? { 'If-None-Match': etag } : {}),
        'X-GitHub-Api-Version': API_VERSION,
      },
    })
  } catch {
    return json({ error: 'github_unavailable' }, 502)
  }
  if (upstream.status === 401 && canRefresh) return json({ error: 'token_expired' }, 401)
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  return new Response([101, 204, 205, 304].includes(upstream.status) ? null : upstream.body, { status: upstream.status, headers })
}
