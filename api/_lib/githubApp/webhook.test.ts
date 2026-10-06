import { createHmac, createPublicKey, verify } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleWebhook, validSignature } from './webhook'
import { backend, delivery, ENV, INSTALLATION_TOKEN, json, privateKeyPem, publicKeyPem, REPO_ID, SECRET, SERVER_KEY, type BackendOptions } from './testkit'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const repository = { id: REPO_ID, full_name: 'acme/web', private: true, default_branch: 'main', pushed_at: Math.floor(Date.parse('2026-10-06T09:30:00Z') / 1000), owner: { login: 'acme' } }
const installation = { id: 42 }
const push = (over: Record<string, unknown> = {}) => ({
  ref: 'refs/heads/main', deleted: false, repository, installation,
  head_commit: { timestamp: '2026-10-06T10:00:00+02:00' }, ...over,
})

async function call(request: Request, options: BackendOptions = {}, env: Record<string, string | undefined> = ENV) {
  const api = backend(options)
  const response = await handleWebhook(request, env, { fetch: api.fetch, now: () => NOW })
  return { response, api }
}

afterEach(() => vi.restoreAllMocks())

describe('before any work', () => {
  it('answers 405 to anything but POST', async () => {
    const { response, api } = await call(delivery('push', push(), { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(api.calls).toHaveLength(0)
  })

  it.each(['GITHUB_WEBHOOK_SECRET', 'TEMPO_SERVER_KEY', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'])('answers 503 not_configured without %s', async (name) => {
    const { response, api } = await call(delivery('push', push()), {}, { ...ENV, [name]: undefined })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'not_configured' })
    expect(api.calls).toHaveLength(0)
  })

  it('refuses an oversized body', async () => {
    const request = delivery('push', push(), { headers: { 'Content-Length': '6000000' } })
    expect((await call(request)).response.status).toBe(413)
  })
})

describe('the signature', () => {
  it('401s with no detail when it is missing, wrong, for another body, of the wrong length or only SHA-1', async () => {
    const wrongBody = `sha256=${createHmac('sha256', SECRET).update('{"other":1}').digest('hex')}`
    for (const signature of [null, 'sha256=' + '0'.repeat(64), wrongBody, 'sha256=abc', 'sha256=', 'nonsense', `sha1=${createHmac('sha1', SECRET).update(JSON.stringify(push())).digest('hex')}`]) {
      const { response, api } = await call(delivery('push', push(), { signature }))
      expect(response.status, String(signature)).toBe(401)
      expect(await response.json()).toEqual({ error: 'unauthorized' })
      expect(api.calls).toHaveLength(0)
    }
  })

  it('401s a body signed with another secret', async () => {
    expect((await call(delivery('push', push(), { secret: 'someone-else' }))).response.status).toBe(401)
  })

  it('checks the raw bytes, not a re-serialised copy', async () => {
    const raw = '{ "ref": "refs/heads/main",   "zen": "spacing matters" }'
    expect((await call(delivery('ping', null, { raw }))).response.status).toBe(200)
    expect((await call(delivery('ping', null, { raw, signature: `sha256=${createHmac('sha256', SECRET).update(JSON.stringify(JSON.parse(raw))).digest('hex')}` }))).response.status).toBe(401)
  })

  it('validSignature compares equal-length buffers and accepts only the sha256= form', () => {
    const body = Buffer.from('hello')
    const good = createHmac('sha256', 's').update(body).digest('hex')
    expect(validSignature('s', body, `sha256=${good}`)).toBe(true)
    expect(validSignature('s', body, good)).toBe(false)
    expect(validSignature('s', body, `sha256=${good.slice(0, 62)}`)).toBe(false)
    expect(validSignature('s', body, null)).toBe(false)
  })
})

describe('events', () => {
  it('answers ping with 200 and touches nothing', async () => {
    const { response, api } = await call(delivery('ping', { zen: 'Keep it logically awesome.' }))
    expect(response.status).toBe(200)
    expect(api.calls).toHaveLength(0)
  })

  it('skips a delivery it has seen before: nothing read, nothing saved', async () => {
    const { response, api } = await call(delivery('push', push()), { rpc: { github_record_delivery: () => false } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ duplicate: true })
    expect(api.rpcs().map((c) => c.url.split('/').pop())).toEqual(['github_record_delivery'])
    expect(api.rpcs('github_record_delivery')[0].body).toEqual({ p_key: SERVER_KEY, p_id: 'delivery-1' })
    expect(api.tokenRequests()).toHaveLength(0)
    expect(api.reads()).toHaveLength(0)
  })

  it('answers 400 for a delivery without a usable id', async () => {
    expect((await call(delivery('push', push(), { delivery: null }))).response.status).toBe(400)
    expect((await call(delivery('push', push(), { delivery: 'a b\n' }))).response.status).toBe(400)
  })

  it('ignores every other event with a 200', async () => {
    for (const event of ['star', 'issues', 'installation_repositories', 'check_run', '']) {
      const { response, api } = await call(delivery(event, push()))
      expect(response.status, event).toBe(200)
      expect(await response.json()).toEqual({ ignored: true })
      expect(api.calls).toHaveLength(0)
    }
  })
})

describe('a push to the default branch', () => {
  it('mints a one-repo token, reads the repo and saves the signals with the push time', async () => {
    const { response, api } = await call(delivery('push', push()))
    expect(response.status).toBe(200)

    // The token: one repo, signed with the App key.
    const [mint] = api.tokenRequests()
    expect(mint.url).toBe('https://api.github.com/app/installations/42/access_tokens')
    expect(mint.body).toEqual({ repositories: ['web'] })
    const [header, payload, signature] = mint.headers.authorization.replace('Bearer ', '').split('.')
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: '12345', iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 })

    // The reads use that token and fetch names, dates and counts only: never a file's contents (no README, no notes
    // files), and only the newest commit. The README is found in the file list.
    const paths = api.reads().map((read) => read.url.replace('https://api.github.com', ''))
    expect([...paths].sort()).toEqual([
      '/repos/acme/web', '/repos/acme/web/commits?per_page=1', '/repos/acme/web/pulls?state=open&per_page=20',
      '/repos/acme/web/issues?state=open&per_page=30', '/repos/acme/web/git/trees/main?recursive=1',
      '/repos/acme/web/deployments?environment=Production&per_page=1', '/repos/acme/web/deployments/7/statuses?per_page=1',
    ].sort())
    expect(paths.some((path) => /\/readme|\/contents\//.test(path))).toBe(false)
    for (const read of api.reads()) expect(read.headers.authorization).toBe(`Bearer ${INSTALLATION_TOKEN}`)

    // The save: signals plus the push time.
    const saves = api.rpcs('github_save_facts')
    expect(saves).toHaveLength(1)
    expect(saves[0].body).toEqual({
      p_key: SERVER_KEY,
      p_installation: 42,
      p_repo: { id: REPO_ID, fullName: 'acme/web', private: true, defaultBranch: 'main' },
      p_signals: {
        hasReadme: true, secretFiles: ['.env'], lastCommitAt: '2026-10-05T11:00:00Z', openIssues: 1, openPrs: 1,
        syncedAt: '2026-10-06T12:00:00.000Z', liveUrl: 'https://web.example',
      },
      p_active_at: '2026-10-06T08:00:00.000Z',
      p_old_full_name: null,
    })
    expect(api.rpcs().map((c) => c.url.split('/').pop())).toEqual(['github_record_delivery', 'github_save_facts'])
  })

  it('saves the repo as GitHub names it now, even when the push payload still has the old name', async () => {
    const { api } = await call(delivery('push', push({ repository: { ...repository, full_name: 'acme/web-old' } })), {
      github: (path) => path === '/repos/acme/web-old' ? json({ ...{ id: REPO_ID }, full_name: 'acme/web', html_url: 'u', private: false, default_branch: 'trunk', description: null, pushed_at: null }) : undefined,
    })
    expect(api.rpcs('github_save_facts')[0].body.p_repo).toEqual({ id: REPO_ID, fullName: 'acme/web', private: false, defaultBranch: 'trunk' })
  })

  it('uses repository.pushed_at (UNIX seconds) when the push has no head commit', async () => {
    const { api } = await call(delivery('push', push({ head_commit: null })))
    expect(api.rpcs('github_save_facts')[0].body.p_active_at).toBe('2026-10-06T09:30:00.000Z')
  })

  it('never lets a commit dated in the future move the app past now', async () => {
    const { api } = await call(delivery('push', push({ head_commit: { timestamp: '2099-01-01T00:00:00Z' } })))
    expect(api.rpcs('github_save_facts')[0].body.p_active_at).toBe('2026-10-06T12:00:00.000Z')
  })

  it('falls back to now when the payload has no usable time', async () => {
    const { api } = await call(delivery('push', push({ head_commit: { timestamp: 'garbage' }, repository: { ...repository, pushed_at: null } })))
    expect(api.rpcs('github_save_facts')[0].body.p_active_at).toBe('2026-10-06T12:00:00.000Z')
  })
})

describe('a push elsewhere', () => {
  it('to another branch saves only "changed" with null signals, and reads nothing from GitHub', async () => {
    const { response, api } = await call(delivery('push', push({ ref: 'refs/heads/feature/x' })))
    expect(response.status).toBe(200)
    expect(api.tokenRequests()).toHaveLength(0)
    expect(api.reads()).toHaveLength(0)
    expect(api.rpcs('github_save_facts')[0].body).toEqual({
      p_key: SERVER_KEY, p_installation: 42,
      p_repo: { id: REPO_ID, fullName: 'acme/web', private: true, defaultBranch: 'main' },
      p_signals: null, p_active_at: '2026-10-06T08:00:00.000Z', p_old_full_name: null,
    })
  })

  it('to a tag is ignored before anything is recorded', async () => {
    const { response, api } = await call(delivery('push', push({ ref: 'refs/tags/v1.0.0' })))
    expect(await response.json()).toEqual({ ignored: true })
    expect(api.calls).toHaveLength(0)
  })

  it('that deletes a branch is ignored', async () => {
    const { response, api } = await call(delivery('push', push({ ref: 'refs/heads/old', deleted: true, head_commit: null })))
    expect(await response.json()).toEqual({ ignored: true })
    expect(api.calls).toHaveLength(0)
  })

  it('from a payload with no installation is ignored', async () => {
    const { response, api } = await call(delivery('push', push({ installation: undefined })))
    expect(await response.json()).toEqual({ ignored: true })
    expect(api.calls).toHaveLength(0)
  })
})

describe('repository and installation events', () => {
  const renamed = { action: 'renamed', repository: { ...repository, full_name: 'acme/web-2' }, changes: { repository: { name: { from: 'web' } } }, installation }

  it('a rename passes the old full name and no signals or time', async () => {
    const { response, api } = await call(delivery('repository', renamed))
    expect(response.status).toBe(200)
    expect(api.rpcs('github_save_facts')[0].body).toEqual({
      p_key: SERVER_KEY, p_installation: 42,
      p_repo: { id: REPO_ID, fullName: 'acme/web-2', private: true, defaultBranch: 'main' },
      p_signals: null, p_active_at: null, p_old_full_name: 'acme/web',
    })
    expect(api.reads()).toHaveLength(0)
  })

  it.each(['privatized', 'publicized'])('%s saves the new visibility with null signals', async (action) => {
    const { api } = await call(delivery('repository', { action, repository: { ...repository, private: action === 'privatized' }, installation }))
    expect(api.rpcs('github_save_facts')[0].body).toMatchObject({
      p_repo: { private: action === 'privatized' }, p_signals: null, p_active_at: null, p_old_full_name: null,
    })
  })

  it.each(['edited', 'archived', 'created', 'deleted'])('ignores repository %s', async (action) => {
    const { response, api } = await call(delivery('repository', { action, repository, installation }))
    expect(await response.json()).toEqual({ ignored: true })
    expect(api.calls).toHaveLength(0)
  })

  it.each(['deleted', 'suspend'])('installation %s unlinks the installation', async (action) => {
    const { response, api } = await call(delivery('installation', { action, installation: { id: 42, account: { login: 'acme' } } }))
    expect(response.status).toBe(200)
    expect(api.rpcs('github_unlink_installation')[0].body).toEqual({ p_key: SERVER_KEY, p_installation: 42 })
    expect(api.reads()).toHaveLength(0)
  })

  it.each(['created', 'unsuspend', 'new_permissions_accepted'])('ignores installation %s', async (action) => {
    const { response, api } = await call(delivery('installation', { action, installation }))
    expect(await response.json()).toEqual({ ignored: true })
    expect(api.calls).toHaveLength(0)
  })
})

describe('bad payloads', () => {
  it('never crash: they answer 4xx or 200 and save nothing', async () => {
    const bad: Array<[string, unknown]> = [
      ['push', push({ repository: undefined })],
      ['push', push({ repository: 'acme/web' })],
      ['push', push({ repository: { ...repository, id: '99' } })],
      ['push', push({ repository: { ...repository, full_name: '../../etc/passwd' } })],
      ['push', push({ repository: { ...repository, full_name: 'acme/web/extra' } })],
      ['push', push({ repository: { ...repository, private: 'yes' } })],
      ['push', push({ repository: { ...repository, default_branch: '' } })],
      ['push', push({ ref: 7 })],
      ['push', push({ installation: { id: '42' } })],
      ['push', push({ installation: 'x' })],
      ['push', []],
      ['push', 'text'],
      ['push', null],
      ['repository', { action: 'renamed', repository, installation }],
      ['repository', { action: 'renamed', repository, changes: { repository: { name: { from: '../x' } } }, installation }],
      ['repository', { action: 'privatized', repository: null, installation }],
      ['installation', { action: 'deleted', installation: { id: -1 } }],
      ['installation', null],
    ]
    for (const [event, payload] of bad) {
      const { response, api } = await call(delivery(event, payload))
      expect([200, 400], JSON.stringify(payload)).toContain(response.status)
      expect(api.rpcs('github_save_facts')).toHaveLength(0)
      expect(api.rpcs('github_unlink_installation')).toHaveLength(0)
      expect(api.tokenRequests()).toHaveLength(0)
    }
  })

  it('answers 400 for a signed body that is not JSON', async () => {
    const { response, api } = await call(delivery('push', null, { raw: '{not json' }))
    expect(response.status).toBe(400)
    expect(api.calls).toHaveLength(0)
  })

  it('the repo name pattern keeps a hostile name out of GitHub paths', async () => {
    const { api } = await call(delivery('push', push({ repository: { ...repository, full_name: 'acme/web?x=1#' } })))
    expect(api.calls).toHaveLength(0)
  })
})

describe('failures', () => {
  it('answers 500 with a generic body and one short log line when the database fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response } = await call(delivery('push', push()), { rpc: { github_save_facts: () => json({ code: '42501', message: `secret detail ${SERVER_KEY}` }, 403) } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0].join(' '))
    expect(line.length).toBeLessThan(120)
    for (const secret of [SERVER_KEY, SECRET, INSTALLATION_TOKEN, privateKeyPem.slice(40, 80), 'secret detail']) expect(line).not.toContain(secret)
  })

  it('answers 500 when GitHub refuses, without echoing the payload or the token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, api } = await call(delivery('push', push()), { github: () => json({ message: INSTALLATION_TOKEN }, 500) })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(INSTALLATION_TOKEN)
    expect(api.rpcs('github_save_facts')).toHaveLength(0)
    expect(String(log.mock.calls[0].join(' '))).not.toContain(INSTALLATION_TOKEN)
  })

  it('answers 500 when the installation token cannot be issued', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response } = await call(delivery('push', push()), { token: () => json({ message: 'Not Found' }, 404) })
    expect(response.status).toBe(500)
  })

  it('answers 500 when recording the delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, api } = await call(delivery('push', push()), { rpc: { github_record_delivery: () => json({ code: 'PGRST301', message: 'JWT expired' }, 401) } })
    expect(response.status).toBe(500)
    expect(api.tokenRequests()).toHaveLength(0)
  })
})
