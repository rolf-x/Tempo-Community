import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  APP_FILE, SETUP_DIR, addEnv, allowedHost, appSummary, buildManifest, envPlan, exchangeCode, manifestPage, newAppUrl,
  oneLinePem, parseArgs, readAppFile, sameState, saveAppFile, sha256Hex, windowsVercel,
} from './lib.mjs'

const APP = {
  id: '123456', slug: 'tempo-acme', owner: 'acme', html_url: 'https://github.com/apps/tempo-acme',
  client_id: 'Iv23liFAKECLIENT', client_secret: 'fake-client-secret-0123456789abcdef',
  webhook_secret: 'fake-webhook-secret-0123456789', pem: '-----BEGIN RSA PRIVATE KEY-----\nFAKEKEYLINE1\nFAKEKEYLINE2\n-----END RSA PRIVATE KEY-----\n',
}
const SECRETS = [APP.client_secret, APP.webhook_secret, 'FAKEKEYLINE1']

const manifest = (over = {}) => buildManifest({ domain: 'https://tempo.example.com', supabase: 'https://abcd.supabase.co', redirectUrl: 'http://localhost:4000/done', ...over })

describe('the GitHub App manifest', () => {
  it('asks for read access only, and the two webhook events Tempo handles', () => {
    const m = manifest()
    expect(Object.values(m.default_permissions).every((level) => level === 'read')).toBe(true)
    expect(Object.keys(m.default_permissions).sort()).toEqual(['contents', 'deployments', 'emails', 'issues', 'members', 'metadata', 'pull_requests'])
    expect(m.default_events).toEqual(['push', 'repository'])
  })

  it('points sign-in at Supabase and the webhook at the site', () => {
    const m = manifest()
    expect(m.callback_urls).toEqual(['https://abcd.supabase.co/auth/v1/callback'])
    expect(m.hook_attributes).toEqual({ url: 'https://tempo.example.com/api/github-webhook', active: true })
    expect(m.url).toBe('https://tempo.example.com')
    expect(m.redirect_url).toBe('http://localhost:4000/done')
    expect(m.request_oauth_on_install).toBe(false)
    expect(m.public).toBe(true)
    expect(manifest({ isPublic: false }).public).toBe(false)
  })

  it('refuses addresses that are not plain https origins', () => {
    expect(() => manifest({ domain: 'http://tempo.example.com' })).toThrow(/https/)
    expect(() => manifest({ domain: 'https://tempo.example.com/app' })).toThrow(/no path/)
    expect(() => manifest({ supabase: 'not a url' })).toThrow(/https/)
    expect(() => manifest({ name: 'x'.repeat(35) })).toThrow(/34/)
  })

  it('sends the manifest from an escaped form, so a name cannot break out of the page', () => {
    const html = manifestPage({ action: newAppUrl({ state: 'abc' }), manifest: manifest({ name: '"><script>x</script>' }) })
    expect(html).not.toContain('"><script>x')
    expect(html).toContain('&quot;&gt;&lt;script&gt;x')
    expect(html).toContain('action="https://github.com/settings/apps/new?state=abc"')
  })

  it('builds the organization form address only for a valid organization name', () => {
    expect(newAppUrl({ org: 'acme-labs', state: 's' })).toBe('https://github.com/organizations/acme-labs/settings/apps/new?state=s')
    expect(() => newAppUrl({ org: '../evil', state: 's' })).toThrow(/organization/)
  })
})

