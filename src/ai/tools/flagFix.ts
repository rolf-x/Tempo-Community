// Deterministic health-flag guidance. These helpers only repeat repo facts and explicit next steps.
import type { AppCard, RepoSignals } from '../../types'
import { formatCalendarDate } from '../../lib/dates'
import type { HealthKind } from './health'

export interface CommitEvidence {
  title: string
  url: string | null
}

export interface ReadmeDraftInput {
  projectName: string
  description: string
  repoFullName: string
  repoUrl: string
  signals: RepoSignals
  appCard?: AppCard | null
  aiConnected?: boolean
}

export const flagFixHeading = (kind: HealthKind): string => ({
  'no-owner': 'Assign an owner',
  'owner-leaving': 'Plan the handover',
  'owner-left': 'Assign a new owner',
  secrets: 'Remove the secret file',
  'public-repo': 'Check repo access',
  stale: 'Still in use?',
  'no-readme': 'Add a README',
  'no-repo': 'Connect a repo',
})[kind]

export function secretFixText(files: string[]): string {
  const count = files.length
  return `${count || 'No'} secret file${count === 1 ? '' : 's'} found. Rotate the key, remove the file. Tempo checks again on the next sync.`
}

/** Only links a commit when its visible title names one of the flagged paths. */
export function secretCommitUrl(files: string[], commits: CommitEvidence[]): string | null {
  const needles = files.flatMap((file) => [file.toLowerCase(), file.split('/').pop()?.toLowerCase() ?? '']).filter(Boolean)
  return commits.find((commit) => commit.url && needles.some((file) => commit.title.toLowerCase().includes(file)))?.url ?? null
}

export function repoFileUrl(repoUrl: string, branch: string, path: string): string | null {
  try {
    const repo = new URL(repoUrl)
    if (repo.hostname !== 'github.com') return null
    const clean = repo.pathname.replace(/^\/+|\/+$/g, '')
    if (!clean || !branch.trim() || !path.trim()) return null
    return `https://github.com/${clean}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
  } catch {
    return null
  }
}

export function githubSettingsUrl(fullName: string): string | null {
  const parts = fullName.split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length !== 2) return null
  return `https://github.com/${parts.map(encodeURIComponent).join('/')}/settings`
}

export const publicRepoFixText = () => 'Make the repo private in GitHub, then run a sync.'

export const staleFixText = () => 'Keep hides this quiet period. Archive removes the app from the active portfolio.'

export function ownerFixText(kind: 'no-owner' | 'owner-left'): string {
  return kind === 'owner-left'
    ? 'Pick a new owner. The handover pack stays available while the app changes hands.'
    : 'Pick the person responsible for this app.'
}

const line = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()
const fact = (value: string) => line(value) || 'Not stated in the repo.'

/** A copyable suggestion. AI text is used only when an existing AI-written app card is present. */
export function readmeDraft(input: ReadmeDraftInput): { markdown: string; source: 'ai' | 'facts' } {
  const card = input.aiConnected && input.appCard?.source === 'ai' ? input.appCard : null
  const source = card ? 'ai' : 'facts'
  const intro = card ? fact(card.what) : fact(input.description)
  const lines = [
    `# ${fact(input.projectName)}`,
    '',
    intro,
    '',
    '## Repo facts',
    '',
    `- Repository: ${input.repoFullName || input.repoUrl}`,
    `- Last commit: ${input.signals.lastCommitAt ? formatCalendarDate(input.signals.lastCommitAt) : 'No commits found.'}`,
    `- Open pull requests: ${input.signals.openPrs}`,
    `- Open issues: ${input.signals.openIssues}`,
  ]
  if (input.signals.liveUrl) lines.push(`- Live URL: ${input.signals.liveUrl}`)
  if (card) {
    lines.push('', "## Who it's for", '', fact(card.who), '', '## Current status', '', fact(card.status))
  } else {
    lines.push('', '## How to run it', '', 'Not stated in the repo.')
  }
  return { markdown: lines.join('\n'), source }
}

export const noRepoFixText = () => 'Connect the GitHub repo so Tempo can check this app.'
