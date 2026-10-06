// Cloud mode (Supabase): sign-in, workspace bootstrap, write-through sync and realtime. Loaded only when
// VITE_SUPABASE_URL is set; guest mode never imports the Supabase client (it's a separate chunk).
import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useStore } from '../store/useStore'
import { rememberAuthReturn, takeAuthReturn, useSession, type AuthProvider, type SessionUser } from './session'
import { diffById } from './diff'
import { DirtySet } from './dirty'
import { oauthErrorFrom } from './oauthError'
import { authReturnHash, shouldWipeOnBoot } from '../lib/entry'
import { isConsentPath, signInRedirectTo, withoutSignInError } from '../lib/oauthConsent'
import { isInviteToken, type InvitePreview, type InviteStatus, type WorkspaceInvite } from '../lib/invites'
import { isSampleRepo } from '../ai/router'
import { withoutRetiredActivity } from '../lib/activityFeed'
import { GITHUB_CONNECTED_KEY, PROXY_TOKEN } from './github'
import { githubSignInPlan, type GitHubSignInPlan } from '../lib/githubApp'
import { GITHUB_POPUP_CHANNEL, registerGitHubPopupConnector, stripGitHubPopupParams, type GitHubPopupMessage, type GitHubPopupResult } from './githubPopup'
import type { Activity, Member, Project, Workspace, WorkspaceKind } from '../types'

const GH_TOKEN_KEY = 'tempo.githubToken'
const WS_KEY = 'tempo.workspaceId'
const INVITE_KEY = 'tempo.pendingInvite'

let sb: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let unsubscribe: (() => void) | null = null
let stopRetry: (() => void) | null = null
let applyingRemote = false
let signingOut = false
let githubConnectAbort: AbortController | null = null
let githubDisconnected = false

const store = () => useStore.getState()
const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

async function connectGitHubToken(token: string, refreshToken?: string): Promise<boolean> {
  if (githubDisconnected) return false
  githubConnectAbort?.abort()
  const controller = new AbortController()
  githubConnectAbort = controller
  try {
    const response = await fetch('/api/github-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...(refreshToken ? { refreshToken } : {}) }),
      signal: controller.signal,
    })
    const result = response.ok ? await response.json() as { connected?: unknown } : null
    if (result?.connected !== true) throw new Error('GitHub session proxy unavailable')
    if (controller.signal.aborted) return false
    safe(() => localStorage.setItem(GITHUB_CONNECTED_KEY, '1'), undefined)
    useSession.setState({ githubToken: PROXY_TOKEN })
    return true
  } catch {
    if (controller.signal.aborted) return false
    // The OAuth token is still usable for this tab, but never persist it where page scripts can recover it later.
    useSession.setState({ githubToken: token })
    return false
  } finally {
    if (githubConnectAbort === controller) githubConnectAbort = null
  }
}

function githubOAuthOptions(scopes?: string) {
  return {
    redirectTo: `${window.location.origin}/?github_popup=1`,
    skipBrowserRedirect: true,
    ...(scopes ? { scopes } : {}),
  }
}

export function connectGitHubInPopup(signal?: AbortSignal): Promise<GitHubPopupResult> {
  if (useSession.getState().status !== 'signed-in') return Promise.resolve({ status: 'failed' })
  const plan = githubSignInPlan()
  if (!plan.ok) {
    useSession.setState({ error: plan.error })
    return Promise.resolve({ status: 'failed' })
  }
  const popup = window.open('about:blank', 'tempo-github', 'popup,width=520,height=720')
  if (!popup) return Promise.resolve({ status: 'blocked' })
  githubDisconnected = false

  return new Promise((resolve) => {
    const channel = new BroadcastChannel(GITHUB_POPUP_CHANNEL)
    let done = false
    const finish = (status: GitHubPopupResult['status']) => {
      if (done) return
      done = true
      window.clearInterval(closedTimer)
      signal?.removeEventListener('abort', cancel)
      channel.close()
      if (status === 'connected') {
        githubDisconnected = false
        safe(() => localStorage.setItem(GITHUB_CONNECTED_KEY, '1'), undefined)
        useSession.setState({ githubToken: PROXY_TOKEN })
      }
      resolve({ status })
    }
    const cancel = () => {
      popup.close()
      finish('cancelled')
    }
    channel.onmessage = (event: MessageEvent<GitHubPopupMessage>) => {
      if (event.data?.type === 'connected') finish('connected')
      else if (event.data?.type === 'failed') finish('failed')
    }
    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish('cancelled')
    }, 250)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      cancel()
      return
    }

    void client().auth.signInWithOAuth({ provider: 'github', options: githubOAuthOptions(plan.scopes) }).then(({ data, error }) => {
      if (done) return
      if (error || !data.url) {
        popup.close()
        finish('failed')
        return
      }
      popup.location.href = data.url
    }).catch(() => {
      popup.close()
      finish('failed')
    })
  })
}

registerGitHubPopupConnector(connectGitHubInPopup)

