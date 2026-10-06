// MCP resource-server auth. Supabase's OAuth 2.1 server is the authorization server; this only checks its tokens.
// A token is accepted when Supabase signed it (JWKS, via getClaims), it is from this project, it is a signed-in user's,
// it has not expired, it was issued to an OAuth client (client_id), and its sign-in still exists. A plain browser session
// has no client_id, so a stolen app session can't be replayed here. Revoking a client in Tempo deletes its sign-in, so
// the next call gets a 401 even though the JWT itself has not expired.
import { createClient } from '@supabase/supabase-js'
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'

type Claims = Record<string, unknown>

export interface VerifierOptions {
  /** `https://<ref>.supabase.co/auth/v1`: the `iss` every token from this project carries. */
  issuer: string
  /** Verifies the signature and returns the claims; throws when the token is not valid. */
  getClaims: (token: string) => Promise<Claims>
  /** false when the token's sign-in was revoked or ended; throws when that can't be checked right now. */
  isLive?: (token: string) => Promise<boolean>
  now?: () => number
}

const invalid = (message: string) => new OAuthError(OAuthErrorCode.InvalidToken, message)

export function makeVerifier({ issuer, getClaims, isLive, now = Date.now }: VerifierOptions): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let claims: Claims
      try {
        claims = await getClaims(token)
      } catch {
        throw invalid('The token is not valid. Sign in to Tempo again.')
      }
      if (claims.iss !== issuer) throw invalid('This token is from another sign-in service.')
      if (typeof claims.client_id !== 'string' || !claims.client_id) throw invalid('This token was not issued to an MCP client.')
      if (claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !claims.sub) throw invalid('This token does not belong to a signed-in person.')
      if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now()) throw invalid('The token has expired. Sign in to Tempo again.')
      if (isLive && !(await isLive(token))) throw invalid('This connection was revoked or signed out. Sign in to Tempo again.')
      return {
        token,
        clientId: claims.client_id,
        scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
        expiresAt: claims.exp,
        extra: { userId: claims.sub },
      }
    },
  }
}

/** Checks the signature against the project's published keys (ES256 on Tempo's projects), so no call to Supabase per request. */
export function supabaseClaims(supabaseUrl: string, anonKey: string): (token: string) => Promise<Claims> {
  const auth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth
  return async (token) => {
    const { data, error } = await auth.getClaims(token)
    if (error || !data?.claims) throw new Error('invalid token')
    return data.claims as Claims
  }
}

/**
 * Asks Supabase Auth whether the token's sign-in still exists (one request per MCP call). A revoked or signed-out
 * session comes back as `session_not_found` (supabase-js turns it into AuthSessionMissingError, status 400), a deleted
 * user as 401/403/404: all of those mean "not live". Anything else (network, 5xx) throws, so a Supabase outage reads
 * as a server error, not a sign-out.
 */
export function supabaseLive(supabaseUrl: string, anonKey: string, fetchImpl?: typeof fetch): (token: string) => Promise<boolean> {
  const auth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  }).auth
  return async (token) => {
    const { data, error } = await auth.getUser(token)
    if (!error) return Boolean(data.user)
    const e = error as { name?: string; code?: string; status?: number }
    if (e.name === 'AuthSessionMissingError' || e.code === 'session_not_found' || e.code === 'user_not_found') return false
    if (e.status === 401 || e.status === 403 || e.status === 404) return false
    throw new Error('Supabase Auth is unavailable')
  }
}

/** Browsers send Origin on cross-site requests; a web page on another site may not drive this endpoint. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) return true
  return origin === new URL(request.url).origin
}

/** A friendly name for the client from its User-Agent. A label for people, not proof: anyone can set a User-Agent. */
export function clientLabel(userAgent: string | null | undefined): string | null {
  const agent = (userAgent ?? '').toLowerCase()
  if (agent.startsWith('claude-code')) return 'Claude Code'
  if (agent.startsWith('codex')) return 'Codex'
  if (agent.startsWith('cursor')) return 'Cursor'
  if (agent.startsWith('claude')) return 'Claude'
  return null
}
