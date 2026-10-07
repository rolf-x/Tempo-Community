// Shared pieces of the setup helpers (github-app.mjs, vercel-env.mjs). Node built-ins only, no packages.
// Secrets are handled here and never printed: they go from GitHub's answer to a file only you can read, and from
// there to Vercel over stdin, never as a command-line argument.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** What Tempo's GitHub App may do: read only. Webhooks for pushes and repo renames keep cards fresh. */
export const APP_PERMISSIONS = Object.freeze({
  contents: 'read',
  deployments: 'read',
  emails: 'read',
  issues: 'read',
  members: 'read',
  metadata: 'read',
  pull_requests: 'read',
})
export const APP_EVENTS = Object.freeze(['push', 'repository'])

/** `--name value` and `--flag` into an object. Unknown options are refused, so a typo doesn't pass silently. */
export function parseArgs(argv, { values = [], flags = [] }) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`)
    if (flags.includes(key)) out[key] = true
    else if (values.includes(key)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
      out[key] = value
    } else throw new Error(`Unknown option: --${key}`)
  }
  return out
}

/** An https origin such as https://tempo.example.com, without a path. */
export function httpsOrigin(value, what) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw new Error(`${what} must be a full https address, such as https://example.com`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${what} must be a plain https address with no path, such as https://example.com`)
  }
  return url.origin
}

const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

/** Where GitHub's "register a GitHub App from a manifest" form lives, for a person or for an organization. */
export function newAppUrl({ org, state }) {
  if (org !== undefined && !ORG.test(org)) throw new Error('--org must be a GitHub organization name')
  const base = org ? `https://github.com/organizations/${org}/settings/apps/new` : 'https://github.com/settings/apps/new'
  return `${base}?state=${encodeURIComponent(state)}`
}

/** The GitHub App manifest: everything GitHub's form would ask, filled in for this Tempo. */
export function buildManifest({ domain, supabase, redirectUrl, name = 'Tempo', isPublic = true }) {
  const site = httpsOrigin(domain, '--domain')
  const auth = httpsOrigin(supabase, '--supabase')
  const appName = String(name).trim()
  if (!appName || appName.length > 34) throw new Error('--name must be 1 to 34 characters (GitHub\'s limit)')
  return {
    name: appName,
    url: site,
    description: 'Read-only: Tempo reads repo names, dates and counts to keep its app cards up to date.',
    hook_attributes: { url: `${site}/api/github-webhook`, active: true },
    redirect_url: redirectUrl,
    callback_urls: [`${auth}/auth/v1/callback`],
    public: Boolean(isPublic),
    request_oauth_on_install: false,
    setup_on_update: false,
    default_permissions: { ...APP_PERMISSIONS },
    default_events: [...APP_EVENTS],
  }
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The local page that sends the manifest to GitHub. One button; it also submits itself. */
export function manifestPage({ action, manifest }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Create Tempo's GitHub App</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.6rem 1.2rem}</style></head>
<body><h1>Create Tempo's GitHub App</h1>
<p>GitHub opens with every setting filled in. Check the name, then press <b>Create GitHub App</b>.</p>
<form id="f" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Continue to GitHub</button></form>
<script>document.getElementById('f').submit()</script></body></html>`
}

export const newState = () => randomBytes(24).toString('hex')

/**
 * The local server answers only requests addressed to itself. A web page that points its own domain at 127.0.0.1
 * (DNS rebinding) sends its own name in Host, so it can't read the page or the state.
 */
export function allowedHost(host, port) {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}` || host === `[::1]:${port}`
}

/** Compares the state GitHub sent back with ours in constant time. */
export function sameState(expected, received) {
  if (typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

const CODE = /^[A-Za-z0-9_-]{1,200}$/

/** Trades the one-time code from GitHub's redirect for the new App's id, keys and secrets. */
export async function exchangeCode(code, { fetch = globalThis.fetch } = {}) {
  if (typeof code !== 'string' || !CODE.test(code)) throw new Error('GitHub sent back a code Tempo does not recognise')
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'tempo-setup' },
  })
  if (response.status !== 201) throw new Error(`GitHub refused the code (HTTP ${response.status}). Codes work once and for an hour: run the helper again.`)
  const app = await response.json()
  for (const key of ['id', 'slug', 'client_id', 'client_secret', 'webhook_secret', 'pem']) {
    if (!app?.[key]) throw new Error(`GitHub's answer is missing ${key}`)
  }
  return {
    id: String(app.id),
    slug: String(app.slug),
    owner: app.owner?.login ? String(app.owner.login) : null,
    html_url: app.html_url ? String(app.html_url) : null,
    client_id: String(app.client_id),
    client_secret: String(app.client_secret),
    webhook_secret: String(app.webhook_secret),
    pem: String(app.pem),
  }
}