export async function initGitHubPopup(onStatus?: (state: 'connected' | 'failed', error?: string) => void): Promise<void> {
  githubDisconnected = false
  const channel = new BroadcastChannel(GITHUB_POPUP_CHANNEL)
  let done = false
  let connecting: Promise<boolean> | null = null
  let receiveSession = (_session: Session) => {}
  const providerSession = new Promise<Session>((resolve) => { receiveSession = resolve })
  const finish = (type: GitHubPopupMessage['type'], error?: string) => {
    if (done) return
    done = true
    stripGitHubPopupParams()
    channel.postMessage({ type } satisfies GitHubPopupMessage)
    channel.close()
    onStatus?.(type, error)
    if (type === 'connected') window.close()
  }
  const accept = (session: Session | null): Promise<boolean> => {
    if (done || !session?.provider_token || session.user.app_metadata?.provider !== 'github') return Promise.resolve(false)
    if (connecting) return connecting
    connecting = (async () => {
      const connected = await connectGitHubToken(session.provider_token!, session.provider_refresh_token ?? undefined)
      finish(connected ? 'connected' : 'failed', connected ? undefined : "Tempo couldn't finish connecting GitHub. Close this window and try again.")
      return true
    })()
    return connecting
  }
  const auth = client().auth
  const { data: listener } = auth.onAuthStateChange((_event, session) => {
    if (session?.provider_token && session.user.app_metadata?.provider === 'github') receiveSession(session)
  })
  try {
    const oauthError = oauthErrorFrom(window.location.search)
    const { data, error } = await auth.getSession()
    if (oauthError || error) finish('failed', oauthError ?? error?.message)
    else if (!await accept(data.session)) {
      const session = await Promise.race([
        providerSession,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 10_000)),
      ])
      if (!await accept(session)) finish('failed', "GitHub couldn't connect. Close this window and try again.")
    }
  } catch (error) {
    finish('failed', error instanceof Error ? error.message : "GitHub couldn't connect. Close this window and try again.")
  } finally {
    listener.subscription.unsubscribe()
  }
}

async function confirmGitHubConnection(): Promise<void> {
  try {
    const response = await fetch('/api/github-session', { credentials: 'same-origin' })
    const result = response.ok ? await response.json() as { connected?: unknown } : null
    if (result?.connected === true) return
  } catch { /* Clear the optimistic hint below. */ }
  safe(() => localStorage.removeItem(GITHUB_CONNECTED_KEY), undefined)
  if (useSession.getState().githubToken === PROXY_TOKEN) useSession.setState({ githubToken: null })
}

function deleteGitHubSession(): void {
  githubConnectAbort?.abort()
  githubConnectAbort = null
  void fetch('/api/github-session', {
    method: 'DELETE',
    credentials: 'same-origin',
  }).catch(() => {})
}

function clearGitHubStorage(): void {
  safe(() => localStorage.removeItem(GH_TOKEN_KEY), undefined)
  safe(() => localStorage.removeItem(GITHUB_CONNECTED_KEY), undefined)
}

export async function disconnectGitHub(): Promise<{ revoked: boolean }> {
  githubDisconnected = true
  githubConnectAbort?.abort()
  githubConnectAbort = null
  let revoked = false
  try {
    const response = await fetch('/api/github-session?revoke=1', {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    const result = response.ok ? await response.json() as { revoked?: unknown } : null
    revoked = result?.revoked === true
  } catch { /* Disconnect this browser even if GitHub is unavailable. */ }
  clearGitHubStorage()
  useSession.setState({ githubToken: null })
  return { revoked }
}

// Supabase saves the whole session, GitHub's token included. That token lives in the server cookie, so the saved copy
// leaves it out.
export function withoutProviderToken(value: string): string {
  if (!value.includes('provider_token')) return value
  try {
    const session = JSON.parse(value) as Record<string, unknown>
    delete session.provider_token
    delete session.provider_refresh_token
    return JSON.stringify(session)
  } catch {
    return value
  }
}

const authStorage = {
  getItem: (key: string) => safe(() => localStorage.getItem(key), null),
  setItem: (key: string, value: string) => safe(() => localStorage.setItem(key, withoutProviderToken(value)), undefined),
  removeItem: (key: string) => safe(() => localStorage.removeItem(key), undefined),
}

export function client(): SupabaseClient {
  if (!sb) {
    sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      // PKCE returns ?code= in the query string, so it never collides with the hash router.
      auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true, autoRefreshToken: true, storage: authStorage },
    })
  }
  return sb
}

/** The signed-in person's Supabase access token, for Tempo's own `/api` routes. null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await client().auth.getSession()
  return data.session?.access_token ?? null
}

// ── Rows ⇄ app objects ─────────────────────────────────────────────────────────────────────────────────────────
type DocRow = { id: string; workspace_id: string; data: Record<string, unknown>; updated_at?: string | null }
type MemberRow = { id: string; workspace_id: string; user_id: string | null; name: string; email: string | null; avatar_url: string | null; github_login: string | null; role: 'owner' | 'member'; is_admin?: boolean; active: boolean; leaving_on: string | null }
type WorkspaceRow = { id: string; name: string; kind?: WorkspaceKind; github_org?: string | null }

/** `_base` is the save's own envelope (the revision it was made from); the database strips it, and it never reaches the store. */
const fromDoc = <T>(r: DocRow): T => {
  const data = { ...r.data }
  delete data._base
  return { ...data, id: r.id } as T
}
/** What a project load or upsert gets back: the stored row (which can differ from the one sent) and its server revision. */
const PROJECT_COLUMNS = 'id, workspace_id, data, updated_at'
/** Same JSON content whatever the key order (Postgres jsonb keeps its own); fields that are undefined count as absent. */
const sameJson = (a: unknown, b: unknown): boolean => {
  const canon = (v: unknown) => JSON.stringify(v, (_key, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
    : x))
  return canon(a) === canon(b)
}
/** `base` (projects only): the server `updated_at` of the copy this edit was made from, or null for a project the server never sent. */
const toDoc = (ws: string, x: { id: string }, base?: string | null): DocRow => {
  const { id, ...data } = x as { id: string } & Record<string, unknown>
  return { id, workspace_id: ws, data: base === undefined ? data : { ...data, _base: base } }
}
/**
 * A server timestamp as microseconds: Postgres writes up to six fractional digits, `Date` keeps three, and two writes can
 * land in the same millisecond. NaN when it can't be read.
 */
