// The error codes OAuth 2.0 defines (RFC 6749 §4.1.2.1). Anything else in ?error= is not shown.
const KNOWN_CODES = new Set([
  'invalid_request', 'unauthorized_client', 'access_denied', 'unsupported_response_type',
  'invalid_scope', 'server_error', 'temporarily_unavailable',
])

// Supabase sends a failed OAuth round-trip back as ?error=…&error_code=…&error_description=… Turn that into one plain
// sentence. The address bar is attacker-controllable, so only fixed text is shown: error_description is never echoed.
export function oauthErrorFrom(search: string): string | null {
  const p = new URLSearchParams(search)
  const code = p.get('error')
  if (!code) return null
  if (p.get('error_code') === 'bad_oauth_state') return 'That sign-in took too long and expired. Try again.'
  if (code === 'access_denied') return 'Sign-in was cancelled.'
  return KNOWN_CODES.has(code) ? `Sign-in failed (${code}). Try again.` : 'Sign-in failed. Try again.'
}
