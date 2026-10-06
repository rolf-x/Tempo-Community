// Data schema. The UI is built against these.
import type { HandoverOut } from './ai/schemas'
import type { HealthKind } from './ai/tools/health'

export type Color = 'slate' | 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'rose'
export type Provider = 'none' | 'local' | 'anthropic' | 'openai-compatible' | 'demo'
export type Preset = 'openai' | 'gemini' | 'openrouter' | 'grok' | 'groq' | 'ollama' | 'custom'
export type Theme = 'system' | 'light' | 'dark'

export type Stage = 'idea' | 'building' | 'live' | 'stale'

/** A person in the workspace. `userId` is null for people who haven't signed in yet (e.g. a repo owner). */
export interface Member {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  githubLogin: string | null
  userId: string | null
  role: 'owner' | 'member'
  /** Admins invite and remove people and edit every app. Only the owner sets it. */
  isAdmin?: boolean
  active: boolean // false = left the workspace (their apps become orphaned)
  /** ISO date for a planned last day. Optional only for saved local workspaces created before this field existed. */
  leavingOn?: string | null
}

export interface RepoRef {
  /** GitHub's repo id. Survives a rename, so a push is matched by it and the name is only a fallback. Set on the next sync. */
  id?: number
  fullName: string // owner/name
  url: string
  private: boolean
  defaultBranch: string
}

/** Facts read from the repo on the last sync. Inputs to the health flags. */
export interface RepoSignals {
  hasReadme: boolean
  secretFiles: string[] // committed .env / key-like paths
  lastCommitAt: string | null
  openIssues: number
  openPrs: number
  syncedAt: string
  /** Where the running app lives: repo homepage or latest production deployment. */
  liveUrl?: string | null
}

export interface AppCardEvidence {
  /** One exact, plain-text line from the README. */
  readme: string | null
  lastCommit: { message: string; author: string; at: string; url: string } | null
  deployFile: string | null
  /** Repo-health inputs when the card was written. Optional on older cards. */
  repoFacts?: {
    hasReadme: boolean
    secretFiles: string[]
    private: boolean
    lastCommitAt: string | null
  }
}

/** What the app is and where it stands. AI-written cards remain drafts until a person checks them. */
export interface AppCard {
  what: string
  who: string
  stage: Stage
  status: string
  updatedAt: string
  source: 'ai' | 'fallback' | 'demo'
  /** `undefined` is a legacy card and therefore already checked; only explicit `null` means unchecked. */
  checkedAt?: string | null
  checkedBy?: string | null
  /** Exact repo facts shown beside an unchecked draft. */
  evidence?: AppCardEvidence
  /** Human-authored fields are kept when an automatic sync lands. */
  editedFields?: Array<'what' | 'who'>
  /** Set when an agent wrote this draft over MCP. Written by the `mcp_submit_card` RPC, never by the browser. */
  draftedBy?: DraftedBy
}

/** Who wrote an MCP draft. `memberId` and `clientId` come from the signed-in token; `client` is the name the client reported. */
export interface DraftedBy {
  client: string
  clientId: string | null
  memberId: string | null
  at: string
}

/** The latest handover pack an agent wrote over MCP (`mcp_submit_handover`). Read-only in the browser. */
export interface StoredHandover {
  doc: HandoverOut
  draftedBy: DraftedBy
  /** An agent's pack is a draft until a person reads it and marks it checked; only a string here means checked. */
  checkedAt?: string | null
  checkedBy?: string | null
}

/**
 * One thing to do about a problem Tempo flags on an app (a health flag), written by an agent over MCP
 * (`mcp_submit_tasks`). It closes on its own: it counts as fixed as soon as its flag is gone, and the next sync saves
 * `fixedAt` so it can't come back. A person can remove one; nobody edits its text in the browser.
 */
export interface AppTask {
  id: string
  /** The health flag this task fixes. */
  problem: HealthKind
  title: string
  detail: string | null
  createdAt: string
  draftedBy: DraftedBy
  /** Set when a sync saw the flag gone. */
  fixedAt: string | null
  /** Set when a person removed it (hidden; Claude won't add the same task again). Undo clears it. */
  removedAt?: string | null
}

export const isUncheckedAICard = (card: AppCard | null | undefined) => card?.source === 'ai' && card.checkedAt === null

export interface Project {
  id: string
  name: string
  emoji: string
  color: Color
  description: string
  createdAt: string
  archived: boolean
  ownerId: string | null
  repo: RepoRef | null
  signals: RepoSignals | null
  appCard: AppCard | null
  lastActivityAt: string | null
  autoApply: boolean
  /** Acknowledges the current quiet period. Synced with the rest of the app. */
  keptAt?: string | null
  /** Link to the running app, set by a person. Overrides the one Tempo finds in the repo. */
  liveUrl?: string | null
  /** How someone gets access, e.g. "Ask #ops for an account". Shown in the directory. */
  access?: string | null
  /** Latest handover pack written by an agent over MCP. */
  handover?: StoredHandover | null
  /** Tasks an agent wrote over MCP for this app's health flags. */
  tasks?: AppTask[]
  /** When an agent last wrote the task list (mcp_submit_tasks). The database keeps a browser's older copy from undoing it. */
  tasksAt?: string
}

export type ActivityKind = 'commit' | 'pr' | 'issue' | 'sync'

export interface Activity {
  id: string
  projectId: string
  kind: ActivityKind
  actor: string // member name or GitHub login
  title: string
  url: string | null
  at: string
}

export interface AISettings {
  provider: Provider
  preset: Preset | null
  baseUrl: string | null
  apiKey: string | null
  model: string | null
}

/** One saved API connection. The default one is also copied into Settings.ai, which every AI call reads. */
export interface SavedAIConnection {
  id: string
  ai: AISettings
  savedAt: string
}

export interface Settings {
  /** The connection Tempo uses for every AI call: the default saved one, or local/demo/none. */
  ai: AISettings
  /** Every saved API connection, the default among them. Missing on copies saved before 5 Oct 2026 (migration v6). */
  aiConnections?: SavedAIConnection[]
  /** Which saved connection is the default; null when Settings.ai is none, local or demo. */
  aiDefaultId?: string | null
  theme: Theme
  teamSize: number
  onboarded: boolean
  /** Exploring the Acme sample. Never mixed into a real workspace. */
  demo: boolean
}

export type WorkspaceKind = 'org' | 'personal'

export interface Workspace {
  id: string
  name: string
  /** Chosen at first sign-in. Missing on copies saved before it existed: read as 'org'. */
  kind?: WorkspaceKind
  /** GitHub organization whose repos belong in this workspace. */
  githubOrg?: string | null
}

export interface PersistedState {
  version: 3
  projects: Project[]
  members: Member[]
  activity: Activity[]
  meId: string | null
  workspace: Workspace | null // null = guest mode (local only)
  settings: Settings
}

export const COLORS: Color[] = ['slate', 'violet', 'blue', 'teal', 'green', 'amber', 'rose']
export const STAGES: Stage[] = ['idea', 'building', 'live', 'stale']
