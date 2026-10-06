import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleDaily } from './daily'
import { backend, CRON_SECRET, ENV, INSTALLATION_TOKEN, json, SERVER_KEY, type BackendOptions } from './testkit'

const NOW = Date.parse('2026-10-06T04:17:00Z')
const due = (count: number) => Array.from({ length: count }, (_, i) => ({ installation_id: 40 + (i % 3), full_name: `acme/app-${i}` }))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function request(over: { method?: string; auth?: string | null } = {}) {
  const headers: Record<string, string> = {}
  if (over.auth !== null) headers.Authorization = over.auth ?? `Bearer ${CRON_SECRET}`
  return new Request('https://tempo.test/api/github-daily', { method: over.method ?? 'GET', headers })
}

async function run(req: Request, options: BackendOptions = {}, env: Record<string, string | undefined> = ENV, now: () => number = () => NOW) {
  const api = backend(options)
  const response = await handleDaily(req, env, { fetch: api.fetch, now })
  return { response, api }
}

afterEach(() => vi.restoreAllMocks())

describe('who may call it', () => {
  it('401s a wrong, missing or malformed secret and does nothing', async () => {
    for (const auth of [null, '', 'Bearer wrong', CRON_SECRET, `bearer ${CRON_SECRET}`, `Bearer ${CRON_SECRET}x`, `Bearer ${CRON_SECRET.slice(1)}`]) {
      const { response, api } = await run(request({ auth }))
      expect(response.status, String(auth)).toBe(401)
      expect(api.calls).toHaveLength(0)
    }
  })

  it('answers 405 to anything but GET, and 503 when it is not set up (an empty secret never matches)', async () => {
    expect((await run(request({ method: 'POST' }))).response.status).toBe(405)
    for (const name of ['CRON_SECRET', 'TEMPO_SERVER_KEY', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'SUPABASE_URL']) {
      const { response, api } = await run(request({ auth: 'Bearer ' }), {}, { ...ENV, [name]: name === 'CRON_SECRET' ? '' : undefined })
      expect(response.status, name).toBe(503)
      expect(api.calls).toHaveLength(0)
    }
  })
})

describe('the refresh', () => {
  it('asks for 100 due repos with the server key and refreshes each with no push time', async () => {
    const { response, api } = await run(request(), { rpc: { github_due_repos: () => due(3) } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ refreshed: 3, failed: 0, skipped: 0 })
    expect(api.rpcs('github_due_repos')[0].body).toEqual({ p_key: SERVER_KEY, p_limit: 100 })
    const saves = api.rpcs('github_save_facts')
    expect(saves).toHaveLength(3)
    for (const save of saves) {
      expect(save.body).toMatchObject({ p_key: SERVER_KEY, p_active_at: null, p_old_full_name: null, p_signals: { syncedAt: '2026-10-06T04:17:00.000Z' } })
    }
    expect(api.tokenRequests().map((c) => [c.url.match(/installations\/(\d+)/)![1], c.body.repositories[0]])).toEqual([['40', 'app-0'], ['41', 'app-1'], ['42', 'app-2']])
    expect(api.rpcs('github_record_delivery')).toHaveLength(0)
  })

  it('refreshes nothing when nothing is due', async () => {
    const { response, api } = await run(request(), { rpc: { github_due_repos: () => [] } })
    expect(await response.json()).toEqual({ refreshed: 0, failed: 0, skipped: 0 })
    expect(api.tokenRequests()).toHaveLength(0)
  })

  it('runs at most four at a time, and uses all four', async () => {
    let inFlight = 0
    let peak = 0
    const { response } = await run(request(), {
      rpc: { github_due_repos: () => due(12) },
      token: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await sleep(5)
        inFlight--
        return json({ token: INSTALLATION_TOKEN }, 201)
      },
    })
    expect(await response.json()).toMatchObject({ refreshed: 12, failed: 0 })
    expect(peak).toBe(4)
  })

  it('counts a repo it could not refresh and carries on with the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, api } = await run(request(), {
      rpc: { github_due_repos: () => due(5) },
      token: (call) => call.body.repositories[0] === 'app-2' ? json({ message: 'Not Found' }, 404) : json({ token: INSTALLATION_TOKEN }, 201),
    })
    expect(await response.json()).toEqual({ refreshed: 4, failed: 1, skipped: 0 })
    expect(api.rpcs('github_save_facts')).toHaveLength(4)
  })

  it('counts a repo whose save is refused as failed, and never as refreshed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response } = await run(request(), {
      rpc: { github_due_repos: () => due(2), github_save_facts: () => json({ code: '42501', message: 'no' }, 403) },
    })
    expect(await response.json()).toEqual({ refreshed: 0, failed: 2, skipped: 0 })
  })

  it('stops starting new repos after four minutes and reports the rest as skipped', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let clock = NOW
    const { response, api } = await run(request(), {
      rpc: { github_due_repos: () => due(10), github_save_facts: () => { clock += 100_000; return 1 } },
    }, ENV, () => clock)
    const body = await response.json()
    expect(body.failed).toBe(0)
    expect(body.skipped).toBeGreaterThan(0)
    expect(body.refreshed + body.skipped).toBe(10)
    expect(api.rpcs('github_save_facts')).toHaveLength(body.refreshed)
  })

  it('answers 500, generically, when it cannot list the due repos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response } = await run(request(), { rpc: { github_due_repos: () => json({ code: '42501', message: 'bad key' }, 403) } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
  })
})