describe('the redirect back from GitHub', () => {
  it('answers only requests addressed to the local server itself (no DNS rebinding)', () => {
    expect(allowedHost('localhost:4000', 4000)).toBe(true)
    expect(allowedHost('127.0.0.1:4000', 4000)).toBe(true)
    expect(allowedHost('evil.example:4000', 4000)).toBe(false)
    expect(allowedHost('localhost:4001', 4000)).toBe(false)
    expect(allowedHost(undefined, 4000)).toBe(false)
  })

  it('accepts only the exact state this run made', () => {
    expect(sameState('a'.repeat(48), 'a'.repeat(48))).toBe(true)
    expect(sameState('a'.repeat(48), 'b'.repeat(48))).toBe(false)
    expect(sameState('a'.repeat(48), 'a')).toBe(false)
    expect(sameState('a'.repeat(48), null)).toBe(false)
  })

  it('trades the code once, with a POST to GitHub', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...APP, id: 123456, owner: { login: 'acme' } }), { status: 201 }))
    const app = await exchangeCode('abc123', { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/app-manifests/abc123/conversions')
    expect(fetch.mock.calls[0][1].method).toBe('POST')
    expect(app).toMatchObject({ id: '123456', slug: 'tempo-acme', owner: 'acme', client_secret: APP.client_secret })
  })

  it('never calls GitHub with a malformed code, and explains a refusal without echoing the answer', async () => {
    const fetch = vi.fn()
    await expect(exchangeCode('../../user', { fetch })).rejects.toThrow(/code/)
    expect(fetch).not.toHaveBeenCalled()
    const refused = vi.fn(async () => new Response('{"message":"secret-ish detail"}', { status: 404 }))
    await expect(exchangeCode('abc', { fetch: refused })).rejects.toThrow(/HTTP 404/)
    await expect(exchangeCode('abc', { fetch: refused })).rejects.not.toThrow(/secret-ish/)
  })
})

describe('the saved keys', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-setup-test-'))

  it('are readable by this user only', () => {
    const root = tmp()
    const file = saveAppFile(root, APP)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.join(root, SETUP_DIR)).mode & 0o777).toBe(0o700)
    expect(readAppFile(root)).toEqual(APP)
  })

  it('are not overwritten by a second run unless asked', () => {
    const root = tmp()
    saveAppFile(root, APP)
    expect(() => saveAppFile(root, { ...APP, slug: 'other' })).toThrow(/--replace/)
    saveAppFile(root, { ...APP, slug: 'other' }, { replace: true })
    expect(readAppFile(root).slug).toBe('other')
  })

  it('never follow a link planted where the file goes', () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, SETUP_DIR), { mode: 0o700 })
    const victim = path.join(root, 'victim.txt')
    fs.writeFileSync(victim, 'keep me')
    fs.symlinkSync(victim, path.join(root, SETUP_DIR, APP_FILE))
    expect(() => saveAppFile(root, APP)).toThrow(/--replace/)
    saveAppFile(root, APP, { replace: true })
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep me')
    expect(fs.lstatSync(path.join(root, SETUP_DIR, APP_FILE)).isSymbolicLink()).toBe(false)
    expect(fs.statSync(path.join(root, SETUP_DIR, APP_FILE)).mode & 0o777).toBe(0o600)
  })

  it('refuse a setup folder that is a link', () => {
    const root = tmp()
    fs.symlinkSync(tmp(), path.join(root, SETUP_DIR))
    expect(() => saveAppFile(root, APP)).toThrow(/plain folder/)
  })

  it('give a clear message when missing', () => {
    expect(() => readAppFile(tmp())).toThrow(new RegExp(`${SETUP_DIR}/${APP_FILE}`))
  })

  it('never appear in what the helper prints', () => {
    const printed = appSummary(APP).join('\n')
    for (const secret of SECRETS) expect(printed).not.toContain(secret)
    expect(printed).toContain('tempo-acme')
  })

  it('link to the App settings page, for an account or an organization', () => {
    expect(appSummary(APP).join('\n')).toContain('Its settings: https://github.com/settings/apps/tempo-acme')
    expect(appSummary(APP, { org: 'acme-labs' }).join('\n')).toContain('Its settings: https://github.com/organizations/acme-labs/settings/apps/tempo-acme')
  })
})