const stamp = (iso: string): number => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim())
  if (!m) return Date.parse(iso) * 1000
  const digits = (m[3] ?? '').padEnd(6, '0').slice(0, 6)
  const zone = m[4] ?? 'Z'
  const offset = /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : /^[+-]\d{4}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone
  return Date.parse(`${m[1]}T${m[2]}.${digits.slice(0, 3)}${offset}`) * 1000 + Number(digits.slice(3))
}
/** True only when both can be read and `a` is strictly newer than `b`. */
const isLater = (a: string, b: string): boolean => {
  const x = stamp(a)
  const y = stamp(b)
  return Number.isFinite(x) && Number.isFinite(y) && x > y
}
const fromMember = (r: MemberRow): Member => ({
  id: r.id, name: r.name, email: r.email, avatarUrl: r.avatar_url, githubLogin: r.github_login, userId: r.user_id, role: r.role, isAdmin: !!r.is_admin, active: r.active, leavingOn: r.leaving_on ?? null,
})
const fromWorkspace = (r: WorkspaceRow): Workspace => ({ id: r.id, name: r.name, kind: r.kind, githubOrg: r.github_org ?? null })

const GITHUB_ORG_MIGRATION_CODES = new Set(['42883', '42703', 'PGRST202', 'PGRST204'])
export const githubOrgMigrationMissing = (error: { code?: string } | null | undefined): boolean =>
  !!error?.code && GITHUB_ORG_MIGRATION_CODES.has(error.code)

// ── Session ────────────────────────────────────────────────────────────────────────────────────────────────────
function userFrom(s: Session): SessionUser {
  const meta = (s.user.user_metadata ?? {}) as Record<string, string | undefined>
  return {
    id: s.user.id,
    name: meta.full_name || meta.name || meta.user_name || (s.user.email ?? 'You').split('@')[0],
    email: s.user.email ?? null,
    avatarUrl: meta.avatar_url || meta.picture || null,
    githubLogin: s.user.app_metadata?.provider === 'github' ? (meta.user_name ?? null) : null,
    lastSignInAt: s.user.last_sign_in_at ?? null,
  }
}

async function waitForStoreHydration(): Promise<void> {
  if (typeof indexedDB === 'undefined' || store().hydrated || useStore.persist.hasHydrated()) return
  // Watch `hydrated` rather than onFinishHydration: it also flips when IndexedDB fails (private windows), and the cap
  // keeps a broken store from holding sign-in on the loading screen.
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = () => {}
    const done = () => {
      unsubscribe()
      clearTimeout(timer)
      resolve()
    }
    unsubscribe = useStore.subscribe((s) => { if (s.hydrated) done() })
    timer = setTimeout(done, 3000)
    // Hydration may have finished between the first check and installing the listener.
    if (store().hydrated) done()
  })
}

export async function initCloud() {
  githubDisconnected = false
  // Read before client(): supabase-js exchanges ?code= and strips it from the address bar during its own init,
  // so checking later sends a fresh sign-in to the landing page instead of into the app.
  const backFromOAuth = new URLSearchParams(window.location.search).has('code')
  // The AI-client consent page (/oauth/consent?authorization_id=…) keeps its address across sign-in: no hash, no redirect into the app.
  const onConsent = isConsentPath(window.location.pathname)
  const auth = client().auth
  const oldToken = safe(() => localStorage.getItem(GH_TOKEN_KEY), null)
  const githubHint = safe(() => localStorage.getItem(GITHUB_CONNECTED_KEY) === '1', false)
  // Remove legacy secrets before any async work, even if migration cannot reach the proxy.
  safe(() => localStorage.removeItem(GH_TOKEN_KEY), undefined)
  // Capture a direct app deep link before the signed-out gate replaces it with the landing page.
  const requestedHash = window.location.hash
  useSession.setState({
    signIn: async (provider: AuthProvider) => {
      useSession.setState({ error: null })
      const plan: GitHubSignInPlan = provider === 'github' ? githubSignInPlan() : { ok: true }
      if (!plan.ok) {
        useSession.setState({ error: plan.error })
        return
      }
      if (provider === 'github') githubDisconnected = false
      rememberAuthReturn()
      // OAuth comes back to the site root, so remember an invite we were looking at.
      const join = window.location.hash.match(/^#\/join\/([\w-]+)/)
      if (join) rememberInvite(join[1])
      const { error } = await auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: signInRedirectTo(window.location),
          ...(plan.scopes ? { scopes: plan.scopes } : {}),
        },
      })
      if (error) useSession.setState({ error: error.message })
    },
    signOut: async () => {
      signingOut = true
      stopSync()
      deleteGitHubSession()
      try {
        // This browser only. The default ("global") also ends the sessions behind connected AI apps, so signing out
        // of Tempo would cut Claude off while Tempo still listed it as connected (supabase/auth#2801). Revoke in
        // Settings is how a person cuts an AI app off.
        await auth.signOut({ scope: 'local' })
      } finally {
        clearGitHubStorage()
        store().resetAll()
        useSession.setState({ status: 'signed-out', user: null, githubToken: null, needsSetup: false, removedFrom: null })
        signingOut = false
      }
    },
    githubToken: oldToken ?? (githubHint ? PROXY_TOKEN : null),
  })

  // Neither call holds up start-up: the old token or the hint already says GitHub is connected.
  if (oldToken) void connectGitHubToken(oldToken)
  else if (githubHint) void confirmGitHubConnection()

  auth.onAuthStateChange((event, session) => {
    // GitHub's token arrives only right after sign-in: exchange it for the server-held cookie immediately.
    if (!githubDisconnected && session?.provider_token && session.user.app_metadata?.provider === 'github') {
      void connectGitHubToken(session.provider_token, session.provider_refresh_token ?? undefined)
    }
    // Signed out elsewhere (another tab, expired refresh token): stop syncing and drop the workspace copy.
    if (event === 'SIGNED_OUT' && useSession.getState().status !== 'signed-out') {
      stopSync()
      if (!signingOut) rememberAuthReturn()
      if (!signingOut) deleteGitHubSession()
      clearGitHubStorage()
      store().resetAll()
      useSession.setState({ status: 'signed-out', user: null, githubToken: null, needsSetup: false, removedFrom: null })
      if (!signingOut) {
        history.replaceState(null, '', window.location.pathname + window.location.search + '#/login')
        window.dispatchEvent(new Event('hashchange'))
      }
    }
  })

  // A failed OAuth round-trip comes back as ?error=…: say so, then clean the address bar.
  const oauthError = oauthErrorFrom(window.location.search)
  if (oauthError) {
    useSession.setState({ error: oauthError })
    history.replaceState(null, '', window.location.pathname + (onConsent ? withoutSignInError(window.location.search) : '') + window.location.hash)
  }

  const { data } = await auth.getSession()
  // IndexedDB is shared between tabs and hydrates asynchronously. Load it before applying the authoritative cloud
  // workspace so a late hydration cannot put this tab back into setup or overwrite freshly loaded workspace data.
  await waitForStoreHydration()
  const st = store()
  if (shouldWipeOnBoot({ hasSession: !!data.session, demo: st.settings.demo, hasWorkspace: !!st.workspace })) st.resetAll()
  if (!data.session) {
    rememberAuthReturn(requestedHash)
    useSession.setState({ status: 'signed-out' })
    return
  }
  // Stay 'loading' (the app shows the splash) until the workspace is in the store, so deep links aren't
  // redirected before their data exists.
  useSession.setState({ user: userFrom(data.session), removedFrom: null })
  // Drop ?code= from the address bar after the PKCE exchange.
  // A fresh sign-in comes back to the site root: take the user into the app rather than the landing page.
  if (backFromOAuth && !onConsent) {
    const hash = takeAuthReturn() ?? authReturnHash(window.location.hash) ?? '#/portfolio'
    history.replaceState(null, '', window.location.pathname + hash)
    window.dispatchEvent(new Event('hashchange'))
  }
  try {
    await openWorkspace(data.session)
  } catch (e) {
    useSession.setState({ error: e instanceof Error ? e.message : 'Could not load your workspace.' })
  } finally {
    useSession.setState({ status: 'signed-in' })
  }
}

