// Raw GitHub data → (a) trimmed facts for the sync_app prompt, (b) RepoSignals for the health flags. Pure.
import type { RepoSignals } from '../../types'

export interface RepoRaw {
  meta: { id?: number; fullName: string; url: string; private: boolean; defaultBranch: string; description: string | null; pushedAt: string | null; homepage?: string | null }
  /** Latest production deployment URL (GitHub Deployments, e.g. from Vercel or Netlify), if any. */
  deployUrl?: string | null
  readme: string | null
  files: { path: string; text: string }[] // agent memory files: CLAUDE.md, AGENTS.md, progress.md, …
  paths: string[] // file tree (for secret detection)
  commits: { sha: string; message: string; author: string; date: string; url: string }[]
  pulls: { number: number; title: string; author: string; url: string; draft: boolean; createdAt?: string }[]
  issues: { number: number; title: string; url: string; labels: string[]; createdAt?: string }[]
}

export type RepoFacts = Omit<RepoRaw, 'paths' | 'deployUrl'> & { deployFile: string | null }

/** Files the agents leave behind that say what the app is and where it stands. Read in this order. */
export const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', 'memory/progress.md', 'progress.md', 'memory/task_plan.md', 'task_plan.md', 'TODO.md', 'PLAN.md', '.cursorrules']

const TEXT_CAP = 3000
const COMMITS_CAP = 30
const LIST_CAP = 20

const SECRET = [
  /(^|\/)\.env(\.[\w-]+)?$/i, // .env, .env.local, .env.production
  /\.(pem|p12|pfx|key)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/i,
  /(^|\/)(credentials|secrets?)\.json$/i,
  /(^|\/)service[-_]?account[\w-]*\.json$/i,
]
const NOT_SECRET = /\.env\.(example|sample|template|dist|defaults)$/i

export function findSecretFiles(paths: string[]): string[] {
  return paths.filter((p) => !NOT_SECRET.test(p) && SECRET.some((r) => r.test(p)))
}

const DEPLOY_FILE = /^(vercel\.json|netlify\.toml|dockerfile|fly\.toml|render\.ya?ml|procfile|wrangler\.(?:toml|jsonc?)|railway\.json|app\.ya?ml|firebase\.json|serverless\.ya?ml|cloudbuild\.ya?ml|(?:docker-)?compose\.ya?ml)$/i

/** A root deployment file from the repo tree. Nested examples do not describe how the app itself ships. */
export function findDeployFile(paths: string[]): string | null {
  return paths.find((path) => !path.includes('/') && DEPLOY_FILE.test(path)) ?? null
}

const cap = (s: string) => (s.length > TEXT_CAP ? s.slice(0, TEXT_CAP - 1) + '…' : s)

