// Updates on every push, the browser side. A workspace is "linked" to the GitHub App installation that owns its repos;
// only then does Tempo's server re-read an app when someone pushes to it (api/github-webhook.ts). A manager's browser
// asks the server to link (api/github-link.ts); the server checks with the person's own GitHub token. Fresh facts come
// back through the normal realtime projects subscription, so nothing here reads GitHub.
import { create } from 'zustand'
import { useSession } from './session'
import { refreshGitHubSession } from './github'

export interface InstallationLink {
  installationId: number
  login: string
  linkedAt: string
}

export type LinkErrorCode =
  | 'not_signed_in' | 'not_connected' | 'token_expired' | 'not_manager' | 'not_configured'
  | 'load_failed' | 'network' | 'other'

export const LINK_ERROR_MESSAGE: Record<LinkErrorCode, string> = {
  not_signed_in: 'Sign in to Tempo first.',
  not_connected: 'Connect GitHub first.',
  token_expired: 'GitHub access expired. Reconnect GitHub.',
  not_manager: 'Only an owner or admin can turn this on.',
  not_configured: 'Not available on this server yet.',
  load_failed: "Couldn't check this right now.",
  network: "Couldn't reach Tempo. Check your connection.",
  other: "Couldn't turn this on. Try again.",
}

export class InstallationLinkError extends Error {
  constructor(readonly code: LinkErrorCode) {
    super(LINK_ERROR_MESSAGE[code])
    this.name = 'InstallationLinkError'
  }
}

const API_ERRORS = new Set<string>(['not_signed_in', 'not_connected', 'token_expired', 'not_manager', 'not_configured'])
const STATUS_ERROR: Record<number, LinkErrorCode> = { 401: 'not_signed_in', 403: 'not_manager', 503: 'not_configured' }

const cloud = () => import('./cloud')

const toLink = (value: unknown): InstallationLink | null => {
  const v = value as Partial<Record<keyof InstallationLink, unknown>> | null
  const id = typeof v?.installationId === 'string' && v.installationId.trim() !== '' ? Number(v.installationId) : v?.installationId
  if (!v || typeof id !== 'number' || !Number.isFinite(id) || typeof v.login !== 'string' || !v.login) return null
  return { installationId: id, login: v.login, linkedAt: typeof v.linkedAt === 'string' ? v.linkedAt : '' }
}

async function postLink(workspaceId: string): Promise<{ links: InstallationLink[] } | { error: LinkErrorCode }> {
  const token = await (await cloud()).accessToken()
  if (!token) return { error: 'not_signed_in' }
  let res: Response
  try {
    res = await fetch('/api/github-link', {
      method: 'POST',
      credentials: 'same-origin', // the GitHub cookie rides along
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId }),
    })
  } catch {
    return { error: 'network' }
  }
  const body = await res.json().catch(() => null) as { links?: unknown; error?: unknown } | null
  if (res.ok) {
    const links = Array.isArray(body?.links) ? body.links.map(toLink).filter((l): l is InstallationLink => l !== null) : []
    return { links }
  }
  const named = typeof body?.error === 'string' && API_ERRORS.has(body.error) ? body.error as LinkErrorCode : null
  return { error: named ?? STATUS_ERROR[res.status] ?? 'other' }
}

/** Ask the server to link this workspace to the GitHub App installations that own its repos. Throws InstallationLinkError. */
export async function linkInstallations(workspaceId: string): Promise<InstallationLink[]> {
  let result = await postLink(workspaceId)
  if ('error' in result && result.error === 'token_expired') {
    await refreshGitHubSession()
    result = await postLink(workspaceId) // once; a second token_expired is the answer
  }
  if ('error' in result) throw new InstallationLinkError(result.error)
  return result.links
}

const MISSING_TABLE = new Set(['42P01', '42703', 'PGRST205', 'PGRST204'])

/** The links Tempo already has for this workspace. Any member may read them. */
export async function listInstallationLinks(workspaceId: string): Promise<InstallationLink[]> {
  const { client } = await cloud()
  const { data, error } = await client()
    .from('workspace_installations')
    .select('installation_id, account_login, linked_at')
    .eq('workspace_id', workspaceId)
  if (error) throw new InstallationLinkError(MISSING_TABLE.has((error as { code?: string }).code ?? '') ? 'not_configured' : 'load_failed')
  return (data ?? [])
    .map((row: { installation_id: unknown; account_login: unknown; linked_at: unknown }) => toLink({ installationId: row.installation_id, login: row.account_login, linkedAt: row.linked_at }))
    .filter((l): l is InstallationLink => l !== null)
}

// ── Per-workspace state ─────────────────────────────────────────────────────────────────────────────────────────
export type LinkStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LinkEntry {
  links: InstallationLink[]
  status: LinkStatus
  error: LinkErrorCode | null
  /** The last link attempt came back with no installation: Tempo's GitHub App isn't installed on the repos' owner. */
  noInstall: boolean
  /** The repo picker added apps: link again once, whatever happened before. */
  recheck: boolean
}