// ── Workspace ──────────────────────────────────────────────────────────────────────────────────────────────────
export function rememberInvite(token: string) {
  if (!isInviteToken(token)) return
  // openWorkspace still supports old auto-accept values. New links carry this marker so OAuth returns to the
  // confirmation screen before any app ownership changes.
  safe(() => sessionStorage.setItem(INVITE_KEY, `confirm:${token}`), undefined)
}

export async function acceptInviteCloud(token: string): Promise<string> {
  if (token.startsWith('confirm:')) {
    const pending = token.slice('confirm:'.length)
    if (isInviteToken(pending)) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/join/${pending}`)
      window.dispatchEvent(new Event('hashchange'))
      return ''
    }
  }
  const { data, error } = await client().rpc('accept_invite', { p_token: token })
  if (error) throw new Error(error.message)
  safe(() => sessionStorage.removeItem(INVITE_KEY), undefined)
  const { data: s } = await client().auth.getSession()
  if (s.session) await openWorkspace(s.session, (data as { workspace_id: string }).workspace_id)
  useSession.setState({ needsSetup: false, removedFrom: null })
  return (data as { name: string }).name
}

async function openWorkspace(session: Session, preferId?: string): Promise<boolean> {
  const db = client()
  const pending = safe(() => sessionStorage.getItem(INVITE_KEY), null)
  if (pending && !preferId) {
    safe(() => sessionStorage.removeItem(INVITE_KEY), undefined) // one attempt only, never a loop on every reload
    try {
      await acceptInviteCloud(pending)
      return !!store().workspace
    } catch (e) {
      useSession.setState({ error: e instanceof Error ? e.message : 'That invite link did not work.' })
      // fall through to the user's own workspace
    }
  }

  const memberships = (columns: string) => db.from('members').select(columns).eq('user_id', session.user.id).eq('active', true)
  let { data: mine, error } = await memberships('workspace_id, workspaces(id, name, kind, github_org)')
  if (error && githubOrgMigrationMissing(error)) ({ data: mine, error } = await memberships('workspace_id, workspaces(id, name, kind)'))
  if (error) throw new Error(error.message)
  type Row = { workspace_id: string; workspaces: WorkspaceRow | null }
  const rows = (mine ?? []) as unknown as Row[]
  // The workspace opened last in this browser wins, so joining a second team doesn't bounce you back on reload.
  const want = preferId ?? safe(() => localStorage.getItem(WS_KEY), null)
  const row = rows.find((r) => r.workspace_id === want)?.workspaces ?? rows[0]?.workspaces ?? null
  const ws = row ? fromWorkspace(row) : null

  if (!ws) {
    // A different tab can replace the persisted store while this tab still has a tab-local setup decision. Do not
    // let an inaccessible or stale persisted workspace override the authoritative membership result at the gate.
    if (store().workspace) store().resetAll()
    const removedFrom = await removedWorkspaceCloud()
    if (removedFrom) {
      useSession.setState({ needsSetup: false, removedFrom })
      return false
    }
    // First sign-in: nothing is created until the person chooses an organization or an individual workspace (#/setup).
    useSession.setState({ needsSetup: true, removedFrom: null })
    return false
  }
  startSync(ws.id, await loadWorkspace(ws, session.user.id))
  return true
}

const OPTIONAL_SCHEMA_CODES = new Set(['42883', '42703', 'PGRST202', 'PGRST204'])

/** The removal explainer is additive; old databases keep the existing first-run setup behaviour. */
export async function removedWorkspaceCloud(): Promise<{ name: string } | null> {
  const { data, error } = await client().rpc('my_removed_workspaces')
  if (error) {
    if (OPTIONAL_SCHEMA_CODES.has(error.code ?? '')) return null
    throw new Error(error.message)
  }
  if (!Array.isArray(data)) return null
  const row = data.find((value) => value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') as { name: string } | undefined
  return row ? { name: row.name } : null
}

/** #/setup: create the person's first workspace, bring along apps this browser already had (never the Acme sample). */
export async function setupWorkspaceCloud(kind: WorkspaceKind, name: string, githubOrg?: string) {
  const db = client()
  const { data: s } = await db.auth.getSession()
  if (!s.session) throw new Error('Sign in first.')
  try {
    if (await openWorkspace(s.session)) return
  } catch {
    throw new Error("Tempo couldn't check whether your workspace already exists.")
  }
  const { data: id, error } = await db.rpc('create_workspace_of_kind', { p_name: name, p_kind: kind, p_member_id: store().meId })
  if (error?.code === '23505') {
    try {
      if (await openWorkspace(s.session)) return
    } catch { /* Use the safe setup error below; never expose database details. */ }
  }
  if (error) throw new Error(error.message.includes('workspaces_one_personal') ? 'You already have a personal workspace.' : "Tempo couldn't create the workspace.")
  const cleanOrg = kind === 'org' ? githubOrg?.trim() : undefined
  let orgSaved = false
  let orgSaveError: unknown = null
  if (cleanOrg) {
    try {
      orgSaved = await setWorkspaceGitHubOrgCloud(cleanOrg, id as string)
    } catch (error) {
      orgSaveError = error
    }
  }
  const ws: Workspace = {
    id: id as string,
    name: name.trim() || (kind === 'org' ? 'My team' : 'My apps'),
    kind,
    githubOrg: orgSaved ? cleanOrg : null,
  }
  let revisions: Map<string, string>
  try {
    if (!store().settings.demo) await uploadLocal(ws.id, s.session.user.id)
    revisions = await loadWorkspace(ws, s.session.user.id)
  } catch {
    throw new Error("Tempo created the workspace but couldn't load it.")
  }
  startSync(ws.id, revisions)
  if (orgSaveError) useSession.setState({ error: "Workspace created, but Tempo couldn't share its GitHub organisation yet. It will keep using this browser for now." })
}

/** Managers may share the GitHub organization. Old databases keep using browser storage without an error. */
export async function setWorkspaceGitHubOrgCloud(githubOrg: string, workspaceId = store().workspace?.id): Promise<boolean> {
  const cleanOrg = githubOrg.trim()
  if (!workspaceId || !cleanOrg) return false
  const { error } = await client().rpc('set_workspace_github_org', { ws: workspaceId, org: cleanOrg })
  if (error) {
    if (githubOrgMigrationMissing(error)) return false
    throw new Error(error.message)
  }
  const workspace = store().workspace
  if (workspace?.id === workspaceId) store().setWorkspace({ ...workspace, githubOrg: cleanOrg })
  return true
}

async function uploadLocal(ws: string, userId: string) {
  const s = store()
  const projects = s.projects.filter((p) => !isSampleRepo(p))
  const used = new Set(projects.map((p) => p.ownerId))
  const people = s.members.filter((m) => m.id !== s.meId && used.has(m.id))
  const db = client()
  if (people.length) await db.from('members').insert(people.map((m) => ({ id: m.id, workspace_id: ws, name: m.name, email: m.email, avatar_url: m.avatarUrl, github_login: m.githubLogin, active: m.active })))
  if (projects.length) await db.from('projects').insert(projects.map((p) => toDoc(ws, p)))
  void userId
}

/** Loads the workspace into the store; returns each project's server revision (`updated_at`) for startSync to save against. */
async function loadWorkspace(ws: Workspace, userId: string): Promise<Map<string, string>> {
  const db = client()
  const [p, a, m] = await Promise.all([
    db.from('projects').select(PROJECT_COLUMNS).eq('workspace_id', ws.id),
    db.from('activity').select('id, workspace_id, data').eq('workspace_id', ws.id).order('at', { ascending: false }).limit(300),
    db.from('members').select('*').eq('workspace_id', ws.id),
  ])
  const err = p.error ?? a.error ?? m.error
  if (err) throw new Error(err.message)
  const members = (m.data as MemberRow[]).map(fromMember)
  const revisions = new Map<string, string>()
  for (const row of p.data as DocRow[]) if (typeof row.updated_at === 'string') revisions.set(row.id, row.updated_at)
  applyingRemote = true
  try {
    store().replaceData({
      projects: (p.data as DocRow[]).map(fromDoc<Project>),
      activity: withoutRetiredActivity((a.data as DocRow[]).map(fromDoc<Activity>)),
      members,
    })
    useStore.setState({ meId: members.find((x) => x.userId === userId)?.id ?? null })
    store().setWorkspace(ws)
    safe(() => localStorage.setItem(WS_KEY, ws.id), undefined)
    useSession.setState({ needsSetup: false, removedFrom: null })
    store().setSettings({ onboarded: true, demo: false })
  } finally {
    applyingRemote = false
  }
  return revisions
}

// ── Sync ───────────────────────────────────────────────────────────────────────────────────────────────────────
type Key = 'projects' | 'members' | 'activity'
const KEYS: Key[] = ['projects', 'members', 'activity']
type Snap = Record<Key, { id: string }[]>
const snap = (s: Snap): Snap => ({ projects: s.projects, members: s.members, activity: s.activity })
const SAVE_FAILED = "Some changes didn't save"
const RETRY_MS = [2000, 5000, 15000, 30000]
type SaveError = { message: string; code?: string }
/** Postgres refused the row itself (access rules, constraints, bad data): sending it again won't help. */
const refused = (e: SaveError) => /^(22|23|42)/.test(e.code ?? '')

/** Postgres row-level security said no: the signed-in person may not change this row. */
const notAllowed = (e: SaveError) => e.code === '42501' || /row-level security/i.test(e.message)
const NOT_ALLOWED = "only the app's owner or an admin can change this, so it was put back"

/** Undo a refused change on screen: rows go back to the server copy in `prev` (dropped if the server never had them). */
export function restoreRows(list: { id: string }[], prev: { id: string }[], ids: string[]): { id: string }[] {
  const failed = new Set(ids)
  const back = new Map(prev.filter((x) => failed.has(x.id)).map((x) => [x.id, x]))
  const kept = list.filter((x) => !failed.has(x.id) || back.has(x.id)).map((x) => back.get(x.id) ?? x)
  const have = new Set(kept.map((x) => x.id))
  return [...kept, ...[...back.values()].filter((x) => !have.has(x.id))]
}

/** Put failed ids back to what the server last had, so the next diff sends them again (an upsert, or a delete). */
export function requeue(current: { id: string }[], prev: { id: string }[], ids: string[]): { id: string }[] {
  const failed = new Set(ids)
  return [...current.filter((x) => !failed.has(x.id)), ...prev.filter((x) => failed.has(x.id))]
}

/**
 * Exported for tests; sign-in and workspace setup start it. `loaded` is each project's server revision from the workspace
 * load that just filled the store.
 */
export function startSync(ws: string, loaded: ReadonlyMap<string, string> = new Map()) {
  stopSync()
  const db = client()
  const dirty = new DirtySet()
  // `synced` = what the server is known to have. Local diffs are computed against it; remote rows patch it per row.
  let synced = snap(store())
  let timer: ReturnType<typeof setTimeout> | undefined
  // Per project: the server `updated_at`, as sent, of the copy this browser last took into the store (from the load, a
  // realtime row or a save's stored row). Every save of a project carries it as `_base`, so the database can tell what
  // Claude wrote since and keep it. It is not part of the Project, and a copy that was only received (dropped below
  // because of a pending edit) does not move it: the edit wasn't made on that copy.
  const revisions = new Map<string, string>(loaded)
  // The newest realtime project row that arrived while its project was being saved, and was dropped for that. Once the
  // save is acknowledged it may turn out to be newer than the row the save returned (Claude committed after the upsert,
  // and its event beat the response), and then it is applied then.
  const dropped = new Map<string, { row: Project; rev: string }>()

  // Only some member columns are updatable (RLS), so: update; if no row matched, insert a placeholder person.
  const saveMember = async (mem: Member): Promise<{ error: SaveError | null }> => {
    const cols = { name: mem.name, email: mem.email, avatar_url: mem.avatarUrl, github_login: mem.githubLogin, active: mem.active, leaving_on: mem.leavingOn ?? null }
    const up = await db.from('members').update(cols).eq('id', mem.id).select('id')
    if (up.error || (up.data && up.data.length)) return { error: up.error }
    return await db.from('members').insert({ id: mem.id, workspace_id: ws, ...cols })
  }

  // A failed save goes back in the queue: retried with backoff, and as soon as the browser is back online.
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let live = true
  const onOnline = () => void flush()
  window.addEventListener?.('online', onOnline)
  stopRetry = () => {
    live = false
    useSession.setState({ pendingSave: false })
    clearTimeout(retry)
    retry = undefined
    window.removeEventListener?.('online', onOnline)
    dropped.clear()
    revisions.clear()
  }

  const flush = async () => {
    const prev = synced
    const now = snap(store())
    const changes = Object.fromEntries(KEYS.map((k) => [k, diffById(synced[k], now[k])])) as Record<Key, ReturnType<typeof diffById>>
    synced = now
    const ops: { table: Key; ids: string[]; deleted?: boolean; sent: Map<string, number>; run: PromiseLike<{ error: SaveError | null; data?: unknown }> }[] = []
    for (const table of ['projects', 'activity'] as const) {
      const c = changes[table]
      if (c.upserts.length) {
        const ids = c.upserts.map((x) => x.id)
        // A project goes out with the revision it was last received at (null: a new project), so the database can keep what
        // Claude wrote since.
        const save = db.from(table).upsert(c.upserts.map((x) => toDoc(ws, x, table === 'projects' ? revisions.get(x.id) ?? null : undefined)))
        // Projects come back as stored: a database trigger keeps agent-written fields (appCard, tasks, handover) that are
        // newer on the server than this browser's copy, so the stored row can differ from the one sent.
        ops.push({ table, ids, sent: dirty.snapshot(table, ids), run: table === 'projects' ? save.select(PROJECT_COLUMNS) : save })
      }
      if (c.deletes.length && table !== 'activity') ops.push({ table, ids: c.deletes, deleted: true, sent: dirty.snapshot(table, c.deletes), run: db.from(table).delete().in('id', c.deletes) })
    }
    for (const mem of changes.members.upserts as Member[]) ops.push({ table: 'members', ids: [mem.id], sent: dirty.snapshot('members', [mem.id]), run: saveMember(mem) })
    const results = await Promise.all(ops.map((o) => Promise.resolve(o.run).catch((e: unknown) => ({ error: { message: e instanceof Error ? e.message : String(e) }, data: undefined }))))
    results.forEach((r, i) => {
      const { table, ids, sent, deleted } = ops[i]
      if (!r.error) {
        dirty.ack(sent)
        if (table === 'projects' && deleted) ids.forEach((id) => { revisions.delete(id); dropped.delete(id) })
        else if (table === 'projects') adoptStored(r.data, now.projects)
      } else if (!refused(r.error)) synced = { ...synced, [table]: requeue(synced[table], prev[table], ids) }
      else if (notAllowed(r.error)) {
        // Refused by the access rules: put the server copy back on screen instead of leaving an edit that never saved.
        dirty.ack(sent)
        synced = { ...synced, [table]: restoreRows(synced[table], prev[table], ids) }
        applyingRemote = true
        try {
          useStore.setState((s) => ({ [table]: restoreRows(s[table] as { id: string }[], prev[table], ids) }) as never)
        } finally {
          applyingRemote = false
        }
        // What arrived while it was being saved is the server's newest copy: the one put back on screen is older.
        if (table === 'projects') ids.forEach((id) => applyDropped(id, revisions.get(id)))
      }
    })
    const failed = results.find((r) => r.error)
    const retrying = results.some((r) => r.error && !refused(r.error))
    if (failed) {
      const e = failed.error!
      const message = /failed to fetch|networkerror|load failed/i.test(e.message) ? 'you seem to be offline' : notAllowed(e) ? NOT_ALLOWED : e.message
      useSession.setState({ error: `${SAVE_FAILED}: ${message}`, pendingSave: retrying })
    }
    clearTimeout(retry)
    retry = undefined
    if (retrying) {
      if (live) retry = setTimeout(() => void flush(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)])
    } else if (attempt) {
      attempt = 0
      const stale = !failed && useSession.getState().error?.startsWith(SAVE_FAILED)
      useSession.setState({ pendingSave: false, ...(stale ? { error: null } : {}) })
    }
  }

  // Takes the stored copy of a saved project when it differs from the local one, like a realtime update would, and notes
  // its revision. A project edited again since the save is dirty: that newer local edit goes out next and wins.
  const adoptStored = (data: unknown, sentRows: { id: string }[]) => {
    if (!live || !Array.isArray(data)) return
    for (const row of data as DocRow[]) {
      if (!row || typeof row.id !== 'string' || !row.data) continue
      const rev = typeof row.updated_at === 'string' ? row.updated_at : null
      const stored = fromDoc<Project>(row)
      if (dirty.has('projects', row.id)) {
        // Not taken, so the next save is still made on the copy before it, unless the database kept nothing of Claude's
        // and stored exactly what was sent: then this revision is the copy the edit was made on.
        const was = sentRows.find((x) => x.id === row.id)
        if (rev && was && sameJson(was, stored)) revisions.set(row.id, rev)
        continue
      }
      const local = store().projects.find((p) => p.id === row.id)
      if (!local) continue
      if (!sameJson(local, stored)) remote('projects', stored, null, rev)
      else if (rev) revisions.set(row.id, rev)
      applyDropped(row.id, rev)
    }
  }

  // After a save of `id` is acknowledged: the newest realtime row dropped meanwhile, applied if it is newer than the row
  // the save returned (`against`). Held on if the project was edited again; that save's answer settles it.
  const applyDropped = (id: string, against: string | null | undefined) => {
    const held = dropped.get(id)
    if (!live || !held || dirty.has('projects', id)) return
    dropped.delete(id)
    if (!against || !isLater(held.rev, against)) return
    const local = store().projects.find((p) => p.id === id)
    if (local && sameJson(local, held.row)) revisions.set(id, held.rev)
    else remote('projects', held.row, null, held.rev)
  }

  unsubscribe = useStore.subscribe((s, before) => {
    if (applyingRemote) return
    let changed = false
    for (const k of KEYS) {
      if (s[k] === before[k]) continue
      const d = diffById(before[k] as { id: string }[], s[k] as { id: string }[])
      dirty.touch(k, [...d.upserts.map((x) => x.id), ...d.deletes])
      changed = true
    }
    if (!changed) return
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), 400)
  })

  const remote = (key: Key, row: { id: string } | null, deletedId: string | null, rev: string | null = null) => {
    const id = row?.id ?? deletedId!
    if (dirty.has(key, id)) {
      // A newer local edit is pending: the server copy is an echo of an older save, or Claude's write that the save in
      // flight may not have seen. Keep the newest one until the save is acknowledged.
      if (key === 'projects' && row && rev && !(dropped.has(id) && !isLater(rev, dropped.get(id)!.rev))) dropped.set(id, { row: row as Project, rev })
      return
    }
    if (key === 'projects') {
      if (!row) revisions.delete(id)
      else if (rev) revisions.set(id, rev)
    }
    const patch = (list: { id: string }[]) => {
      const without = list.filter((x) => x.id !== id)
      return row ? (key === 'activity' ? [row, ...without] : [...without, row]) : without
    }
    synced = { ...synced, [key]: patch(synced[key]) }
    applyingRemote = true
    try {
      useStore.setState((s) => ({ [key]: patch(s[key] as { id: string }[]) }) as never)
    } finally {
      applyingRemote = false
    }
  }

  channel = db.channel(`ws:${ws}`)
  for (const table of KEYS) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${ws}` }, (payload) => {
      const row = payload.new as DocRow & MemberRow
      if (payload.eventType === 'DELETE') return remote(table, null, (payload.old as { id: string }).id)
      const next = table === 'members' ? fromMember(row) : fromDoc<{ id: string; kind?: unknown }>(row)
      if (table === 'activity' && !withoutRetiredActivity([next]).length) return
      remote(table, next, null, table === 'projects' ? row.updated_at ?? null : null)
    })
  }
  channel.subscribe()
}

