// Who may open the app pages (portfolio, apps, settings…). Everyone else gets the landing page.
// Only signed-in people (the demo was removed). Plain local mode survives only where sign-in isn't configured (dev).
import type { SessionStatus } from '../data/session'

export function canEnterApp(s: { status: SessionStatus; demo: boolean; onboarded: boolean }): boolean {
  if (s.status === 'signed-in') return true
  return s.status === 'off' && s.onboarded
}

/** On boot: drop data that must not be shown — any leftover Acme sample, or a team's copy after its session ended. */
export function shouldWipeOnBoot(s: { hasSession: boolean; demo: boolean; hasWorkspace: boolean }): boolean {
  return s.demo || (!s.hasSession && s.hasWorkspace)
}

const AUTH_PAGES = new Set(['', 'login', 'welcome', 'setup', 'join'])

/** Keep a safe app destination across OAuth. Join links keep using the pending-invite flow. */
export function authReturnHash(hash: string): string | null {
  if (!hash.startsWith('#/') || hash.startsWith('#//')) return null
  const page = hash.slice(2).split(/[/?#]/, 1)[0]
  return AUTH_PAGES.has(page) ? null : hash
}

const PUBLIC = new Set(['home', 'welcome', 'login', 'join', 'privacy', 'notFound'])

/** Where the app gate sends a route, or null to render it. Setup sits between sign-in and the app. */
export function gateRedirect(
  route: string,
  s: { entered: boolean; signedIn: boolean; needsSetup: boolean; hasWorkspace: boolean },
): 'home' | 'setup' | 'portfolio' | null {
  // The cloud check and IndexedDB hydration start together. A workspace restored by hydration wins over a stale
  // tab-local setup flag; the cloud loader clears inaccessible persisted workspaces before leaving loading state.
  const settingUp = s.signedIn && s.needsSetup && !s.hasWorkspace
  if (route === 'setup') return settingUp ? null : s.signedIn ? 'portfolio' : 'home'
  if (PUBLIC.has(route)) return null
  if (settingUp) return 'setup'
  return s.entered ? null : 'home'
}
