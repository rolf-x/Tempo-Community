// Tempo's own GitHub App on the server: a short-lived RS256 JWT signed with the App's private key, an installation token
// scoped to one repo, and GET requests made with that token. Node `crypto` only, no package. Tokens (about 520 characters
// now) are never stored, logged or put in an error message.
import { createPrivateKey, sign } from 'node:crypto'
import type { GitHubGet, OptionalRead } from '../../../src/lib/repoRead.js'

const GITHUB_API = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const USER_AGENT = 'tempo-github-app'
const REQUEST_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3

export interface GitHubAppEnv {
  GITHUB_APP_ID?: string
  GITHUB_APP_PRIVATE_KEY?: string
}

/** Why a GitHub call failed. Carries no token, header or response body. */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'not-found' | 'network' | 'other',
    readonly status?: number,
    /** UTC epoch milliseconds, when a rate-limited request can resume. */
    readonly resetAt?: number,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/** Vercel keeps a multi-line key in one line, with the newlines written as the two characters `\n`. */
function normalizePem(pem: string): string {
  return pem.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\\n/g, '\n').trim()
}

/** The App's JWT: valid for 10 minutes, backdated a minute for clock drift (GitHub's own advice). */
export function appJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), createPrivateKey(normalizePem(privateKeyPem)))
  return `${header}.${payload}.${b64url(signature)}`
}

const apiHeaders = (authorization: string, accept = 'application/vnd.github+json') => ({
  Authorization: authorization,
  Accept: accept,
  'X-GitHub-Api-Version': API_VERSION,
  'User-Agent': USER_AGENT,
})

/**
 * A read-only token for one repo of one installation. The App holds no write permission, so none is asked for here:
 * the token gets what the App has, narrowed to that repository. Valid for an hour; callers use it and drop it.
 */
export async function installationToken(
  env: GitHubAppEnv,
  installationId: number,
  repoName: string,
  fetchImpl: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new GitHubApiError('GitHub App is not configured.', 'other')
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new GitHubApiError('Bad installation id.', 'other')
  let response: Response
  try {
    response = await fetchImpl(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        ...apiHeaders(`Bearer ${appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, nowSeconds)}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repositories: [repoName] }),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new GitHubApiError("Couldn't reach GitHub.", 'network')
  }
  if (response.status !== 201) {
    throw new GitHubApiError(`GitHub would not issue an installation token (${response.status}).`, response.status === 401 ? 'auth' : response.status === 404 ? 'not-found' : 'other', response.status)
  }
  let token: unknown
  try {
    token = ((await response.json()) as { token?: unknown }).token
  } catch {
    throw new GitHubApiError('GitHub sent an installation token Tempo could not read.', 'other', 201)
  }
  if (typeof token !== 'string' || !token) throw new GitHubApiError('GitHub sent no installation token.', 'other', 201)
  return token
}

const REDIRECTS = [301, 302, 303, 307, 308]

/** GitHub answers a renamed repo with a redirect to api.github.com: follow that, and only that, a few times. */
async function request(fetchImpl: typeof fetch, token: string, path: string, accept: string): Promise<Response> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let url = GITHUB_API + path
  for (let hop = 0; ; hop++) {
    let response: Response
    try {
      response = await fetchImpl(url, { headers: apiHeaders(`Bearer ${token}`, accept), redirect: 'manual', signal })
    } catch {
      throw new GitHubApiError("Couldn't reach GitHub.", 'network')
    }
    if (!REDIRECTS.includes(response.status)) return response
    const location = response.headers.get('location')
    let next: URL | null = null
    try {
      next = location ? new URL(location, url) : null
    } catch { /* Treated as a bad redirect below. */ }
    if (!next || next.origin !== GITHUB_API || hop >= MAX_REDIRECTS) throw new GitHubApiError('GitHub sent an unsafe redirect.', 'other', response.status)
    url = next.href
  }
}

/** The shared reads' getter (src/lib/repoRead.ts) over api.github.com with this token. */
export function githubGet(token: string, fetchImpl: typeof fetch = fetch): GitHubGet {
  return async <T>(path: string, opts: { allow404?: boolean; raw?: boolean } = {}): Promise<T | null> => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new GitHubApiError('Bad GitHub path.', 'other')
    const response = await request(fetchImpl, token, path, opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json')
    if (response.status === 404 && opts.allow404) return null
    if (response.status === 401) throw new GitHubApiError('GitHub refused the installation token.', 'auth', 401)
    if (response.status === 403 || response.status === 429) {
      const retry = response.headers.get('retry-after')
      const text = await response.text().catch(() => '')
      if (response.status === 429 || retry !== null || response.headers.get('x-ratelimit-remaining') === '0' || /rate.?limit/i.test(text)) {
        const now = Date.now()
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
        const retryAt = retry === null ? NaN : /^\d+(\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)
        const deadlines = [reset, retryAt].filter((at) => Number.isFinite(at) && at > now)
        throw new GitHubApiError("GitHub's rate limit is used up.", 'rate-limit', response.status, deadlines.length ? Math.max(...deadlines) : now + 60_000)
      }
    }
    if (response.status === 404) throw new GitHubApiError("That repo wasn't found, or the app can't see it.", 'not-found', 404)
    if (!response.ok) throw new GitHubApiError(`GitHub answered ${response.status}.`, 'other', response.status)
    const text = await response.text()
    try {
      return (opts.raw ? text : JSON.parse(text)) as T
    } catch {
      throw new GitHubApiError('GitHub sent an answer Tempo could not read.', 'other', response.status)
    }
  }
}

/** Reads that may fail softly (the file tree, deployments): a rate limit or lost access still stops the whole read. */
export const optionalRead: OptionalRead = (error) => {
  if (error instanceof GitHubApiError && (error.kind === 'rate-limit' || error.kind === 'auth')) throw error
  return null
}