export function stopSync() {
  stopRetry?.()
  stopRetry = null
  unsubscribe?.()
  unsubscribe = null
  if (channel) void client().removeChannel(channel)
  channel = null
}

// ── Workspace actions used by src/data/workspace.ts ─────────────────────────────────────────────────────────────
/** Older deployments may not have invite_status yet; leave sign-in available if preflight fails. */
export async function peekInvite(token: string): Promise<InviteStatus | null> {
  if (!isInviteToken(token)) return 'missing'
  try {
    const { data, error } = await client().rpc('invite_status', { p_token: token })
    if (error) return null
    return data === 'ok' || data === 'expired' || data === 'used' || data === 'missing' ? data : null
  } catch {
    return null
  }
}

type PreviewRow = {
  status?: unknown
  inviter_name?: unknown
  workspace_name?: unknown
  apps?: unknown
}

const inviteApp = (value: unknown) => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  return { id: row.id, name: row.name, repo: typeof row.repo === 'string' ? row.repo : null }
}

export async function previewInviteCloud(token: string): Promise<InvitePreview> {
  if (!isInviteToken(token)) return { status: 'missing', inviterName: null, workspaceName: null, apps: [] }
  const { data, error } = await client().rpc('invite_preview', { p_token: token })
  if (error) throw new Error(error.message)
  const row = (data ?? {}) as PreviewRow
  const status = row.status
  if (status !== 'ok' && status !== 'expired' && status !== 'used' && status !== 'missing' && status !== 'removed') {
    throw new Error('Tempo could not read this invite. Check the link and try again.')
  }
  return {
    status,
    inviterName: typeof row.inviter_name === 'string' ? row.inviter_name : null,
    workspaceName: typeof row.workspace_name === 'string' ? row.workspace_name : null,
    apps: Array.isArray(row.apps) ? row.apps.map(inviteApp).filter((app): app is NonNullable<typeof app> => app !== null) : [],
  }
}

