// Export/import. Tasks and coding-agent updates from older backups are accepted and ignored.
import { z } from 'zod'
import type { PersistedState } from '../types'
import { appDefaults } from './model'
import { withoutRetiredActivity } from './activityFeed'

// Everything in a backup is checked before it can reach the store: it renders as links, images and text. Repo and commit
// links must be GitHub web addresses, an app's own link http(s), an avatar https; nothing else is accepted.
const githubLink = z.string().regex(/^https:\/\/github\.com\/[^\s/?#]+(?:\/[^\s]*)?$/, 'must be a https://github.com/ link')
const repoLink = z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/, 'must be a https://github.com/owner/repo link')
const webLink = z.string().regex(/^https?:\/\/[^\s]+$/i, 'must be an http or https link')
const httpsLink = z.string().regex(/^https:\/\/[^\s]+$/i, 'must be an https link')

const RepoBackup = z.object({
  fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must look like owner/name'),
  url: repoLink, private: z.boolean(), defaultBranch: z.string(),
})
const SignalsBackup = z.object({
  hasReadme: z.boolean(), secretFiles: z.array(z.string()), lastCommitAt: z.string().nullable(),
  openIssues: z.number(), openPrs: z.number(), syncedAt: z.string(), liveUrl: webLink.nullable().optional(),
})
const EvidenceBackup = z.object({
  readme: z.string().nullable(),
  lastCommit: z.object({ message: z.string(), author: z.string(), at: z.string(), url: githubLink }).nullable(),
  deployFile: z.string().nullable(),
  repoFacts: z.object({ hasReadme: z.boolean(), secretFiles: z.array(z.string()), private: z.boolean(), lastCommitAt: z.string().nullable() }).optional(),
})
const AppCardBackup = z.object({
  what: z.string(), who: z.string(), stage: z.enum(['idea', 'building', 'live', 'stale']), status: z.string(), updatedAt: z.string(),
  source: z.enum(['ai', 'fallback', 'demo']), checkedAt: z.string().nullable().optional(), checkedBy: z.string().nullable().optional(),
  evidence: EvidenceBackup.optional(), editedFields: z.array(z.enum(['what', 'who'])).optional(),
})
const ActivityBackup = z.object({
  id: z.string(), projectId: z.string(), kind: z.enum(['commit', 'pr', 'issue', 'sync']), actor: z.string(), title: z.string(),
  url: githubLink.nullable().default(null), at: z.string(),
})
const ProjectBackup = z.object({
  id: z.string(), name: z.string(), emoji: z.string(),
  color: z.enum(['slate', 'violet', 'blue', 'teal', 'green', 'amber', 'rose']),
  description: z.string(), createdAt: z.string(), archived: z.boolean(),
  ownerId: z.string().nullable().optional(), repo: RepoBackup.nullable().optional(), signals: SignalsBackup.nullable().optional(), appCard: AppCardBackup.nullable().optional(),
  lastActivityAt: z.string().nullable().optional(), autoApply: z.boolean().optional(), keptAt: z.string().nullable().optional(),
  liveUrl: webLink.nullable().optional(), access: z.string().nullable().optional(),
})
const MemberBackup = z.object({
  id: z.string(), name: z.string(), email: z.string().nullable(), avatarUrl: httpsLink.nullable(),
  githubLogin: z.string().nullable(), userId: z.string().nullable(), role: z.enum(['owner', 'member']),
  isAdmin: z.boolean().optional(), active: z.boolean(), leavingOn: z.string().nullable().optional(),
})
const Backup = z.object({
  version: z.number(),
  projects: z.array(ProjectBackup),
  tasks: z.unknown().optional(),
  members: z.array(MemberBackup).optional(),
  activity: z.array(z.unknown()).optional(), // checked below, once old task and coding-agent entries are dropped
  settings: z.record(z.string(), z.unknown()).optional(),
})

export type ImportedData = Pick<PersistedState, 'projects' | 'members' | 'activity'> & { settings?: Record<string, unknown> }

export function exportData(state: PersistedState): string {
  const { apiKey: _omit, ...ai } = state.settings.ai
  // Keys never leave the browser in a backup: not the default one, not the saved ones.
  const aiConnections = state.settings.aiConnections?.map(({ ai: { apiKey: _key, ...rest }, ...item }) => ({ ...item, ai: rest }))
  return JSON.stringify({
    version: 3,
    projects: state.projects,
    members: state.members,
    activity: state.activity,
    settings: { ...state.settings, ai, ...(aiConnections ? { aiConnections } : {}) },
  }, null, 2)
}

/** "projects.2.repo.url: must be a https://github.com/owner/repo link": where the file went wrong, in words a person can find. */
function invalid(error: z.ZodError, where = ''): Error {
  const issue = error.issues[0]
  const path = [where, ...issue.path.map(String)].filter(Boolean).join('.')
  return new Error(`That file isn't a valid Tempo backup${path ? ` (${path}: ${issue.message})` : ''}. Nothing was imported.`)
}

export function parseImport(text: string): ImportedData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const parsed = Backup.safeParse(raw)
  if (!parsed.success) {
    if (!raw || typeof raw !== 'object' || !('projects' in raw)) throw new Error("That file isn't a Tempo backup.")
    throw invalid(parsed.error)
  }
  // Old backups kept task entries and coding-agent updates in the activity feed; they are dropped, not an error.
  const activityRaw = withoutRetiredActivity(parsed.data.activity ?? [])
  const activity = z.array(ActivityBackup).safeParse(activityRaw)
  if (!activity.success) throw invalid(activity.error, 'activity')
  const projects = parsed.data.projects.map((project) => ({ ...appDefaults(), ...project }))
  const members = parsed.data.members ?? []
  return { projects, members, activity: activity.data, settings: parsed.data.settings }
}

export function downloadExport(state: PersistedState) {
  const blob = new Blob([exportData(state)], { type: 'application/json' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `tempo-backup-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0)
}
