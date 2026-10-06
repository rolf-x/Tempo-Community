// /api/github-daily: Vercel Cron's once-a-day safety net. Every linked app whose facts are over a day old is refreshed, which
// covers a push whose webhook failed, was dropped or was too big for the function. Vercel sends the cron secret as a bearer.
import { createHash, timingSafeEqual } from 'node:crypto'
import { dbConfig, dueRepos, RpcError } from './db.js'
import { refreshRepo, type RefreshDeps, type RefreshEnv } from './refresh.js'

export type DailyEnv = RefreshEnv & { CRON_SECRET?: string }

const BATCH = 100
const CONCURRENCY = 4
/** Stop starting repos after this long, leaving the rest of the 300 s function budget to finish the ones in flight. */
const START_WINDOW_MS = 240_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Constant time, whatever the lengths: both sides are hashed first. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function handleDaily(request: Request, env: DailyEnv, deps: RefreshDeps = {}): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  if (!env.CRON_SECRET || !env.TEMPO_SERVER_KEY || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !dbConfig(env)) {
    return json({ error: 'not_configured' }, 503)
  }
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${env.CRON_SECRET}`)) return json({ error: 'unauthorized' }, 401)

  const now = deps.now ?? Date.now
  const startedAt = now()
  let due: Awaited<ReturnType<typeof dueRepos>>
  try {
    const rows = await dueRepos({ env, fetch: deps.fetch }, BATCH)
    due = Array.isArray(rows) ? rows : []
  } catch (error) {
    console.error(`github-daily: listing failed (${error instanceof RpcError ? `database ${error.code}` : 'unknown'})`)
    return json({ error: 'internal_error' }, 500)
  }

  let next = 0
  let refreshed = 0
  let failed = 0
  const worker = async () => {
    while (next < due.length && now() - startedAt < START_WINDOW_MS) {
      const repo = due[next++]
      try {
        await refreshRepo(env, { installationId: repo.installation_id, fullName: repo.full_name, activeAt: null }, deps)
        refreshed++
      } catch {
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker))
  const skipped = due.length - next
  if (failed || skipped) console.error(`github-daily: ${refreshed} refreshed, ${failed} failed, ${skipped} not started`)
  return json({ refreshed, failed, skipped })
}
