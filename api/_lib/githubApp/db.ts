// The push webhook's only way into the database: the github_* functions (migration 0022) over PostgREST, with the anon
// key. Tempo has no service-role key. The functions that write repo facts are gated by TEMPO_SERVER_KEY (stored in the
// database only as a hash), so only this server can call them; the linking function runs as the signed-in person.
import type { RepoSignals } from '../../../src/types.js'

export interface DbEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

const RPC_TIMEOUT_MS = 8_000

/** A PostgREST error: the SQLSTATE (or PostgREST) code and its message. */
export class RpcError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'RpcError'
  }
}

export function dbConfig(env: DbEnv): { url: string; anon: string } | null {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''
  return url && anon ? { url, anon } : null
}

/**
 * POST /rest/v1/rpc/<fn>. `jwt` is the signed-in person's Supabase access token for the functions that check who is
 * calling; without it the anon key is the bearer. Throws RpcError with PostgREST's `{ code, message }` on a refusal.
 */
export async function rpc<T>(
  env: DbEnv,
  fn: string,
  args: Record<string, unknown>,
  options: { jwt?: string; fetch?: typeof fetch } = {},
): Promise<T> {
  const config = dbConfig(env)
  if (!config) throw new RpcError('not_configured', 'Supabase is not configured.', 503)
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new RpcError('bad_function', 'Bad function name.', 500)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(`${config.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: config.anon,
        Authorization: `Bearer ${options.jwt ?? config.anon}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      redirect: 'manual',
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch {
    throw new RpcError('unreachable', "Couldn't reach the database.", 502)
  }
  let body: unknown = null
  const text = await response.text().catch(() => '')
  try {
    body = text ? JSON.parse(text) : null
  } catch { /* A non-JSON answer is handled by status below. */ }
  if (!response.ok) {
    const error = (body && typeof body === 'object' ? body : {}) as { code?: unknown; message?: unknown }
    throw new RpcError(
      typeof error.code === 'string' ? error.code : String(response.status),
      typeof error.message === 'string' ? error.message : `The database answered ${response.status}.`,
      response.status,
    )
  }
  return body as T
}

/** What `github_save_facts` takes as `p_repo`. */
export interface RepoFactsRepo {
  id: number
  fullName: string
  private: boolean
  defaultBranch: string
}

export interface SaveFacts {
  installationId: number
  repo: RepoFactsRepo
  /** The full facts of a default-branch read, or null when only "something changed" is known. */
  signals: RepoSignals | null
  /** ISO time of the push; null for the daily check. */
  activeAt: string | null
  /** Set on a rename: the name the app still carries. */
  oldFullName?: string | null
}

type Call = { env: DbEnv & { TEMPO_SERVER_KEY?: string }; fetch?: typeof fetch }

const serverKey = (env: { TEMPO_SERVER_KEY?: string }) => {
  if (!env.TEMPO_SERVER_KEY) throw new RpcError('not_configured', 'The server key is not set.', 503)
  return env.TEMPO_SERVER_KEY
}

/** true the first time a delivery id is seen. */
export function recordDelivery({ env, fetch }: Call, deliveryId: string): Promise<boolean> {
  return rpc<boolean>(env, 'github_record_delivery', { p_key: serverKey(env), p_id: deliveryId }, { fetch })
}

/** Writes repo facts into the workspaces linked to the installation. Returns how many apps it updated. */
export function saveFacts({ env, fetch }: Call, facts: SaveFacts): Promise<number> {
  return rpc<number>(env, 'github_save_facts', {
    p_key: serverKey(env),
    p_installation: facts.installationId,
    p_repo: facts.repo,
    p_signals: facts.signals,
    p_active_at: facts.activeAt,
    p_old_full_name: facts.oldFullName ?? null,
  }, { fetch })
}

export function unlinkInstallation({ env, fetch }: Call, installationId: number): Promise<number> {
  return rpc<number>(env, 'github_unlink_installation', { p_key: serverKey(env), p_installation: installationId }, { fetch })
}

export function dueRepos({ env, fetch }: Call, limit: number): Promise<Array<{ installation_id: number; full_name: string }>> {
  return rpc(env, 'github_due_repos', { p_key: serverKey(env), p_limit: limit }, { fetch })
}