// A PEM block runs from its BEGIN line to its END line; a block cut off before the END line (a truncated README, a
// JSON string) still loses its base64 body. A header on its own, in docs, stays: the body has to follow it.
const PEM_OPEN = String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----`
const PEM_NEWLINE = String.raw`(?:\r?\n|\\n)` // a real newline, or the two characters \n inside a JSON string
const PEM_TERMINATED = new RegExp(String.raw`${PEM_OPEN}[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----`, 'g')
const PEM_UNTERMINATED = new RegExp(
  String.raw`${PEM_OPEN}(?:[ \t]*${PEM_NEWLINE}[ \t]*(?:(?:Proc-Type|DEK-Info):[^\r\n\\]*)?)*[ \t]*[A-Za-z0-9+/=]{20,}(?:[ \t]*${PEM_NEWLINE}[ \t]*[A-Za-z0-9+/=]*)*`,
  'g',
)
// Word boundaries keep ordinary words out: "task-management-dashboard" contains "sk-" but isn't a key.
const SECRET_TEXT = [
  PEM_TERMINATED,
  PEM_UNTERMINATED,
  /\bsk-(?:ant|proj|or-v1|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe secret and restricted keys
  /\bwhsec_[A-Za-z0-9]{16,}/g, // Stripe webhook signing secrets
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_\w{22,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g, // GitLab personal access tokens
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm access tokens
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, // SendGrid
  /\bya29\.[A-Za-z0-9_-]{20,}/g, // Google OAuth access tokens
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bxapp-[0-9]-[A-Za-z0-9-]{10,}/g,
  /\bhttps?:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, // Slack incoming webhooks: the URL is the credential
  /\bhttps?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+/gi, // Discord webhooks
  /\bAIza[0-9A-Za-z_-]{35,}/g,
  /\btk_[0-9a-fA-F]{32,}/g,
  /eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  // Header and payload are both base64 JSON ("eyJ…"), so a short payload or signature is still a token.
  /eyJ[A-Za-z0-9_-]{7,}\.eyJ[A-Za-z0-9_-]{2,}(?:\.[A-Za-z0-9_-]*)?/g, // JWT without a signature, or a short one
]
// Replaced up to a stable prefix, so the name stays: "AccountKey=[redacted]".
const KEEP_PREFIX: [RegExp, string][] = [
  [/\b((?:Account|SharedAccess)Key=)[^;\s"'`]+/gi, '$1[redacted]'], // Azure connection strings
  [/([?&]sig=)[A-Za-z0-9%+/=_-]{20,}/g, '$1[redacted]'], // Azure SAS signatures
  // AWS secret access keys are 40 base64 characters; "aws_secret_access_key = …", "AWS Secret Access Key: …", JSON.
  [/(\baws[_ -]?secret[_ -]?(?:access[_ -]?)?key\b[^\r\n]{0,20}?)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi, '$1[redacted]'],
]
// Credentials inside a URL: postgres://user:pass@host keeps the scheme and host. The user can be empty (redis://:pass@host).
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]*:[^\s@/]+@/gi
// curl -u user:pass / --user user:pass, on a line that runs curl. Without a password after the colon there is nothing to hide.
const CURL_USER = /(\bcurl\b[^\r\n]*?[ \t](?:-[A-Za-z]*u|--user)[ \t=]+)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+)/g
// A "- " / "* " list marker may lead the line: "- api_key: …" in a YAML list.
const ASSIGNMENT = /^([ \t]*(?:[-*][ \t]+)?(?:export[ \t]+)?)((?:"[^"\r\n]+")|(?:'[^'\r\n]+')|(?:[A-Za-z_][\w.-]*))([ \t]*[:=][ \t]*)([^\r\n]*)$/gm
// Secret-looking names anywhere in a line, in any case: "- [ ] Rotate `WEBHOOK_SECRET=…` before launch", "?api_key=…",
// {"apiKey": "…"}. The name pattern only finds candidates; isInlineSecretName decides ("DB_PASS" needs its prefix, so
// "Result PASS: ok" stays). The name has to start a token, which keeps this linear on long input.
const INLINE_ASSIGNMENT = /(^|[^\w.-])([\w.-]*(?:key|secret|token|pass|pwd|credential)[\w.-]*)(["']?\**[ \t]*[:=]\**[ \t]*)(["'`]?)([^\s"'`]+)/gi
// "Authorization: Bearer abc…", also quoted ("Authorization": "Bearer …") and inside curl -H "…".
const AUTH_HEADER = /\b(Authorization["']?[ \t]*[:=][ \t]*["'`]?)((?:(?:Bearer|Basic|Token|Digest)[ \t]+)?)([^\s"'`,]+)/gi
// curl -H "X-Api-Key: …" (the header name is checked like any other secret name).
const CURL_HEADER = /((?:-H|--header)[ \t=]+["'])([\w-]+)([ \t]*:[ \t]*)([^"'\r\n]+)/g
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)/i
// PASS / PWD / CREDENTIALS only as the last word of a name (DB_PASS, db-pwd, dbPass), never inside "bypass" or "compass".
const SECRET_NAME_END = /(?:^|[^a-z])(?:pass|passwd|pwd|credentials?)$/i
const SECRET_NAME_CAMEL = /[a-z](?:Pass|Passwd|Pwd|Credentials?)$/
const isSecretName = (name: string) => SECRET_NAME.test(name) || SECRET_NAME_END.test(name) || SECRET_NAME_CAMEL.test(name)
// Mid-line, a bare "pass" or "credentials" is just a word: it needs a prefix (DB_PASS, db-pwd, dbPass).
const SECRET_NAME_PREFIXED_END = /[a-z0-9][_-](?:pass|passwd|pwd|credentials?)$/i
const isInlineSecretName = (name: string) => SECRET_NAME.test(name) || SECRET_NAME_PREFIXED_END.test(name) || SECRET_NAME_CAMEL.test(name)
const ENV_REFERENCE = /^(?:\$(?:[A-Za-z_]\w*|\{[\w.]+\}|\{\{[^}]*\}\})|(?:process\.env|import\.meta\.env)\.[A-Za-z_]\w*)$/ // $X, ${X}, ${{ secrets.X }}
const PLACEHOLDER = /^(?:<[^>]+>|your[-_].+|x{3,}.*|changeme|\.\.\.)$/i
// "credentials: 'include'" is a fetch option, not a credential.
// Type names ("apiKey: string") are not values either.
const NOT_A_SECRET = /^(?:\d+|true|false|null|undefined|none|include|omit|same-origin|string|number|boolean|unknown|object|required|optional)$/i
// A value of 6+ characters under a secret-looking name is redacted; lists, objects, numbers, booleans, placeholders and
// env references aren't ("keywords: [a, b]", "primaryKey: true", "max_tokens: 4096"). When in doubt, redact: losing a
// word costs the AI little, a leaked key costs a lot.
const isSecret = (v: string) =>
  v.trim().length >= 6 && !/^[[{(<]/.test(v) && !NOT_A_SECRET.test(v) && !PLACEHOLDER.test(v) && !ENV_REFERENCE.test(v)

// Markdown table rows: "| API_KEY | value |". Header rows ("| Key | Description |", followed by "|---|---|") are skipped;
// the value has to be a single token, so a description column ("Your key from the dashboard") stays.
const TABLE_NAME = /^\s*`?([A-Za-z_][\w.-]*)`?\s*$/
const TABLE_VALUE = /^(\s*[`"']?)([^\s`"'|]+)([`"']?\s*)$/
const TABLE_RULE = /^[ \t]*\|?[ \t:|-]*-[ \t:|-]*$/
function redactTableRows(text: string): string {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (!/^[ \t]*\|/.test(line) || TABLE_RULE.test((lines[i + 1] ?? '').replace(/\r$/, ''))) return line
    const cells = line.split('|')
    for (let c = 1; c < cells.length - 1; c++) {
      const name = cells[c].match(TABLE_NAME)?.[1]
      const value = cells[c + 1].match(TABLE_VALUE)
      if (name && isSecretName(name) && value && isSecret(value[2])) cells[c + 1] = `${value[1]}[redacted]${value[3]}`
    }
    return cells.join('|')
  }).join('\n')
}

/** Remove credentials from repo prose before it can enter an AI prompt. */
export function redactSecrets(s: string): string {
  let redacted = s
  for (const pattern of SECRET_TEXT) redacted = redacted.replace(pattern, '[redacted]')
  for (const [pattern, replacement] of KEEP_PREFIX) redacted = redacted.replace(pattern, replacement)
  redacted = redacted.replace(URL_CREDENTIALS, '$1[redacted]@')
  redacted = redacted.replace(CURL_USER, (match, lead: string, raw: string) => {
    const value = raw.replace(/^["']|["']$/g, '')
    const password = value.slice(value.indexOf(':') + 1)
    // "-u user" has no password; "-u $USER:$PASS" and "-u <user>:<pass>" are templates.
    return value.includes(':') && password && !/^[$<{]/.test(password) ? `${lead}[redacted]` : match
  })
  redacted = redacted.replace(AUTH_HEADER, (match, lead: string, scheme: string, value: string) => {
    // With a scheme ("Bearer x") the token is a word-less blob; without one it needs a digit, so "Authorization: see the docs" stays.
    const credential = scheme ? value.length >= 12 && !/^[a-z]+$/.test(value) : /\d/.test(value)
    return credential && isSecret(value) ? `${lead}${scheme}[redacted]` : match
  })
  redacted = redacted.replace(CURL_HEADER, (match, lead: string, name: string, separator: string, value: string) =>
    isSecretName(name) && isSecret(value.trim()) ? `${lead}${name}${separator}[redacted]` : match)
  redacted = redacted.replace(ASSIGNMENT, (match, lead: string, rawName: string, separator: string, rest: string) => {
    const name = rawName.replace(/^["']|["']$/g, '')
    if (!isSecretName(name)) return match
    const quoted = rest.match(/^(["'])(.*?)\1(.*)$/)
    if (quoted) return isSecret(quoted[2]) ? `${lead}${rawName}${separator}${quoted[1]}[redacted]${quoted[1]}${quoted[3]}` : match
    // Unquoted: the value is the first token; a note after it ("(rotate before launch)", "# comment") stays.
    let value = rest.match(/^\S+/)?.[0] ?? ''
    if (value.endsWith(',')) value = value.slice(0, -1)
    return isSecret(value) ? `${lead}${rawName}${separator}[redacted]${rest.slice(value.length)}` : match
  })
  redacted = redactTableRows(redacted)
  return redacted.replace(INLINE_ASSIGNMENT, (match, lead: string, name: string, separator: string, quote: string, value: string) =>
    isInlineSecretName(name) && isSecret(value) ? `${lead}${name}${separator}${quote}[redacted]` : match)
}

/** redactSecrets over every string in a JSON-shaped value (keys are ours and stay). Applied last, to whatever leaves for an AI provider. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)])) as T
  return value
}

export function repoFacts(raw: RepoRaw, now: string): { facts: RepoFacts; signals: RepoSignals } {
  const commits = raw.commits.slice(0, COMMITS_CAP).map((c) => ({ ...c, sha: c.sha.slice(0, 7), message: redactSecrets(c.message.split('\n')[0]).slice(0, 200) }))
  const facts: RepoFacts = {
    meta: { ...raw.meta, description: raw.meta.description === null ? null : redactSecrets(raw.meta.description) },
    readme: raw.readme === null ? null : cap(redactSecrets(raw.readme)),
    files: raw.files.slice(0, 4).map((f) => ({ path: f.path, text: cap(redactSecrets(f.text)) })),
    deployFile: findDeployFile(raw.paths),
    commits,
    pulls: raw.pulls.slice(0, LIST_CAP).map((p) => ({ ...p, title: redactSecrets(p.title) })),
    issues: raw.issues.slice(0, LIST_CAP).map((i) => ({ ...i, title: redactSecrets(i.title) })),
  }
  const signals: RepoSignals = {
    hasReadme: raw.readme !== null,
    secretFiles: findSecretFiles(raw.paths),
    lastCommitAt: raw.commits[0]?.date ?? null,
    openIssues: raw.issues.length,
    openPrs: raw.pulls.length,
    syncedAt: now,
    liveUrl: webUrl(raw.meta.homepage) ?? webUrl(raw.deployUrl),
  }
  return { facts, signals }
}

/** A link people can open: http(s) only; a bare domain gets https://. */
function webUrl(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().replace(/\/$/, '') : null
  } catch {
    return null
  }
}
