import { ExternalLink } from 'lucide-react'
import { githubAppInstallUrl, githubAppMode } from '../lib/githubApp'

export const GITHUB_ORG_APPROVAL_DOCS_URL = 'https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization'
export const githubOrgApprovalUrl = (clientId?: string) => clientId
  ? `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`
  : 'https://github.com/settings/applications'
export const GITHUB_ORG_APPROVAL_URL = githubOrgApprovalUrl(import.meta.env.VITE_GITHUB_CLIENT_ID)

export function GitHubOrgApproval({ className = '' }: { className?: string }) {
  if (githubAppMode()) {
    return (
      <p className={className}>
        Don't see an account or organisation?{' '}
        <a href={githubAppInstallUrl()} className="focus-ring rounded-sm font-medium text-accent underline underline-offset-4">Install Tempo on it</a>. An organisation owner has to approve the install.
      </p>
    )
  }
  return (
    <p className={className}>
      Don't see your organisation? <a href={GITHUB_ORG_APPROVAL_URL} target="_blank" rel="noreferrer" className="focus-ring rounded-sm font-medium text-accent underline underline-offset-4">Check GitHub approval</a>. An organisation owner has to approve Tempo.{' '}
      <a href={GITHUB_ORG_APPROVAL_DOCS_URL} target="_blank" rel="noreferrer" className="focus-ring rounded-sm text-accent underline underline-offset-4">How this works</a>.
    </p>
  )
}

export function GitHubAppInstallActions({ onRefresh, className = '' }: { onRefresh: () => void; className?: string }) {
  if (!githubAppMode()) return null
  return (
    <div className={className}>
      <a href={githubAppInstallUrl()} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-full bg-pill-bg px-4.5 text-[15px] font-medium tracking-[0.2px] text-pill-ink">
        Install Tempo on GitHub <ExternalLink className="size-4" aria-hidden />
      </a>
      <button type="button" onClick={onRefresh} className="focus-ring rounded-sm text-sm font-medium text-accent underline underline-offset-4">Refresh</button>
    </div>
  )
}