const EMPTY: LinkEntry = { links: [], status: 'idle', error: null, noInstall: false, recheck: false }

export const useInstallationLinksStore = create<{ byWorkspace: Record<string, LinkEntry> }>(() => ({ byWorkspace: {} }))

/** `{ links, status, error }` for one workspace. */
export function useInstallationLinks(workspaceId: string | null | undefined): LinkEntry {
  return useInstallationLinksStore((s) => (workspaceId ? s.byWorkspace[workspaceId] : undefined) ?? EMPTY)
}

export const installationLinks = (workspaceId: string): LinkEntry => useInstallationLinksStore.getState().byWorkspace[workspaceId] ?? EMPTY

const patch = (workspaceId: string, next: Partial<LinkEntry>) =>
  useInstallationLinksStore.setState((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: { ...(s.byWorkspace[workspaceId] ?? EMPTY), ...next } } }))

const errorCode = (e: unknown): LinkErrorCode => e instanceof InstallationLinkError ? e.code : 'other'

const loading = new Map<string, Promise<void>>()
const linking = new Map<string, Promise<void>>()
const attempted = new Set<string>()

/** Read the workspace's links once (again with `force`). Never throws: the result is in the store. */
export function loadInstallationLinks(workspaceId: string, force = false): Promise<void> {
  const running = loading.get(workspaceId)
  if (running) return running
  if (!force && installationLinks(workspaceId).status !== 'idle') return Promise.resolve()
  patch(workspaceId, { status: 'loading', error: null })
  const done = listInstallationLinks(workspaceId).then(
    (links) => patch(workspaceId, { links, status: 'ready', error: null, noInstall: false }),
    (e) => patch(workspaceId, { status: 'error', error: errorCode(e) }),
  ).finally(() => { loading.delete(workspaceId) })
  loading.set(workspaceId, done)
  return done
}

/** Link now (Settings → Turn on, and the automatic attempt). Never throws: links, `noInstall` and the error land in the store. */
export function linkWorkspace(workspaceId: string): Promise<void> {
  const running = linking.get(workspaceId)
  if (running) return running
  attempted.add(workspaceId)
  patch(workspaceId, { status: 'loading', error: null, recheck: false })
  const done = linkInstallations(workspaceId).then(
    (links) => patch(workspaceId, { links, status: 'ready', error: null, noInstall: links.length === 0 }),
    (e) => patch(workspaceId, { status: 'error', error: errorCode(e), noInstall: false }),
  ).finally(() => { linking.delete(workspaceId) })
  linking.set(workspaceId, done)
  return done
}

export function resetInstallationLinks(): void {
  useInstallationLinksStore.setState({ byWorkspace: {} })
  loading.clear()
  linking.clear()
  attempted.clear()
}

// Another person's links must never show after a sign-out.
useSession.subscribe((state, previous) => {
  if (previous.status === 'signed-in' && state.status !== 'signed-in') resetInstallationLinks()
})

// ── The quiet attempt ───────────────────────────────────────────────────────────────────────────────────────────
export interface AutoLinkContext {
  signedIn: boolean
  /** Demo and sample workspaces have no GitHub behind them. */
  demo: boolean
  githubConnected: boolean
  /** canManagePeople(me): an owner or admin. */
  canManage: boolean
  /** At least one app with a real repo. */
  hasRepoApp: boolean
  /** The repo picker is open: wait until it is done adding apps. */
  pickerOpen: boolean
}

/**
 * Once per page load per workspace, for a signed-in owner or admin with GitHub connected, a repo app and no links yet.
 * Also once right after the repo picker adds apps (`requestAutoLink`), even when links exist: the new apps may belong
 * to another installation.
 */
export function autoLinkDue(workspaceId: string, ctx: AutoLinkContext): boolean {
  if (!ctx.signedIn || ctx.demo || !ctx.githubConnected || !ctx.canManage || !ctx.hasRepoApp || ctx.pickerOpen) return false
  const entry = installationLinks(workspaceId)
  if (entry.status === 'idle' || entry.status === 'loading') return false // the links aren't read yet
  if (entry.recheck) return true
  return entry.status === 'ready' && entry.links.length === 0 && !attempted.has(workspaceId)
}

/** Runs the automatic attempt when it is due. Errors stay in the store; only Settings shows them. */
export function autoLinkInstallations(workspaceId: string, ctx: AutoLinkContext): Promise<void> {
  return autoLinkDue(workspaceId, ctx) ? linkWorkspace(workspaceId) : Promise.resolve()
}

/** The repo picker added apps: link again once the picker closes. */
export function requestAutoLink(workspaceId: string | null | undefined): void {
  if (workspaceId) patch(workspaceId, { recheck: true })
}
