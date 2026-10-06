// GitHub REST reads. OAuth tokens normally stay in an encrypted httpOnly cookie and requests use the same-origin proxy;
// a token is used directly only as an in-memory fallback when that proxy is unavailable during sign-in.
import type { RepoRef, WorkspaceKind } from '../types'
import type { RepoRaw } from '../ai/tools/repoFacts'
import { readRepoRaw, readRepoWork, toRef, type ApiRepo, type GitHubGet, type RepoListItem } from '../lib/repoRead'
import { useStore } from '../store/useStore'
import { useSession } from './session'
import { githubAppMode } from '../lib/githubApp'

const API = 'https://api.github.com'
export const PROXY_TOKEN = 'proxy' // Non-secret session marker: authenticate through the httpOnly cookie.
export const GITHUB_CONNECTED_KEY = 'tempo.githubConnected'
const SETUP_REPO_SCOPE_KEY = 'tempo.setupRepoScope'
const REPO_SCOPES_KEY = 'tempo.repoScopes' // { [workspaceId]: RepoScope }
let refreshSessionPromise: Promise<void> | null = null
const responseCache = new Map<string, { etag: string; body: unknown }>()
let cacheGeneration = 0
let cacheToken: string | null = null

export function clearGitHubCache(): void {
  responseCache.clear()
  cacheGeneration++
}

useSession.subscribe((state, previous) => {
  if (state.githubToken !== previous.githubToken) clearGitHubCache()
})

export const githubResetTime = (resetAt: number) => new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
export const githubRateLimitMessage = (resetAt: number) => `GitHub's hourly limit is used up. Try again after ${githubResetTime(resetAt)}.`

export async function waitForGitHubReset(error: GitHubError, maxWait: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.max(0, (error.resetAt ?? Date.now() + 60_000) - Date.now())
  if (delay > maxWait) throw error
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delay)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Swaps the refresh token for a new GitHub token (the server sets the cookie again). Shared, so one refresh runs at a time. */
export function refreshGitHubSession(): Promise<void> {
  if (refreshSessionPromise) return refreshSessionPromise
  const refresh = fetch('/api/github-session', { method: 'PATCH', credentials: 'same-origin' })
    .then(() => undefined, () => undefined)
  const tracked = refresh.finally(() => {
    if (refreshSessionPromise === tracked) refreshSessionPromise = null
  })
  refreshSessionPromise = tracked
  return tracked
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'not-found' | 'network' | 'other',
    /** UTC epoch milliseconds, when a rate-limited request can resume. */
    readonly resetAt?: number,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export type { RepoListItem }

export interface RepoReadOptions {
  signal?: AbortSignal
  /** Shared gate for concurrent readers, including requests for package.json. */
  beforeRequest?: () => Promise<void>
  onRateLimit?: (error: GitHubError) => Promise<void>
}

export interface GitHubAccount {
  kind: 'org' | 'personal'
  login: string
  name: string
  avatarUrl: string
  repoCount: number | null
  approvalRequired: boolean
  installationId?: number
  repositorySelection?: 'all' | 'selected'
}

export type RepoScope = Pick<GitHubAccount, 'kind' | 'login' | 'installationId'>

/** Tie repo scans to the account picked in setup, per workspace, so a reload or a new tab still lists only that
 * account's repos. Without a workspace yet, it holds for this tab. */
export function setSetupRepoScope(account: RepoScope): void {
  const scope = {
    kind: account.kind,
    login: account.login,
    ...(account.installationId === undefined ? {} : { installationId: account.installationId }),
  }
  const ws = useStore.getState().workspace?.id
  try {
    if (ws) localStorage.setItem(REPO_SCOPES_KEY, JSON.stringify({ ...savedScopes(), [ws]: scope }))
    else sessionStorage.setItem(SETUP_REPO_SCOPE_KEY, JSON.stringify(scope))
  } catch { /* The picker falls back to every visible repo when storage is unavailable. */ }
}

function savedScopes(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REPO_SCOPES_KEY) ?? '{}')
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function asScope(value: unknown): RepoScope | null {
  if (!value || typeof value !== 'object') return null
  const scope = value as Partial<RepoScope>
  const installationId = typeof scope.installationId === 'number' && Number.isSafeInteger(scope.installationId) && scope.installationId > 0
    ? scope.installationId
    : undefined
  return (scope.kind === 'org' || scope.kind === 'personal') && typeof scope.login === 'string' && !!scope.login
    ? { kind: scope.kind, login: scope.login, ...(installationId === undefined ? {} : { installationId }) }
    : null
}

