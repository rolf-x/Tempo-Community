export const githubAppSlug = (): string => import.meta.env.VITE_GITHUB_APP_SLUG?.trim() ?? ''

export const githubAppMode = (): boolean => githubAppSlug() !== ''

export const githubAppInstallUrl = (): string =>
  `https://github.com/apps/${encodeURIComponent(githubAppSlug())}/installations/new`

/** Classic OAuth scopes, with write access to every repo the person can reach. Local development only: production builds never ask for them. */
const DEV_OAUTH_SCOPES = 'repo read:user user:email read:org'

export const GITHUB_APP_MISSING = "GitHub sign-in isn't set up on this site yet. The site owner needs to configure the GitHub App."

export type GitHubSignInPlan = { ok: true; scopes?: string } | { ok: false; error: string }

/**
 * What GitHub sign-in may ask for. With the read-only GitHub App configured, no scopes are requested (GitHub caps the
 * token at the app's permissions). Without it, only a dev build falls back to the broad OAuth scopes; a production
 * build fails closed with an error instead of signing anyone in with write-capable access.
 */
export function githubSignInPlan(): GitHubSignInPlan {
  if (githubAppMode()) return { ok: true }
  if (import.meta.env.PROD) return { ok: false, error: GITHUB_APP_MISSING }
  return { ok: true, scopes: DEV_OAUTH_SCOPES }
}