export const SETUP_DIR = '.tempo-setup'
export const APP_FILE = 'github-app.json'

/**
 * Saves the App's keys where only this user can read them. Refuses to overwrite an earlier App unless asked to.
 * Writes are exclusive (`wx`), and a replacement goes to a new file that is then renamed over the old one, so a
 * symlink planted at either path is never followed.
 */
export function saveAppFile(root, app, { replace = false } = {}) {
  const dir = path.join(root, SETUP_DIR)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!fs.lstatSync(dir).isDirectory()) throw new Error(`${SETUP_DIR} must be a plain folder, not a link`)
  fs.chmodSync(dir, 0o700)
  const file = path.join(dir, APP_FILE)
  const text = `${JSON.stringify(app, null, 2)}\n`
  if (!replace) {
    try {
      fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`${path.join(SETUP_DIR, APP_FILE)} already holds an App's keys. Move it away, or pass --replace.`)
      throw error
    }
    return file
  }
  const temp = path.join(dir, `.${APP_FILE}.${randomBytes(6).toString('hex')}`)
  fs.writeFileSync(temp, text, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temp, file)
  return file
}

export function readAppFile(root) {
  const file = path.join(root, SETUP_DIR, APP_FILE)
  let app
  try {
    app = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`No GitHub App keys at ${path.join(SETUP_DIR, APP_FILE)}. Run scripts/setup/github-app.mjs first.`)
  }
  for (const key of ['id', 'slug', 'client_id', 'client_secret', 'webhook_secret', 'pem']) {
    if (!app?.[key]) throw new Error(`${path.join(SETUP_DIR, APP_FILE)} is missing ${key}`)
  }
  return app
}

/** What the helper may print about the new App: names and public ids, never a secret. */
export function appSummary(app, { org } = {}) {
  const settings = org ? `https://github.com/organizations/${org}/settings/apps/${app.slug}` : `https://github.com/settings/apps/${app.slug}`
  return [
    `Created the GitHub App "${app.slug}" (App ID ${app.id}, client ID ${app.client_id}).`,
    `Its settings: ${settings}`,
    `Keys saved to ${path.join(SETUP_DIR, APP_FILE)}; only your user can read it, and git ignores it.`,
    `Next: install it on the account or organization whose repos Tempo should see: https://github.com/apps/${app.slug}/installations/new`,
    'Then: node scripts/setup/vercel-env.mjs --site-url https://<your site> --supabase-url https://<ref>.supabase.co --anon-key <anon key> --contact-email <you@yourcompany.com>',
  ]
}

/** Vercel keeps a key on one line, so the PEM's line breaks become the two characters `\n` (the server undoes it). */
export const oneLinePem = (pem) => pem.trim().replace(/\r?\n/g, '\\n')

export const sha256Hex = (text) => createHash('sha256').update(text).digest('hex')

export const AI_MODES = ['legacy', 'both', 'mcp']

/**
 * Every variable a hosted Tempo needs, with its value and whether Vercel should treat it as a secret. The three
 * server secrets are made fresh here. VITE_CONTACT_EMAIL is set only when given. Optional ones (SUPABASE_URL,
 * SUPABASE_ANON_KEY, VITE_GITHUB_CLIENT_ID, VITE_AI_LOCAL_ONLY) are left out: the code falls back or doesn't need them
 * in production.
 */
