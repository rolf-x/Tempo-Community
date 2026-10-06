// /api/github-link: a workspace manager's browser links the GitHub App installations to the workspace, so pushes from them
// reach its apps. An installation id is never taken from the browser or a URL (GitHub warns it can be faked): the server asks
// GitHub which installations the person's own token can see, and sends only those to github_link_installations, which runs
// as the person (their Supabase JWT) and checks they manage the workspace and that each installation's account owns its repos.
import { readSessionToken, sameOrigin, type GitHubProxyEnv } from '../githubProxy.js'
import { dbConfig, rpc, RpcError, type DbEnv } from './db.js'

export type LinkEnv = GitHubProxyEnv & DbEnv & { TEMPO_SERVER_KEY?: string }

export interface LinkDeps {
  fetch?: typeof fetch
}

export interface InstallationLink {
  installationId: number
  login: string
  linkedAt: string
}

const GITHUB_API = 'https://api.github.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_.[\]-]{0,99}$/
const MAX_BODY_BYTES = 4_096
const TIMEOUT_MS = 8_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** The installations (of Tempo's own App) the token's owner can see. Throws only on a network failure; null means GitHub refused the token. */
async function visibleInstallations(token: string, fetchImpl: typeof fetch): Promise<Array<{ id: number; login: string }> | null> {
  const response = await fetchImpl(`${GITHUB_API}/user/installations?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tempo-github-app',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('github')
  const body = await response.json() as { installations?: unknown }
  const list = Array.isArray(body.installations) ? body.installations : []
  const out: Array<{ id: number; login: string }> = []
  for (const item of list.slice(0, 100)) {
    const installation = item as { id?: unknown; account?: { login?: unknown } | null }
    const id = installation?.id
    const login = installation?.account?.login
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && typeof login === 'string' && LOGIN.test(login)) out.push({ id, login })
  }
  return out
}

function asLinks(value: unknown): InstallationLink[] {
  if (!Array.isArray(value)) return []
  const links: InstallationLink[] = []
  for (const item of value) {
    const link = item as { installationId?: unknown; login?: unknown; linkedAt?: unknown }
    if (typeof link?.installationId === 'number' && typeof link.login === 'string' && typeof link.linkedAt === 'string') {
      links.push({ installationId: link.installationId, login: link.login, linkedAt: link.linkedAt })
    }
  }
  return links
}

export async function handleLink(request: Request, env: LinkEnv, deps: LinkDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!env.TEMPO_SERVER_KEY || !env.GITHUB_TOKEN_KEY || !dbConfig(env)) return json({ error: 'not_configured' }, 503)
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403)

  let workspaceId: unknown
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'bad_request' }, 400)
    workspaceId = (JSON.parse(text) as { workspaceId?: unknown } | null)?.workspaceId
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) return json({ error: 'bad_request' }, 400)

  const jwt = BEARER.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!jwt) return json({ error: 'not_signed_in' }, 401)

  const session = readSessionToken(request, env)
  if ('error' in session) return json({ error: session.error }, 401)

  const fetchImpl = deps.fetch ?? fetch
  let installations: Array<{ id: number; login: string }> | null
  try {
    installations = await visibleInstallations(session.token, fetchImpl)
  } catch {
    return json({ error: 'github_unavailable' }, 502)
  }
  if (installations === null) return json({ error: 'token_expired' }, 401)

  try {
    const links = await rpc<unknown>(env, 'github_link_installations', {
      p_key: env.TEMPO_SERVER_KEY,
      p_workspace: workspaceId,
      p_installations: installations,
    }, { jwt, fetch: fetchImpl })
    return json({ links: asLinks(links) })
  } catch (error) {
    const code = error instanceof RpcError ? error.code : ''
    if (code === '42501') return json({ error: 'not_manager' }, 403)
    if (code === '28000') return json({ error: 'not_signed_in' }, 401)
    if (code === '22023') return json({ error: 'bad_request' }, 400)
    console.error(`github-link: failed (${error instanceof RpcError ? `database ${error.code}` : 'unknown'})`)
    return json({ error: 'internal_error' }, error instanceof RpcError && error.status === 502 ? 502 : 500)
  }
}