describe('the Vercel variables', () => {
  const random = (n) => Buffer.alloc(n, 7)
  const base = { siteUrl: 'https://tempo.example.com', supabaseUrl: 'https://abcd.supabase.co', anonKey: 'anon-public-key' }
  const plan = (over = {}) => envPlan(APP, { ...base, ...over }, random)

  it('covers everything a hosted Tempo needs, secrets marked as secrets', () => {
    const { vars } = plan({ contactEmail: 'privacy@acme.example' })
    expect(vars.map((v) => v.name)).toEqual([
      'VITE_SITE_URL', 'VITE_CONTACT_EMAIL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_GITHUB_APP_SLUG', 'VITE_AI_MODE', 'GITHUB_APP_ID', 'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_TOKEN_KEY', 'TEMPO_SERVER_KEY', 'CRON_SECRET',
    ])
    const secret = Object.fromEntries(vars.map((v) => [v.name, v.sensitive]))
    for (const name of ['GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_TOKEN_KEY', 'TEMPO_SERVER_KEY', 'CRON_SECRET']) {
      expect(secret[name]).toBe(true)
    }
    expect(vars.find((v) => v.name === 'VITE_AI_MODE').value).toBe('both')
    expect(vars.find((v) => v.name === 'VITE_SITE_URL').value).toBe('https://tempo.example.com')
    expect(vars.find((v) => v.name === 'VITE_CONTACT_EMAIL').value).toBe('privacy@acme.example')
  })

  it('leaves the contact email out when none is given', () => {
    expect(plan().vars.map((v) => v.name)).not.toContain('VITE_CONTACT_EMAIL')
  })

  it('makes keys in the formats the server checks', () => {
    const { vars, serverKeyHash } = plan()
    const value = (name) => vars.find((v) => v.name === name).value
    expect(Buffer.from(value('GITHUB_TOKEN_KEY'), 'base64')).toHaveLength(32)
    expect(value('TEMPO_SERVER_KEY').length).toBeGreaterThanOrEqual(32)
    expect(serverKeyHash).toBe(sha256Hex(value('TEMPO_SERVER_KEY')))
    expect(value('GITHUB_APP_PRIVATE_KEY')).toBe(oneLinePem(APP.pem))
    expect(value('GITHUB_APP_PRIVATE_KEY')).not.toContain('\n')
  })

  it('refuses a bad address, a missing anon key, a bad email or an unknown AI mode', () => {
    expect(() => plan({ supabaseUrl: 'http://abcd.supabase.co' })).toThrow(/https/)
    expect(() => plan({ siteUrl: 'https://tempo.example.com/app' })).toThrow(/site-url/)
    expect(() => plan({ siteUrl: undefined })).toThrow(/site-url/)
    expect(() => plan({ anonKey: ' ' })).toThrow(/anon-key/)
    expect(() => plan({ contactEmail: 'not an email' })).toThrow(/contact-email/)
    expect(() => plan({ aiMode: 'gpt' })).toThrow(/ai-mode/)
  })
})

/** A stand-in for child_process.spawn: records the arguments and what arrives on stdin, then exits as told. */
function fakeSpawn({ code = 0, output = '' } = {}) {
  const calls = []
  const spawn = (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const call = { command, args, options, stdin: '' }
    calls.push(call)
    child.stdin = {
      end(value) {
        call.stdin = value
        queueMicrotask(() => {
          if (output) child.stderr.emit('data', Buffer.from(typeof output === 'function' ? output(value) : output))
          child.emit('close', code)
        })
      },
    }
    return child
  }
  return { spawn, calls }
}

