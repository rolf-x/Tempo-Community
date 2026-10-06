// /api/github-webhook: GitHub tells Tempo about pushes, renames, visibility changes and removed installations.
// Order: method, configuration, signature (HMAC-SHA256 of the raw body, constant time), then the event is turned into a
// plan from validated fields only, the delivery id is recorded (a repeat does nothing), and the plan runs:
//   push to the default branch -> re-read the repo and save fresh signals + the push time (refreshRepo);
//   push to any other branch   -> save only "changed at" and the repo's id and name;
//   repository renamed / privatized / publicized -> save the new name or visibility;
//   installation deleted / suspended -> unlink it.
// Nothing from the payload, no token and no secret is ever echoed or logged.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { GitHubApiError } from './auth.js'
import { dbConfig, RpcError, recordDelivery, saveFacts, unlinkInstallation, type RepoFactsRepo } from './db.js'
import { FULL_NAME, refreshRepo, type RefreshDeps, type RefreshEnv } from './refresh.js'

export type WebhookEnv = RefreshEnv & { GITHUB_WEBHOOK_SECRET?: string }

const MAX_BODY_BYTES = 5_000_000
const OWNER_OR_NAME = /^[A-Za-z0-9_.-]+$/
const DELIVERY_ID = /^[A-Za-z0-9_.:-]{1,100}$/

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const positiveInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