export async function createInviteCloud(email: string | null, appIds: string[] = []): Promise<{ url: string; expiresAt: string }> {
  const ws = store().workspace
  if (!ws) throw new Error('No workspace.')
  const scopedApps = [...new Set(appIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
  const { data, error } = await client().from('invites').insert({ workspace_id: ws.id, email: email?.trim() || null, app_ids: scopedApps }).select('token, expires_at').single()
  if (error) throw new Error(error.message)
  return { url: `${window.location.origin}/#/join/${data.token}`, expiresAt: data.expires_at }
}

/** Invites are keyed by their token (the table has no id column). The access rules let only the owner or an admin delete. */
export async function revokeInviteCloud(token: string): Promise<void> {
  const ws = store().workspace
  if (!ws) throw new Error('No workspace.')
  const { data, error } = await client().from('invites').delete().eq('workspace_id', ws.id).eq('token', token).select('token')
  if (error) throw new Error(error.message)
  // A delete the access rules refuse matches no row instead of failing: say so rather than report a revoke that didn't happen.
  if (!data?.length) throw new Error('Tempo couldn’t revoke that invite. Only the owner or an admin can, and it may already be gone.')
}

export async function acceptInviteAppsCloud(token: string, confirmed: string[], note: string | null = null): Promise<string> {
  const appIds = [...new Set(confirmed)]
  const { data, error } = await client().rpc('accept_invite_apps', {
    p_token: token,
    p_confirmed: appIds,
    p_note: note?.trim() || null,
  })
  if (error) throw new Error(error.message)
  safe(() => sessionStorage.removeItem(INVITE_KEY), undefined)
  const result = data as { workspace_id: string; name: string }
  const { data: auth } = await client().auth.getSession()
  if (auth.session) await openWorkspace(auth.session, result.workspace_id)
  useSession.setState({ needsSetup: false, removedFrom: null })
  return result.name
}

type InviteRow = {
  id?: unknown
  token?: unknown
  email?: unknown
  created_at?: unknown
  expires_at?: unknown
  used_at?: unknown
  declined_at?: unknown
  decline_note?: unknown
  app_ids?: unknown
  apps?: unknown
  inviter_name?: unknown
  invitee_name?: unknown
  joined_member_name?: unknown
}

export async function listInvitesCloud(): Promise<WorkspaceInvite[]> {
  const ws = store().workspace
  if (!ws) throw new Error('No workspace.')
  const { data, error } = await client().rpc('list_invites', { p_workspace: ws.id })
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) return []

  return data.flatMap((value) => {
    const row = (value ?? {}) as InviteRow
    if (typeof row.token !== 'string' || typeof row.created_at !== 'string' || typeof row.expires_at !== 'string') return []
    return [{
      id: typeof row.id === 'string' ? row.id : row.token,
      token: row.token,
      email: typeof row.email === 'string' ? row.email : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: typeof row.used_at === 'string' ? row.used_at : null,
      declinedAt: typeof row.declined_at === 'string' ? row.declined_at : null,
      declineNote: typeof row.decline_note === 'string' ? row.decline_note : null,
      appIds: Array.isArray(row.app_ids) ? row.app_ids.filter((id): id is string => typeof id === 'string') : [],
      apps: Array.isArray(row.apps) ? row.apps.map(inviteApp).filter((app): app is NonNullable<typeof app> => app !== null) : [],
      inviterName: typeof row.inviter_name === 'string' ? row.inviter_name : 'A teammate',
      inviteeName: typeof row.invitee_name === 'string' ? row.invitee_name : null,
      joinedMemberName: typeof row.joined_member_name === 'string' ? row.joined_member_name : null,
      url: `${window.location.origin}/#/join/${row.token}`,
    } satisfies WorkspaceInvite]
  })
}

export async function renameWorkspaceCloud(name: string) {
  const ws = store().workspace
  if (!ws) return
  const { data, error } = await client().from('workspaces').update({ name }).eq('id', ws.id).select('id')
  if (error) throw new Error(error.message)
  // The access rules match no row (rather than erroring) when the signed-in person may not rename it.
  if (!data?.length) throw new Error('Only the workspace owner can rename it.')
  store().setWorkspace({ ...ws, name })
}

export async function upgradeToOrgCloud(name: string) {
  const ws = store().workspace
  if (!ws) throw new Error('No workspace is open.')
  const { error } = await client().rpc('upgrade_to_org', { p_workspace: ws.id, p_name: name })
  if (error) throw new Error(error.message)
  store().setWorkspace({ ...ws, kind: 'org', name: name.trim().slice(0, 80) || ws.name })
}

export async function setMemberAdminCloud(memberId: string, admin: boolean) {
  const { error } = await client().rpc('set_member_admin', { p_member: memberId, p_admin: admin })
  if (error) throw new Error(error.message)
  useStore.setState((s) => ({ members: s.members.map((m) => (m.id === memberId ? { ...m, isAdmin: admin } : m)) }))
}
