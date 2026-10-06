// The GitHub reads behind a Sync, as pure functions of a "GET this GitHub path" function. The browser passes one that
// goes through the same-origin proxy (src/data/github.ts); the push webhook passes one that uses an installation token
// (api/_lib/githubApp). Nothing here touches the store, the window, storage, import.meta.env or a relative /api URL, so
// both sides run the same reads and the same mappings.
import type { RepoRef } from '../types'
import { MEMORY_FILES, type RepoRaw } from '../ai/tools/repoFacts.js'

export interface GitHubGetOptions {
  /** A 404 answers `null` instead of throwing. */
  allow404?: boolean
  /** Ask for the file's own text (`application/vnd.github.raw+json`) instead of JSON. */
  raw?: boolean
}

/** GET one path on api.github.com (leading slash, query included). Throws for anything but a 2xx, except an allowed 404. */
export type GitHubGet = <T>(path: string, opts?: GitHubGetOptions) => Promise<T | null>

/**
 * Called with the error of a read that may fail softly (the file tree, the deployments). It returns null to carry on
 * without that read, or throws to stop the whole read: rate limits, lost access and cancellation should never be swallowed.
 */
export type OptionalRead = (error: unknown) => null

export interface RepoListItem extends RepoRef {
  description: string | null
  pushedAt: string | null
  fork: boolean
  archived: boolean
  is_template: boolean
  size: number
  homepage: string | null
  language: string | null
}

export interface ApiRepo {
  id: number
  full_name: string
  html_url: string
  private: boolean
  default_branch: string
  description: string | null
  pushed_at: string | null
  homepage?: string | null
  fork: boolean
  archived: boolean
  is_template: boolean
  size: number
  language: string | null
}

interface ApiCommit {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; date: string } | null }
  author: { login: string } | null
}
interface ApiPull {
  number: number
  title: string
  html_url: string
  draft?: boolean
  user: { login: string } | null
  created_at: string
}
interface ApiIssue {
  number: number
  title: string
  html_url: string
  labels: (string | { name?: string })[]
  pull_request?: unknown
  created_at: string
}

export const toRef = (r: ApiRepo): RepoListItem => ({
  ...(typeof r.id === 'number' ? { id: r.id } : {}),
  fullName: r.full_name,
  url: r.html_url,
  private: r.private,
  defaultBranch: r.default_branch,
  description: r.description,
  pushedAt: r.pushed_at,
  fork: r.fork ?? false,
  archived: r.archived ?? false,
  is_template: r.is_template ?? false,
  size: r.size ?? 0,
  homepage: r.homepage ?? null,
  language: r.language ?? null,
})

const toCommit = (c: ApiCommit): RepoRaw['commits'][number] => ({
  sha: c.sha, message: c.commit.message, author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
  date: c.commit.author?.date ?? '', url: c.html_url,
})
const toPull = (p: ApiPull): RepoRaw['pulls'][number] => ({
  number: p.number, title: p.title, author: p.user?.login ?? 'unknown', url: p.html_url, draft: !!p.draft, createdAt: p.created_at,
})
const toIssue = (i: ApiIssue): RepoRaw['issues'][number] => ({
  number: i.number, title: i.title, url: i.html_url,
  labels: i.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean), createdAt: i.created_at,
})

/** GitHub answers the commit list of an empty repository with 409. Any error object carrying `status` counts. */
const isEmptyRepo = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409

/** Only the commits and open work used on the app page. `commits`: how many recent commits to read (30 by default). */
export async function readRepoWork(get: GitHubGet, fullName: string, { commits: perPage = 30 }: { commits?: number } = {}): Promise<Pick<RepoRaw, 'commits' | 'pulls' | 'issues'>> {
  const base = `/repos/${fullName}`
  const [commits, pulls, issues] = await Promise.all([
    get<ApiCommit[]>(`${base}/commits?per_page=${perPage}`, { allow404: true }).catch((error) => {
      if (isEmptyRepo(error)) return [] // Empty repo.
      throw error
    }),
    get<ApiPull[]>(`${base}/pulls?state=open&per_page=20`, { allow404: true }),
    get<ApiIssue[]>(`${base}/issues?state=open&per_page=30`, { allow404: true }),
  ])
  return {
    commits: (commits ?? []).map(toCommit),
    pulls: (pulls ?? []).map(toPull),
    issues: (issues ?? []).filter((i) => !i.pull_request).slice(0, 20).map(toIssue),
  }
}

