// The consent page for AI clients (/oauth/consent). Supabase's OAuth server sends the browser here with
// ?authorization_id=…; Tempo shows who is asking and the user allows or denies. Pure helpers.

export const CONSENT_PATH = '/oauth/consent'

/** A real path, not a hash route, because Supabase redirects the browser to it. */
export const isConsentPath = (pathname: string): boolean => pathname.replace(/\/+$/, '') === CONSENT_PATH

/** The request id from the query string, or null when it is missing or not a plain token. */
export function parseAuthorizationId(search: string): string | null {
  const id = new URLSearchParams(search).get('authorization_id')?.trim() ?? ''
  // The id is opaque to Tempo: URL-safe characters only (Supabase issues UUID-style ids), and a sane length.
  return /^[A-Za-z0-9._~-]{1,512}$/.test(id) ? id : null
}

/**
 * Where GitHub sign-in should send the browser back to. On the consent page that is the full current address
 * (path and query), so the request survives the round trip; everywhere else it is the site root.
 */
export function signInRedirectTo(loc: { origin: string; pathname: string; search: string }): string {
  return isConsentPath(loc.pathname) ? `${loc.origin}${loc.pathname}${loc.search}` : `${loc.origin}/`
}

/** The query string without a failed sign-in's ?error=… parts, so the consent page keeps its authorization_id. */
export function withoutSignInError(search: string): string {
  const params = new URLSearchParams(search)
  for (const key of ['error', 'error_code', 'error_description']) params.delete(key)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

export interface RedirectHost {
  /** What to show: the host (with a port when there is one), or the scheme for apps that open by link. */
  display: string
  /** The address points at this computer, as Claude Code, Codex and other desktop tools do. */
  local: boolean
  /** Plain http to a remote host. The page warns about it. */
  insecure: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The host an approved client will be sent back to, or null when the address cannot be read. */
export function describeRedirect(uri: string): RedirectHost | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  const display = url.host || url.protocol.replace(/:$/, '')
  return display ? { display, local, insecure: url.protocol === 'http:' && !local } : null
}

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'])

/** A redirect the browser may follow. Desktop apps use their own schemes (cursor:, vscode:), so only script-like ones are refused. */
export function safeRedirectUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    return BLOCKED_SCHEMES.has(new URL(url).protocol) ? null : url
  } catch {
    return null
  }
}

/** Shown on the consent page, in plain words. Keep these true to what the MCP tools do. */
export const CONSENT_CAN = [
  'Read your apps, their health, owners and recent activity',
  'Write draft app cards and handover packs that a person checks before they count',
  'Add tasks for the problems Tempo flags on an app',
] as const

export const CONSENT_CANNOT = ["It can't change owners, members, invites, keys or settings"] as const

const SCOPE_WORDS: Record<string, string> = {
  openid: 'Know which Tempo account you are',
  email: 'See your email address',
  profile: 'See your name and profile picture',
  phone: 'See your phone number',
}

/**
 * The scopes the client asked for, in plain words, so the page shows exactly what this approval grants. An unknown
 * scope is shown by name (letters, digits and . _ : - only, at most 40 characters) rather than hidden.
 */
export function scopeLines(scope: string | null | undefined): string[] {
  const names = [...new Set((scope ?? '').split(/\s+/).filter(Boolean))].slice(0, 10)
  return names.map((name) => SCOPE_WORDS[name] ?? `Use the "${name.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 40) || 'unnamed'}" permission`)
}

/** One short line for a failed lookup or decision, safe to show as is. */
export function consentErrorText(message: string | null | undefined): string {
  const text = (message ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 200) : 'Something went wrong.'
}
