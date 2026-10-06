// Re-read one repo and save its facts: file names, dates and counts only (readRepoFactsOnly in src/lib/repoRead.ts, which
// never fetches a file's contents), over an installation token scoped to that repo, then the same signals as Sync
// (src/ai/tools/repoFacts.ts). No AI runs here and nothing but repo facts is written, through github_save_facts.
import { repoFacts } from '../../../src/ai/tools/repoFacts.js'
import { readRepoFactsOnly } from '../../../src/lib/repoRead.js'
import { githubGet, installationToken, optionalRead, type GitHubAppEnv } from './auth.js'
import { saveFacts, type DbEnv } from './db.js'

export type RefreshEnv = GitHubAppEnv & DbEnv & { TEMPO_SERVER_KEY?: string }

export interface RefreshDeps {
  fetch?: typeof fetch
  now?: () => number
}

export interface RefreshTarget {
  installationId: number
  /** owner/name */
  fullName: string
  /** ISO time of the push that triggered this; null for the daily check. */
  activeAt?: string | null
}

export const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** Returns how many apps the save updated. Throws on any failure: the caller decides what that means. */
export async function refreshRepo(env: RefreshEnv, target: RefreshTarget, deps: RefreshDeps = {}): Promise<number> {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  if (!FULL_NAME.test(target.fullName)) throw new Error('Bad repo name.')
  const token = await installationToken(env, target.installationId, target.fullName.split('/')[1], fetchImpl, Math.floor(now() / 1000))
  const raw = await readRepoFactsOnly(githubGet(token, fetchImpl), target.fullName, optionalRead)
  const { signals } = repoFacts(raw, new Date(now()).toISOString())
  const { id, fullName, private: isPrivate, defaultBranch } = raw.meta
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('GitHub returned a repo without an id.')
  return saveFacts({ env, fetch: fetchImpl }, {
    installationId: target.installationId,
    repo: { id, fullName, private: isPrivate, defaultBranch },
    signals,
    activeAt: target.activeAt ?? null,
  })
}