/** `sha256=` + hex(HMAC-SHA256(secret, raw body)), compared in constant time. The legacy SHA-1 header is ignored. */
export function validSignature(secret: string, body: Buffer, header: string | null): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header ?? '')
  if (!match) return false
  const given = Buffer.from(match[1], 'hex')
  const expected = createHmac('sha256', secret).update(body).digest()
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** A GitHub time as ISO: a UNIX-seconds number (push payloads' `repository.pushed_at`) or an ISO string. */
function isoTime(value: unknown): string | null {
  let ms = NaN
  if (typeof value === 'number') ms = value * 1000
  else if (typeof value === 'string' && value) ms = /^\d{1,12}$/.test(value) ? Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? new Date(ms).toISOString() : null
}

function parseRepository(value: unknown): RepoFactsRepo | null {
  if (!isRecord(value)) return null
  const id = positiveInt(value.id)
  const { full_name: fullName, default_branch: defaultBranch } = value
  if (id === null || typeof fullName !== 'string' || !FULL_NAME.test(fullName)) return null
  if (typeof value.private !== 'boolean') return null
  if (typeof defaultBranch !== 'string' || !defaultBranch || defaultBranch.length > 255) return null
  return { id, fullName, private: value.private, defaultBranch }
}

type Plan =
  | { action: 'ignore' }
  | { action: 'invalid' }
  | { action: 'refresh'; installationId: number; fullName: string; activeAt: string }
  | { action: 'save'; installationId: number; repo: RepoFactsRepo; activeAt: string | null; oldFullName: string | null }
  | { action: 'unlink'; installationId: number }

const IGNORE: Plan = { action: 'ignore' }
const INVALID: Plan = { action: 'invalid' }

function plan(event: string, payload: Record<string, unknown>, nowMs: number): Plan {
  const installationId = positiveInt(isRecord(payload.installation) ? payload.installation.id : null)
  if (installationId === null) return IGNORE

  if (event === 'installation') {
    return payload.action === 'deleted' || payload.action === 'suspend' ? { action: 'unlink', installationId } : IGNORE
  }

  if (event === 'push') {
    const ref = payload.ref
    if (typeof ref !== 'string') return INVALID
    // Tags and deleted branches say nothing about the app's work.
    if (!ref.startsWith('refs/heads/') || payload.deleted === true) return IGNORE
    const repo = parseRepository(payload.repository)
    if (!repo) return INVALID
    const head = isRecord(payload.head_commit) ? payload.head_commit.timestamp : null
    const pushedAt = isRecord(payload.repository) ? payload.repository.pushed_at : null
    // A commit's own timestamp is whatever its author set, so it never counts as later than now.
    const activeAt = new Date(Math.min(Date.parse(isoTime(head) ?? isoTime(pushedAt) ?? new Date(nowMs).toISOString()), nowMs)).toISOString()
    return ref === `refs/heads/${repo.defaultBranch}`
      ? { action: 'refresh', installationId, fullName: repo.fullName, activeAt }
      : { action: 'save', installationId, repo, activeAt, oldFullName: null }
  }

  if (event === 'repository') {
    const action = payload.action
    if (action !== 'renamed' && action !== 'privatized' && action !== 'publicized') return IGNORE
    const repo = parseRepository(payload.repository)
    if (!repo) return INVALID
    if (action !== 'renamed') return { action: 'save', installationId, repo, activeAt: null, oldFullName: null }
    const changes = isRecord(payload.changes) ? payload.changes : {}
    const from = isRecord(changes.repository) && isRecord(changes.repository.name) ? changes.repository.name.from : null
    // Only the name changes in a rename: the owner is the payload's owner, which is also the new full name's first part.
    const login = isRecord(payload.repository) && isRecord(payload.repository.owner) ? payload.repository.owner.login : null
    const owner = typeof login === 'string' && OWNER_OR_NAME.test(login) ? login : repo.fullName.split('/')[0]
    if (typeof from !== 'string' || !OWNER_OR_NAME.test(from)) return INVALID
    return { action: 'save', installationId, repo, activeAt: null, oldFullName: `${owner}/${from}` }
  }

  return IGNORE
}

/** What went wrong, in words that cannot carry a token or a payload. */
function reason(error: unknown): string {
  if (error instanceof RpcError) return `database ${error.code}`
  if (error instanceof GitHubApiError) return `github ${error.kind}${error.status ? ` ${error.status}` : ''}`
  return error instanceof Error ? error.name : 'unknown'
}

export async function handleWebhook(request: Request, env: WebhookEnv, deps: RefreshDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' })
  const secret = env.GITHUB_WEBHOOK_SECRET
  if (!secret || !env.TEMPO_SERVER_KEY || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !dbConfig(env)) {
    return json({ error: 'not_configured' }, 503)
  }
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)

  const body = Buffer.from(await request.arrayBuffer())
  if (body.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  if (!validSignature(secret, body, request.headers.get('x-hub-signature-256'))) return json({ error: 'unauthorized' }, 401)

  const event = request.headers.get('x-github-event') ?? ''
  if (event === 'ping') return json({ ok: true })

  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    return json({ error: 'bad_payload' }, 400)
  }
  if (!isRecord(payload)) return json({ error: 'bad_payload' }, 400)

  const now = deps.now ?? Date.now
  const todo = plan(event, payload, now())
  if (todo.action === 'ignore') return json({ ignored: true })
  if (todo.action === 'invalid') return json({ error: 'bad_payload' }, 400)

  const delivery = request.headers.get('x-github-delivery') ?? ''
  if (!DELIVERY_ID.test(delivery)) return json({ error: 'bad_request' }, 400)

  const call = { env, fetch: deps.fetch }
  try {
    // A delivery GitHub sends twice (a redelivery, a replay) does nothing the second time. If this one fails below and is
    // redelivered by hand it is skipped too; the daily check picks that app up.
    if (!(await recordDelivery(call, delivery))) return json({ duplicate: true })
    switch (todo.action) {
      case 'refresh':
        await refreshRepo(env, { installationId: todo.installationId, fullName: todo.fullName, activeAt: todo.activeAt }, deps)
        break
      case 'save':
        await saveFacts(call, { installationId: todo.installationId, repo: todo.repo, signals: null, activeAt: todo.activeAt, oldFullName: todo.oldFullName })
        break
      case 'unlink':
        await unlinkInstallation(call, todo.installationId)
        break
    }
    return json({ ok: true })
  } catch (error) {
    console.error(`github-webhook: ${event} ${todo.action} failed (${reason(error)})`)
    return json({ error: 'internal_error' }, 500)
  }
}
