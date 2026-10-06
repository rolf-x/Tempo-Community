// Auth session (Supabase). The UI reads this store; src/data/supabase.ts fills it in.
// With no VITE_SUPABASE_URL configured the status is 'off' and the app runs in guest mode only.
import { create } from 'zustand'
import { authReturnHash } from '../lib/entry'
import { navigate } from '../lib/router'

const AUTH_RETURN_KEY = 'tempo.authReturn'

export type SessionStatus = 'off' | 'loading' | 'signed-out' | 'signed-in'
export type AuthProvider = 'github' | 'google'

export interface SessionUser {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  githubLogin: string | null
  /** When this person last signed in (Supabase); a new value means a new sign-in, not a reload or token refresh. */
  lastSignInAt: string | null
}

interface SessionState {
  status: SessionStatus
  user: SessionUser | null
  /** Proxy marker or tab-only fallback token. null = GitHub not connected. */
  githubToken: string | null
  error: string | null
  /** A retryable cloud save is still queued. */
  pendingSave: boolean
  /** Signed in but not in any workspace yet: the app shows #/setup (organization or individual). */
  needsSetup: boolean
  /** Signed in with only an inactive membership: explain the removal before offering setup. */
  removedFrom: { name: string } | null
  signIn: (provider: AuthProvider) => Promise<void>
  signOut: () => Promise<void>
}

export const cloudConfigured = !!import.meta.env?.VITE_SUPABASE_URL && !!import.meta.env?.VITE_SUPABASE_ANON_KEY

export const useSession = create<SessionState>()(() => ({
  status: cloudConfigured ? 'loading' : 'off',
  user: null,
  githubToken: null,
  error: null,
  pendingSave: false,
  needsSetup: false,
  removedFrom: null,
  signIn: async () => {
    useSession.setState({ error: "Sign-in isn't set up on this deployment yet. Nothing changed on your side." })
  },
  signOut: async () => {},
}))

/** Remember an app page without letting auth pages overwrite an earlier useful destination. */
export function rememberAuthReturn(hash = window.location.hash): void {
  const target = authReturnHash(hash)
  if (!target) return
  try {
    sessionStorage.setItem(AUTH_RETURN_KEY, target)
  } catch { /* Storage can be unavailable in privacy modes; Portfolio remains the fallback. */ }
}

/** Read once after OAuth so an old destination cannot leak into a later sign-in. */
export function takeAuthReturn(): string | null {
  try {
    const target = authReturnHash(sessionStorage.getItem(AUTH_RETURN_KEY) ?? '')
    sessionStorage.removeItem(AUTH_RETURN_KEY)
    return target
  } catch {
    return null
  }
}

/** Sign out from anywhere in the app and land on the homepage. */
export async function signOutToHome() {
  await useSession.getState().signOut()
  navigate({ name: 'home' })
}
