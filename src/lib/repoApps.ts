// Helpers for creating apps straight from GitHub repos (the repo picker).
import type { Project } from '../types'
import type { RepoListItem, RepoRoot } from '../data/github'

export interface RepoClassification {
  isApp: boolean
  reason: string
}

const DEPLOY_FILES = ['vercel.json', 'netlify.toml', 'Dockerfile', 'fly.toml', 'render.yaml', 'Procfile', 'wrangler.toml', 'railway.json', 'app.yaml']

/** Deterministic evidence only. Exclusions win even when a repo has app-like files. */
export function classifyRepo(repo: Pick<RepoListItem, 'fork' | 'archived' | 'is_template' | 'size' | 'homepage' | 'language'>, root?: RepoRoot): RepoClassification {
  if (repo.fork) return { isApp: false, reason: 'Fork' }
  if (repo.archived) return { isApp: false, reason: 'Archived' }
  if (repo.is_template) return { isApp: false, reason: 'Template' }
  if (repo.size === 0 && !repo.language) return { isApp: false, reason: 'Empty' }
  const deploy = DEPLOY_FILES.find((file) => root?.files.includes(file))
  if (deploy) return { isApp: true, reason: deploy }
  const script = ['start', 'build', 'dev'].find((name) => root?.scripts[name]?.trim())
  if (script) return { isApp: true, reason: `${script} script` }
  try {
    const url = new URL(repo.homepage?.trim() ?? '')
    if (url.protocol === 'https:' || url.protocol === 'http:') return { isApp: true, reason: 'live URL' }
  } catch { /* Empty or invalid homepage is not evidence of a live URL. */ }
  return { isApp: false, reason: 'No deploy file or start script' }
}

/** "acme/expense-bot" → "Expense bot". Names that already use capitals are kept as written. */
export function appNameFromRepo(fullName: string): string {
  const slug = fullName.split('/').pop() ?? fullName
  if (/[A-Z]/.test(slug)) return slug
  const words = slug.replace(/[-_.]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The picked repos that don't have an app yet, each once. */
export function reposToAdd(picked: string[], projects: Pick<Project, 'repo'>[]): string[] {
  const linked = new Set(projects.map((p) => p.repo?.fullName.toLowerCase()).filter(Boolean))
  const out: string[] = []
  for (const r of picked) {
    const k = r.toLowerCase()
    if (!linked.has(k)) {
      linked.add(k)
      out.push(r)
    }
  }
  return out
}