/** Everything sync_app needs. Missing files are fine (null / skipped). */
export async function readRepoRaw(get: GitHubGet, fullName: string, optional: OptionalRead): Promise<RepoRaw> {
  const base = `/repos/${fullName}`
  const meta = await get<ApiRepo>(base)
  if (!meta) throw new Error('GitHub returned no repository.')
  const [readme, work, tree] = await Promise.all([
    get<string>(`${base}/readme`, { allow404: true, raw: true }),
    readRepoWork(get, fullName),
    get<{ tree: { path: string; type: string }[] }>(`${base}/git/trees/${meta.default_branch}?recursive=1`, { allow404: true })
      .catch(optional),
  ])
  const paths = (tree?.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path)
  const present = MEMORY_FILES.filter((f) => paths.includes(f)).slice(0, 4)
  const files = (
    await Promise.all(present.map(async (path) => ({ path, text: (await get<string>(`${base}/contents/${path}`, { allow404: true, raw: true })) ?? '' })))
  ).filter((f) => f.text.trim())

  return {
    meta: { ...toRef(meta), description: meta.description, pushedAt: meta.pushed_at, homepage: meta.homepage ?? null },
    deployUrl: await latestDeployUrl(get, base, optional),
    readme: readme ?? null,
    files,
    paths,
    ...work,
  }
}

/** Where GitHub looks for a README: the repo root, .github/ or docs/, any extension. */
const README_PATH = /^(?:\.github\/|docs\/)?readme(?:\.[A-Za-z0-9]+)?$/i

/**
 * The server's push refresh (api/_lib/githubApp/refresh.ts): only what the facts need, which is file names, dates and
 * counts. It never fetches a file's contents, not even the README or the notes files: whether a README exists comes from
 * the file list. Through repoFacts it gives
 * the same signals as readRepoRaw.
 */
export async function readRepoFactsOnly(get: GitHubGet, fullName: string, optional: OptionalRead): Promise<RepoRaw> {
  const base = `/repos/${fullName}`
  const meta = await get<ApiRepo>(base)
  if (!meta) throw new Error('GitHub returned no repository.')
  const [work, tree] = await Promise.all([
    readRepoWork(get, fullName, { commits: 1 }),
    get<{ tree: { path: string; type: string }[] }>(`${base}/git/trees/${meta.default_branch}?recursive=1`, { allow404: true })
      .catch(optional),
  ])
  const paths = (tree?.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path)
  return {
    meta: { ...toRef(meta), description: meta.description, pushedAt: meta.pushed_at, homepage: meta.homepage ?? null },
    deployUrl: await latestDeployUrl(get, base, optional),
    // Present or not; the text is never read.
    readme: paths.some((path) => README_PATH.test(path)) ? '' : null,
    files: [],
    paths,
    ...work,
  }
}

/** URL of the latest production deployment (Vercel, Netlify and others report deployments to GitHub). */
async function latestDeployUrl(get: GitHubGet, base: string, optional: OptionalRead): Promise<string | null> {
  try {
    const deps = await get<{ id: number }[]>(`${base}/deployments?environment=Production&per_page=1`, { allow404: true })
    const id = deps?.[0]?.id
    if (!id) return null
    const st = await get<{ environment_url?: string; target_url?: string; state: string }[]>(`${base}/deployments/${id}/statuses?per_page=1`, { allow404: true })
    const s = st?.[0]
    return s && s.state === 'success' ? (s.environment_url || s.target_url || null) : null
  } catch (error) {
    return optional(error)
  }
}