describe('adding a variable to Vercel', () => {
  const secret = 'top-secret-value-123'

  it('sends the value over stdin, never as an argument', async () => {
    const { spawn, calls } = fakeSpawn()
    const result = await addEnv({ name: 'CRON_SECRET', value: secret, sensitive: true }, { spawn, platform: 'darwin' })
    expect(result).toEqual({ name: 'CRON_SECRET', ok: true, message: 'set' })
    expect(calls[0].command).toBe('vercel')
    expect(calls[0].args).toEqual(['env', 'add', 'CRON_SECRET', 'production', '--sensitive', '--yes'])
    expect(calls[0].args.join(' ')).not.toContain(secret)
    expect(calls[0].stdin).toBe(secret)
    expect(calls[0].options.shell).toBe(false)
  })

  it('overwrites only when asked, and leaves an existing variable alone otherwise', async () => {
    const replace = fakeSpawn()
    await addEnv({ name: 'VITE_AI_MODE', value: 'both', sensitive: false, replace: true }, { spawn: replace.spawn, platform: 'linux' })
    expect(replace.calls[0].args).toEqual(['env', 'add', 'VITE_AI_MODE', 'production', '--no-sensitive', '--yes', '--force'])
    const exists = fakeSpawn({ code: 1, output: 'Error: The variable "CRON_SECRET" already exists' })
    const result = await addEnv({ name: 'CRON_SECRET', value: secret, sensitive: true }, { spawn: exists.spawn, platform: 'linux' })
    expect(result.skipped).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('shows nothing the CLI says about a secret, not even part of it', async () => {
    const { spawn } = fakeSpawn({ code: 1, output: (value) => `Error: invalid value ${value.slice(0, 8)}…` })
    const result = await addEnv({ name: 'CRON_SECRET', value: secret, sensitive: true }, { spawn, platform: 'linux' })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain(secret.slice(0, 8))
    expect(result.message).toMatch(/hidden because the value is secret/)
  })

  it('hides a non-secret value too if the CLI repeats it', async () => {
    const { spawn } = fakeSpawn({ code: 1, output: (value) => `Error: invalid value ${value}` })
    const result = await addEnv({ name: 'VITE_AI_MODE', value: 'both-and-more', sensitive: false }, { spawn, platform: 'linux' })
    expect(result.message).toBe('Error: invalid value [hidden]')
  })

  it('on Windows, runs vercel.cmd from PATH only, never from the current folder', async () => {
    const exists = (file) => ['C:\\repo\\vercel.cmd', 'C:\\tools\\vercel.cmd'].includes(file)
    expect(windowsVercel({ pathEnv: '.;C:\\repo;C:\\tools', cwd: 'C:\\repo', exists })).toBe('C:\\tools\\vercel.cmd')
    expect(windowsVercel({ pathEnv: 'C:\\repo', cwd: 'C:\\repo', exists })).toBe(null)
    const { spawn, calls } = fakeSpawn()
    await addEnv({ name: 'CRON_SECRET', value: secret, sensitive: true }, { spawn, platform: 'win32', findWindowsVercel: () => 'C:\\tools\\vercel.cmd' })
    expect(calls[0].command).toBe('"C:\\tools\\vercel.cmd"')
    expect(calls[0].options.shell).toBe(true)
    expect(calls[0].args.join(' ')).not.toContain(secret)
    const missing = await addEnv({ name: 'CRON_SECRET', value: secret, sensitive: true }, { spawn, platform: 'win32', findWindowsVercel: () => null })
    expect(missing).toMatchObject({ ok: false, message: expect.stringMatching(/PATH/) })
  })

  it('refuses odd variable names and targets before running anything', () => {
    const { spawn, calls } = fakeSpawn()
    expect(() => addEnv({ name: 'X; rm -rf /', value: 'v', sensitive: false }, { spawn })).toThrow(/name/)
    expect(() => addEnv({ name: 'X', value: 'v', sensitive: false, target: 'prod && echo' }, { spawn })).toThrow(/target/)
    expect(calls).toHaveLength(0)
  })
})

describe('command-line options', () => {
  it('reads values and flags, and refuses unknown or empty ones', () => {
    const spec = { values: ['domain'], flags: ['dry-run'] }
    expect(parseArgs(['--domain', 'https://x.example', '--dry-run'], spec)).toEqual({ domain: 'https://x.example', 'dry-run': true })
    expect(() => parseArgs(['--domian', 'x'], spec)).toThrow(/Unknown/)
    expect(() => parseArgs(['--domain'], spec)).toThrow(/needs a value/)
    expect(() => parseArgs(['stray'], spec)).toThrow(/Unexpected/)
  })
})