export function envPlan(app, { supabaseUrl, anonKey, siteUrl, contactEmail, aiMode = 'both' }, random = randomBytes) {
  const url = httpsOrigin(supabaseUrl, '--supabase-url')
  const site = httpsOrigin(siteUrl, '--site-url')
  if (typeof anonKey !== 'string' || !anonKey.trim()) throw new Error('--anon-key is required (Supabase → Settings → API)')
  if (!AI_MODES.includes(aiMode)) throw new Error(`--ai-mode must be one of ${AI_MODES.join(', ')}`)
  const email = contactEmail === undefined ? null : String(contactEmail).trim()
  if (email !== null && !/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(email)) throw new Error('--contact-email must be an email address')
  const serverKey = random(48).toString('base64')
  const vars = [
    { name: 'VITE_SITE_URL', value: site, sensitive: false },
    ...(email ? [{ name: 'VITE_CONTACT_EMAIL', value: email, sensitive: false }] : []),
    { name: 'VITE_SUPABASE_URL', value: url, sensitive: false },
    { name: 'VITE_SUPABASE_ANON_KEY', value: anonKey.trim(), sensitive: false },
    { name: 'VITE_GITHUB_APP_SLUG', value: app.slug, sensitive: false },
    { name: 'VITE_AI_MODE', value: aiMode, sensitive: false },
    { name: 'GITHUB_APP_ID', value: String(app.id), sensitive: false },
    { name: 'GITHUB_APP_CLIENT_ID', value: app.client_id, sensitive: false },
    { name: 'GITHUB_APP_CLIENT_SECRET', value: app.client_secret, sensitive: true },
    { name: 'GITHUB_APP_PRIVATE_KEY', value: oneLinePem(app.pem), sensitive: true },
    { name: 'GITHUB_WEBHOOK_SECRET', value: app.webhook_secret, sensitive: true },
    { name: 'GITHUB_TOKEN_KEY', value: random(32).toString('base64'), sensitive: true },
    { name: 'TEMPO_SERVER_KEY', value: serverKey, sensitive: true },
    { name: 'CRON_SECRET', value: random(32).toString('hex'), sensitive: true },
  ]
  return { vars, serverKeyHash: sha256Hex(serverKey) }
}

export const TARGETS = ['production', 'preview', 'development']

/** Hides a secret if a tool's message ever repeats it. */
const scrub = (text, secret) => (secret && secret.length >= 4 ? text.split(secret).join('[hidden]') : text)

/**
 * The full path of vercel.cmd on Windows, from PATH only. cmd.exe would otherwise try the current folder first, so a
 * vercel.cmd dropped into the repo could run instead of the real one.
 */
export function windowsVercel({ pathEnv = process.env.PATH ?? '', cwd = process.cwd(), exists = fs.existsSync } = {}) {
  const here = path.win32.resolve(cwd).toLowerCase()
  for (const dir of pathEnv.split(';')) {
    if (!dir.trim() || dir.trim() === '.' || path.win32.resolve(cwd, dir.trim()).toLowerCase() === here) continue
    const candidate = path.win32.join(dir.trim(), 'vercel.cmd')
    if (path.win32.isAbsolute(candidate) && exists(candidate)) return candidate
  }
  return null
}

/**
 * `vercel env add NAME TARGET` with the value on stdin. The value is never an argument, so it doesn't show up in
 * the process list or shell history. Without `replace`, an existing variable is left alone. For a secret, nothing the
 * CLI says is shown, in case an error repeats part of the value.
 */
export function addEnv({ name, value, sensitive, target = 'production', replace = false }, { spawn, platform = process.platform, findWindowsVercel = windowsVercel }) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad variable name: ${name}`)
  if (!TARGETS.includes(target)) throw new Error(`--target must be one of ${TARGETS.join(', ')}`)
  const args = ['env', 'add', name, target, sensitive ? '--sensitive' : '--no-sensitive', '--yes', ...(replace ? ['--force'] : [])]
  const windows = platform === 'win32'
  // Windows can only start a .cmd through the shell. It gets the full path found on PATH, quoted, and arguments that
  // are all fixed or checked above; the value never goes through the shell.
  const command = windows ? findWindowsVercel() : 'vercel'
  if (!command) return Promise.resolve({ name, ok: false, message: 'could not find vercel.cmd on PATH (install the Vercel CLI)' })
  return new Promise((resolve) => {
    let output = ''
    let child
    try {
      child = spawn(windows ? `"${command}"` : command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: windows })
    } catch (error) {
      resolve({ name, ok: false, message: `could not run vercel: ${error.message}` })
      return
    }
    const collect = (chunk) => { output += chunk.toString() }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (error) => resolve({ name, ok: false, message: `could not run vercel: ${error.message}` }))
    child.on('close', (code) => {
      const said = sensitive ? '' : scrub(output, value).trim().split('\n').filter(Boolean).pop() ?? ''
      if (code === 0) resolve({ name, ok: true, message: 'set' })
      else if (/already exists/i.test(output)) resolve({ name, ok: false, skipped: true, message: 'already set, left as is (pass --replace to overwrite)' })
      else if (sensitive) resolve({ name, ok: false, message: `vercel exited with code ${code} (its output is hidden because the value is secret; try: vercel env add ${name} ${target})` })
      else resolve({ name, ok: false, message: said || `vercel exited with code ${code}` })
    })
    child.stdin?.end(value)
  })
}