export function setupRepoScope(): RepoScope | null {
  const workspace = useStore.getState().workspace
  if (workspace?.githubOrg?.trim()) return { kind: 'org', login: workspace.githubOrg.trim() }
  const saved = workspace ? asScope(savedScopes()[workspace.id]) : null
  if (saved) return saved
  try {
    return asScope(JSON.parse(sessionStorage.getItem(SETUP_REPO_SCOPE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

export function repoListPath(page: number, scope: RepoScope | null): string {
  if (scope?.kind === 'org') return `/orgs/${encodeURIComponent(scope.login)}/repos?per_page=100&type=all&sort=pushed&direction=desc&page=${page}`
  const affiliation = scope?.kind === 'personal' ? 'owner' : 'owner,collaborator,organization_member'
  return `/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=${affiliation}&page=${page}`
}

/** Existing org workspaces can recover a scope when their tracked repos have one unambiguous non-personal owner. */
export function inferWorkspaceRepoScope(repos: Array<RepoRef | null | undefined>, myLogin?: string | null): RepoScope | null {
  const owners = new Map<string, string>()
  for (const repo of repos) {
    const login = repo?.fullName.split('/', 1)[0]?.trim()
    if (!login || login.toLowerCase() === myLogin?.toLowerCase()) continue
    owners.set(login.toLowerCase(), login)
  }
  const [login] = owners.values()
  return owners.size === 1 ? { kind: 'org', login } : null
}

/** An org picker may suggest only that org's repos. With no evidence, suggest nothing rather than guess. */
export function repoCanBePreselected(fullName: string, workspaceKind: WorkspaceKind | undefined, scope: RepoScope | null): boolean {
  if (workspaceKind !== 'org') return true
  const owner = fullName.split('/', 1)[0].toLowerCase()
  if (scope?.kind === 'org') return owner === scope.login.toLowerCase()
  return false
}

interface ApiViewer {
  login: string
  name: string | null
  avatar_url: string
  public_repos: number
  total_private_repos?: number
}

interface ApiOrganization {
  login: string
  avatar_url: string
}

interface ApiOrganizationDetails extends ApiOrganization {
  name: string | null
  public_repos: number
  total_private_repos?: number
}

interface ApiInstallation {
  id: number
  repository_selection: 'all' | 'selected'
  account: {
    login: string
    avatar_url: string
    type: 'Organization' | 'User' | string
  }
}

interface ApiInstallations {
  total_count: number
  installations: ApiInstallation[]
}

async function listInstallations(token: string, opts: RepoReadOptions = {}): Promise<ApiInstallation[]> {
  const installations: ApiInstallation[] = []
  for (let page = 1; ; page++) {
    const result = await gh<ApiInstallations>(token, `/user/installations?per_page=100&page=${page}`, opts)
    const batch = result?.installations ?? []
    installations.push(...batch)
    if (batch.length === 0 || installations.length >= (result?.total_count ?? 0)) return installations
  }
}

/** A per_page=1 response uses the last page number as its total. */
export function repoCountFromLink(link: string | null, visibleItems: number, publicRepos: number): number {
  const last = link?.split(',').find((part) => /rel="last"/.test(part))?.match(/[?&]page=(\d+)[^>]*>/)?.[1]
  return last ? Number(last) : Math.max(visibleItems, publicRepos)
}

async function gh<T>(token: string, path: string, opts: RepoReadOptions & { allow404?: boolean; raw?: boolean; onResponse?: (res: Response) => void } = {}): Promise<T | null> {
  if (cacheToken !== token) {
    clearGitHubCache()
    cacheToken = token
  }
  const generation = cacheGeneration
  const cacheKey = `${opts.raw ? 'raw' : 'json'}:${path}`
  let retriedAfterRefresh = false
  for (;;) {
    await opts.beforeRequest?.()
    opts.signal?.throwIfAborted()
    const cached = !opts.onResponse && generation === cacheGeneration ? responseCache.get(cacheKey) : undefined
    if (cached) {
      responseCache.delete(cacheKey)
      responseCache.set(cacheKey, cached)
    }
    let res: Response
    try {
      const proxy = token === PROXY_TOKEN
      const request = () => fetch(proxy ? `/api/github?path=${encodeURIComponent(path)}` : API + path, {
        signal: opts.signal,
        headers: {
          ...(proxy ? {} : { Authorization: `Bearer ${token}` }),
          ...(cached ? { 'If-None-Match': cached.etag } : {}),
          Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(proxy ? { credentials: 'same-origin' as const } : {}),
      })
      res = await request()
      if (proxy && !retriedAfterRefresh && res.status === 401) {
        const body = await res.clone().json().catch(() => null) as { error?: unknown } | null
        if (body?.error === 'token_expired') {
          await refreshGitHubSession()
          opts.signal?.throwIfAborted()
          retriedAfterRefresh = true
          res = await request()
        }
      }
    } catch {
      opts.signal?.throwIfAborted()
      throw new GitHubError("Couldn't reach GitHub. Check your connection.", 'network')
    }
    if (res.status === 304 && cached && generation === cacheGeneration) return cached.body as T
    if (res.status === 404 && opts.allow404) return null
    if (res.status === 401) {
      clearGitHubCache()
      if (token === PROXY_TOKEN) {
        try { localStorage.removeItem(GITHUB_CONNECTED_KEY) } catch { /* Storage can be unavailable in privacy modes. */ }
        if (useSession.getState().githubToken === PROXY_TOKEN) useSession.setState({ githubToken: null })
      }
      throw new GitHubError('GitHub access expired. Reconnect GitHub.', 'auth', undefined, 401)
    }
    if (res.status === 403 || res.status === 429) {
      const retry = res.headers.get('retry-after')
      const body = await res.text()
      if (res.status === 429 || retry !== null || res.headers.get('x-ratelimit-remaining') === '0' || /rate.?limit/i.test(body)) {
        const now = Date.now()
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
        const retryAt = retry === null ? NaN : /^\d+(\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)
        const deadlines = [reset, retryAt].filter((at) => Number.isFinite(at) && at > now)
        const resetAt = deadlines.length ? Math.max(...deadlines) : now + 60_000
        const error = new GitHubError(githubRateLimitMessage(resetAt), 'rate-limit', resetAt, res.status)
        if (!opts.onRateLimit) throw error
        await opts.onRateLimit(error)
        continue
      }
    }
    if (res.status === 404) throw new GitHubError("That repo wasn't found, or this GitHub account can't see it.", 'not-found', undefined, 404)
    if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}.`, 'other', undefined, res.status)
    opts.onResponse?.(res)
    const text = await res.text()
    const body = opts.raw ? text : JSON.parse(text)
    if (!opts.onResponse && generation === cacheGeneration && res.status === 200) {
      responseCache.delete(cacheKey)
      const etag = res.headers.get('etag')
      if (etag && text.length <= 1_000_000) {
        responseCache.set(cacheKey, { etag, body })
        if (responseCache.size > 300) responseCache.delete(responseCache.keys().next().value!)
      }
    }
    return body as T
  }
}

async function organizationAccount(token: string, org: ApiOrganization): Promise<GitHubAccount> {
  try {
    const details = await gh<ApiOrganizationDetails>(token, `/orgs/${encodeURIComponent(org.login)}`)
    if (typeof details!.total_private_repos === 'number') {
      return {
        kind: 'org', login: org.login, name: details!.name?.trim() || org.login, avatarUrl: details!.avatar_url || org.avatar_url,
        repoCount: details!.public_repos + details!.total_private_repos, approvalRequired: false,
      }
    }
    let link: string | null = null
    const repos = await gh<unknown[]>(token, `/orgs/${encodeURIComponent(org.login)}/repos?type=all&per_page=1`, {
      onResponse: (response) => { link = response.headers.get('link') },
    })
    return {
      kind: 'org', login: org.login, name: details!.name?.trim() || org.login, avatarUrl: details!.avatar_url || org.avatar_url,
      repoCount: repoCountFromLink(link, repos?.length ?? 0, details!.public_repos), approvalRequired: false,
    }
  } catch (error) {
    if (error instanceof GitHubError && error.kind === 'other' && error.status === 403) {
      return { kind: 'org', login: org.login, name: org.login, avatarUrl: org.avatar_url, repoCount: null, approvalRequired: true }
    }
    throw error
  }
}

/** Accounts available for first-run setup: organizations first, then the signed-in person's account. */
export async function listGitHubAccounts(token: string): Promise<GitHubAccount[]> {
  if (githubAppMode()) {
    const installations = await listInstallations(token)
    return installations.map<GitHubAccount>((installation) => ({
      kind: installation.account.type === 'Organization' ? 'org' : 'personal',
      login: installation.account.login,
      name: installation.account.login,
      avatarUrl: installation.account.avatar_url,
      repoCount: null,
      approvalRequired: false,
      installationId: installation.id,
      repositorySelection: installation.repository_selection,
    })).sort((a, b) => Number(a.kind === 'personal') - Number(b.kind === 'personal'))
  }
  const viewerPromise = gh<ApiViewer>(token, '/user')
  const organizationsPromise = (async () => {
    const organizations: ApiOrganization[] = []
    let more = true
    for (let page = 1; more; page++) {
      const batch = await gh<ApiOrganization[]>(token, `/user/orgs?per_page=100&page=${page}`, {
        onResponse: (response) => { more = /rel="next"/.test(response.headers.get('link') ?? '') },
      })
      organizations.push(...(batch ?? []))
    }
    return organizations
  })()
  const [viewer, organizations] = await Promise.all([viewerPromise, organizationsPromise])
  const orgAccounts = await Promise.all(organizations.map((org) => organizationAccount(token, org)))
  const personal: GitHubAccount = {
    kind: 'personal', login: viewer!.login, name: viewer!.name?.trim() || viewer!.login, avatarUrl: viewer!.avatar_url,
    repoCount: viewer!.public_repos + (viewer!.total_private_repos ?? 0), approvalRequired: false,
  }
  return [...orgAccounts, personal]
}

/** Visible repos, scoped to the setup choice when available, newest pushes first. */
export async function listRepos(token: string, opts: RepoReadOptions & { onPage?: (repos: RepoListItem[]) => void; scope?: RepoScope } = {}): Promise<RepoListItem[]> {
  const scope = opts.scope ?? setupRepoScope()
  if (githubAppMode()) {
    const available = await listInstallations(token, opts)
    const matches = scope ? available.filter((installation) => installation.account.login.toLowerCase() === scope.login.toLowerCase()
      && (scope.kind === 'org') === (installation.account.type === 'Organization')) : available
    const preferred = scope?.installationId === undefined ? undefined : matches.find((installation) => installation.id === scope.installationId)
    const installations = scope ? [preferred ?? matches[0]].filter((installation): installation is ApiInstallation => !!installation) : matches
    const repos = new Map<string, RepoListItem>()
    for (const installation of installations) {
      let seen = 0
      for (let page = 1; ; page++) {
        const result = await gh<{ total_count: number; repositories: ApiRepo[] }>(
          token,
          `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,
          opts,
        )
        const batch = result?.repositories ?? []
        seen += batch.length
        for (const repo of batch) repos.set(repo.full_name.toLowerCase(), toRef(repo))
        const sorted = [...repos.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
        opts.onPage?.(sorted)
        if (batch.length === 0 || seen >= (result?.total_count ?? 0)) break
      }
    }
    return [...repos.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
  }
  const repos = new Map<string, RepoListItem>()
  let more = true
  for (let page = 1; more; page++) {
    const batch = await gh<ApiRepo[]>(token, repoListPath(page, scope), {
      ...opts,
      onResponse: (res) => { more = /rel="next"/.test(res.headers.get('link') ?? '') },
    })
    for (const repo of batch ?? []) {
      const owner = repo.full_name.split('/', 1)[0]
      if (scope?.kind !== 'org' || owner.toLowerCase() === scope.login.toLowerCase()) repos.set(repo.full_name.toLowerCase(), toRef(repo))
    }
    opts.onPage?.([...repos.values()])
  }
  return [...repos.values()]
}

export interface RepoRoot {
  files: string[]
  scripts: Record<string, string>
}

/** Root files only. Read package.json as raw content; never fetch a supplied download URL. */
export async function readRepoRoot(token: string, fullName: string, opts: RepoReadOptions = {}): Promise<RepoRoot> {
  const base = `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}/contents/`
  const entries = await gh<{ name: string; type: string }[]>(token, base, opts)
  const files = (entries ?? []).filter((entry) => entry.type === 'file').map((entry) => entry.name)
  const scripts: Record<string, string> = {}
  if (files.includes('package.json')) {
    const raw = await gh<string>(token, `${base}package.json`, { ...opts, raw: true, allow404: true })
    try {
      const parsed: unknown = JSON.parse(raw ?? '')
      const value = parsed && typeof parsed === 'object' && 'scripts' in parsed ? parsed.scripts : null
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, script] of Object.entries(value)) {
          if (typeof script === 'string' && script.trim()) scripts[key] = script
        }
      }
    } catch { /* Invalid package.json supplies no script evidence. */ }
  }
  return { files, scripts }
}

export async function getViewer(token: string): Promise<{ login: string; name: string | null; avatarUrl: string }> {
  const u = await gh<{ login: string; name: string | null; avatar_url: string }>(token, '/user')
  return { login: u!.login, name: u!.name, avatarUrl: u!.avatar_url }
}

function optionalRepoRead(error: unknown, signal?: AbortSignal): null {
  signal?.throwIfAborted()
  if (error instanceof GitHubError && (error.kind === 'rate-limit' || error.kind === 'auth')) throw error
  return null
}

/** The shared reads (src/lib/repoRead.ts) over this browser's GitHub session, with its gate, signal and rate-limit handling. */
const browserGet = (token: string, opts: RepoReadOptions): GitHubGet =>
  <T>(path: string, read = {}) => gh<T>(token, path, { ...opts, ...read })

/** Only the commits and open work used on the app page. */
export function fetchRepoWork(token: string, fullName: string, opts: RepoReadOptions = {}): Promise<Pick<RepoRaw, 'commits' | 'pulls' | 'issues'>> {
  return readRepoWork(browserGet(token, opts), fullName)
}

/** Everything sync_app needs. Missing files are fine (null / skipped). */
export function fetchRepoRaw(token: string, fullName: string, opts: RepoReadOptions = {}): Promise<RepoRaw> {
  return readRepoRaw(browserGet(token, opts), fullName, (error) => optionalRepoRead(error, opts.signal))
}
