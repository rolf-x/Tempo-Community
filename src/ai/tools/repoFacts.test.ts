import { describe, expect, it } from 'vitest'
import { findDeployFile, findSecretFiles, redactSecrets, repoFacts, type RepoRaw } from './repoFacts'

const NOW = '2026-10-03T12:00:00.000Z'
const raw = (over: Partial<RepoRaw> = {}): RepoRaw => ({
  meta: { fullName: 'acme/app', url: 'https://github.com/acme/app', private: true, defaultBranch: 'main', description: 'An app', pushedAt: NOW },
  readme: '# App\n\nDoes things.',
  files: [{ path: 'CLAUDE.md', text: 'Build an expense bot.' }],
  paths: ['README.md', 'src/index.ts', 'CLAUDE.md'],
  commits: [{ sha: 'abc1234def', message: 'feat: x\n\nbody', author: 'sam', date: NOW, url: 'https://github.com/acme/app/commit/abc1234def' }],
  pulls: [{ number: 3, title: 'Add y', author: 'nadia', url: 'u3', draft: false }],
  issues: [{ number: 7, title: 'Bug z', url: 'u7', labels: ['bug'] }],
  ...over,
})

describe('findSecretFiles', () => {
  it('finds .env variants, keys and credential files', () => {
    expect(findSecretFiles(['.env', 'api/.env.production', 'certs/server.pem', 'id_rsa', 'gcp/service-account.json', 'credentials.json'])).toEqual(
      ['.env', 'api/.env.production', 'certs/server.pem', 'id_rsa', 'gcp/service-account.json', 'credentials.json'],
    )
  })
  it('ignores examples and templates', () => {
    expect(findSecretFiles(['.env.example', '.env.sample', '.env.template', 'docs/env.md', 'src/environment.ts'])).toEqual([])
  })
})

describe('findDeployFile', () => {
  it('finds common deployment files at the repo root', () => {
    for (const name of ['vercel.json', 'netlify.toml', 'Dockerfile', 'fly.toml', 'render.yaml', 'Procfile', 'wrangler.toml']) {
      expect(findDeployFile(['src/index.ts', name]), name).toBe(name)
    }
  })

  it('ignores nested deployment examples', () => {
    expect(findDeployFile(['examples/vercel.json', 'docker/Dockerfile'])).toBeNull()
  })
})

describe('redactSecrets', () => {
  it('redacts Anthropic keys', () => {
    const secret = 'sk-' + 'ant-' + 'a'.repeat(40)
    expect(redactSecrets(`key: ${secret}`)).toBe('key: [redacted]')
  })

  it('redacts basic OpenAI keys', () => {
    const secret = 'sk-' + 'b'.repeat(20)
    expect(redactSecrets(`Use ${secret} here`)).toBe('Use [redacted] here')
  })

  it('redacts project-scoped OpenAI keys', () => {
    const secret = 'sk-' + 'proj-' + 'c'.repeat(24)
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts OpenRouter keys', () => {
    const secret = 'sk-' + 'or-v1-' + 'd'.repeat(24)
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts GitHub legacy tokens', () => {
    for (const kind of ['p', 'o', 'u', 's', 'r']) {
      const secret = 'gh' + kind + '_' + 'e'.repeat(36)
      expect(redactSecrets(secret)).toBe('[redacted]')
    }
  })

  it('redacts GitHub fine-grained tokens', () => {
    const fineGrained = 'github_' + 'pat_' + 'f'.repeat(22)
    expect(redactSecrets(fineGrained)).toBe('[redacted]')
  })

  it('redacts AWS access key ids', () => {
    const secret = 'AK' + 'IA' + 'G'.repeat(16)
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts Slack tokens', () => {
    const secret = 'xox' + 'b-' + '1234567890-abcdefghij'
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts Google API keys', () => {
    const secret = 'AI' + 'za' + 'H'.repeat(35)
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts Tempo agent keys', () => {
    const secret = 't' + 'k_' + 'a1'.repeat(16)
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts JWTs', () => {
    const secret = 'ey' + 'J' + 'a'.repeat(10) + '.' + 'b'.repeat(10) + '.' + 'c'.repeat(10)
    expect(redactSecrets(secret)).toBe('[redacted]')
  })

  it('redacts multiline PEM private keys', () => {
    const begin = '-----BEGIN ' + 'PRIVATE KEY-----'
    const end = '-----END ' + 'PRIVATE KEY-----'
    expect(redactSecrets(`before\n${begin}\nabc123\ndef456\n${end}\nafter`)).toBe('before\n[redacted]\nafter')
  })

  it('redacts secret assignments but keeps names and separators', () => {
    const lines = [
      'API_' + 'KEY=' + 'abc123',
      'export GITHUB_' + 'TOKEN="' + 'token-value' + '"',
      'password: ' + 'hunter2xyz',
      '"secret": "' + 'json-value' + '"',
      'DEPLOY_' + 'KEY: ' + 'live-value' + ' # keep this comment',
    ]
    expect(redactSecrets(lines.join('\n'))).toBe(['API_KEY=[redacted]', 'export GITHUB_TOKEN="[redacted]"', 'password: [redacted]', '"secret": "[redacted]"', 'DEPLOY_KEY: [redacted] # keep this comment'].join('\n'))
  })

  it('does not redact prose, git shas or non-secret code', () => {
    const shortSha = '0123456789abcdef'.slice(0, 7)
    const fullSha = '0123456789abcdef'.repeat(2) + '01234567'
    const prose = 'An API key or token is required for this integration.'
    const markdown = ['```ts', 'const url = import.meta.env.VITE_SUPABASE_URL', '```'].join('\n')
    expect(redactSecrets([prose, shortSha, fullSha, markdown].join('\n'))).toBe([prose, shortSha, fullSha, markdown].join('\n'))
  })

  it('redacts values with a note after them, mid-line assignments and credentials in URLs', () => {
    const value = 'not-a-real-' + 'value-123'
    expect(redactSecrets('WEBHOOK_' + 'SECRET=' + value)).toBe('WEBHOOK_SECRET=[redacted]')
    expect(redactSecrets('WEBHOOK_' + 'SECRET=' + value + ' (rotate before launch)')).toBe('WEBHOOK_SECRET=[redacted] (rotate before launch)')
    expect(redactSecrets('- `WEBHOOK_' + 'SECRET=' + value + '` rotate')).toBe('- `WEBHOOK_SECRET=[redacted]` rotate')
    expect(redactSecrets('- [ ] Rotate WEBHOOK_' + 'SECRET=' + value + ' before launch')).toBe('- [ ] Rotate WEBHOOK_SECRET=[redacted] before launch')
    expect(redactSecrets('DATABASE_URL=postgres://demo:' + 'demo@localhost/db')).toBe('DATABASE_URL=postgres://[redacted]@localhost/db')
    expect(redactSecrets('See https://example.com/docs and http://localhost:5173/app')).toBe('See https://example.com/docs and http://localhost:5173/app')
  })

  it('leaves kebab-case words and ordinary key/token settings alone', () => {
    const text = [
      'Built a task-management-dashboard-for-teams and a risk-assessment-tool-v2-beta.',
      'keywords: [tempo, apps]',
      'primaryKey: true',
      'max_tokens: 4096',
      'Keyboard: ⌘K',
      'Tokens: see the setup guide',
    ].join('\n')
    expect(redactSecrets(text)).toBe(text)
  })

  it('keeps empty, placeholder and env-reference assignments', () => {
    const example = [
      'ANTHROPIC_API_' + 'KEY=',
      'VITE_SUPABASE_ANON_' + 'KEY=your-' + 'anon-key',
      'ACCESS_' + 'TOKEN=<replace-me>',
      'PASSWORD=change' + 'me',
      'CLIENT_' + 'SECRET=$' + '{CLIENT_SECRET}',
      'SERVICE_' + 'TOKEN=process.env.SERVICE_TOKEN',
      'PUBLIC_' + 'KEY=import.meta.env.PUBLIC_KEY',
    ].join('\n')
    expect(redactSecrets(example)).toBe(example)
  })

  it('redacts names ending in PASS, PASSWD, PWD or CREDENTIALS', () => {
    const value = 'hunter2' + 'xyz99'
    const lines = ['DB_' + 'PASS=' + value, 'MYSQL_' + 'PWD=' + value, 'db' + 'Passwd: ' + value, 'AWS_' + 'CREDENTIALS="' + value + '"', 'Set DB_' + 'PASS=' + value + ' first']
    expect(redactSecrets(lines.join('\n'))).toBe(['DB_PASS=[redacted]', 'MYSQL_PWD=[redacted]', 'dbPasswd: [redacted]', 'AWS_CREDENTIALS="[redacted]"', 'Set DB_PASS=[redacted] first'].join('\n'))
  })

  it('redacts YAML list items', () => {
    const lines = ['- api_' + 'key: ' + 'live-value-1', '  - "client_' + 'secret": "' + 'live-value-2' + '"', '* DB_' + 'PASS=' + 'live-value-3']
    expect(redactSecrets(lines.join('\n'))).toBe(['- api_key: [redacted]', '  - "client_secret": "[redacted]"', '* DB_PASS=[redacted]'].join('\n'))
  })

  it('redacts Authorization headers', () => {
    const token = 'abc123' + 'def456ghi789'
    expect(redactSecrets('Authorization: Bearer ' + token)).toBe('Authorization: Bearer [redacted]')
    expect(redactSecrets('Authorization: Basic ' + 'dXNlcjpwYXNzd29yZA==')).toBe('Authorization: Basic [redacted]')
    expect(redactSecrets('curl -H "Authorization: Bearer ' + token + '" https://api.example.com')).toBe('curl -H "Authorization: Bearer [redacted]" https://api.example.com')
    expect(redactSecrets('headers: { "Authorization": "Bearer ' + token + '" }')).toBe('headers: { "Authorization": "Bearer [redacted]" }')
  })

  it('redacts secret curl headers', () => {
    const value = 'live-' + 'value-123'
    expect(redactSecrets('curl -H "X-Api-' + 'Key: ' + value + '" https://api.example.com')).toBe('curl -H "X-Api-Key: [redacted]" https://api.example.com')
    expect(redactSecrets("curl --header 'X-Auth-" + 'Token: ' + value + "' -d x")).toBe("curl --header 'X-Auth-Token: [redacted]' -d x")
  })

  it('redacts secret values in Markdown table rows', () => {
    const value = 'live-' + 'value-123'
    const table = ['| Variable | Value |', '|---|---|', '| API_' + 'KEY | ' + value + ' |', '| `DB_' + 'PASS` | `' + value + '` |']
    expect(redactSecrets(table.join('\n'))).toBe(['| Variable | Value |', '|---|---|', '| API_KEY | [redacted] |', '| `DB_PASS` | `[redacted]` |'].join('\n'))
  })

  it('does not redact docs, table headers, templates or placeholders for the new shapes', () => {
    const text = [
      'Authorization: see the docs',
      'Authorization: Bearer $API_TOKEN',
      'Authorization: Bearer <your token>',
      'Authorization: Bearer authentication is required',
      'curl -H "X-Api-Key: $API_KEY" https://api.example.com',
      '| Key | Description |',
      '|-----|-------------|',
      '| Token | Where to get one |',
      '| API_KEY | Your key from the dashboard |',
      '| max_tokens | 4096 |',
      'api_key: ${{ secrets.API_KEY }}',
      'api_key: "${{ secrets.API_KEY }}"',
      '- api_key: ${API_KEY}',
      'DB_PASS=<your password>',
      'DB_PWD=your_password',
      'credentials: include',
      'bypass: enabled-for-tests',
      'Result PASS: everything green',
    ].join('\n')
    expect(redactSecrets(text)).toBe(text)
  })

  it('stays fast on a long non-matching input', () => {
    const text = 'not-a-secret '.repeat(250).slice(0, 3000)
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('repoFacts', () => {
  it('builds signals from the raw repo', () => {
    const { signals } = repoFacts(raw({ paths: ['.env', 'README.md'] }), NOW)
    expect(signals).toEqual({ hasReadme: true, secretFiles: ['.env'], lastCommitAt: NOW, openIssues: 1, openPrs: 1, syncedAt: NOW, liveUrl: null })
  })
  it('no README → hasReadme false', () => expect(repoFacts(raw({ readme: null }), NOW).signals.hasReadme).toBe(false))
  it('keeps only first commit lines and short shas', () => {
    expect(repoFacts(raw(), NOW).facts.commits[0]).toEqual({ sha: 'abc1234', message: 'feat: x', author: 'sam', date: NOW, url: 'https://github.com/acme/app/commit/abc1234def' })
  })
  it('carries root deploy-file evidence into the trimmed facts', () => {
    expect(repoFacts(raw({ paths: ['src/index.ts', 'vercel.json'] }), NOW).facts.deployFile).toBe('vercel.json')
  })
  it('trims long text so the prompt stays small', () => {
    const big = 'x'.repeat(20_000)
    const { facts } = repoFacts(raw({ readme: big, files: [{ path: 'progress.md', text: big }], commits: Array.from({ length: 80 }, (_, i) => ({ sha: `s${i}aaaaaa`, message: 'm', author: 'a', date: NOW, url: 'u' })) }), NOW)
    expect(facts.readme!.length).toBeLessThanOrEqual(3000)
    expect(facts.files[0].text.length).toBeLessThanOrEqual(3000)
    expect(facts.commits).toHaveLength(30)
  })
  it('missing pieces stay empty, never invented', () => {
    const { facts, signals } = repoFacts(raw({ readme: null, files: [], commits: [], pulls: [], issues: [] }), NOW)
    expect(facts).toMatchObject({ readme: null, files: [], commits: [], pulls: [], issues: [] })
    expect(signals.lastCommitAt).toBeNull()
  })
  it('redacts model-bound repo text', () => {
    const readmeSecret = 'sk-' + 'ant-' + 'r'.repeat(40)
    const memorySecret = 'github_' + 'pat_' + 'm'.repeat(22)
    const commitSecret = 't' + 'k_' + 'ab'.repeat(16)
    const titleSecret = 'xox' + 'p-' + '1234567890abcdef'
    const { facts } = repoFacts(raw({
      meta: { ...raw().meta, description: `Deploy with ${readmeSecret}` },
      readme: `README ${readmeSecret}`,
      files: [{ path: 'CLAUDE.md', text: `Memory ${memorySecret}` }],
      commits: [{ ...raw().commits[0], message: `Commit ${commitSecret}\n${readmeSecret}` }],
      pulls: [{ ...raw().pulls[0], title: `PR ${titleSecret}` }],
      issues: [{ ...raw().issues[0], title: `Issue ${memorySecret}` }],
    }), NOW)
    expect(JSON.stringify(facts)).not.toContain(readmeSecret)
    expect(JSON.stringify(facts)).not.toContain(memorySecret)
    expect(JSON.stringify(facts)).not.toContain(commitSecret)
    expect(JSON.stringify(facts)).not.toContain(titleSecret)
    expect(JSON.stringify(facts).match(/\[redacted\]/g)).toHaveLength(6)
  })
})

describe('live app link', () => {
  it('prefers the repo homepage, then the latest production deployment', () => {
    expect(repoFacts(raw({ meta: { ...raw().meta, homepage: 'https://bot.acme.dev' }, deployUrl: 'https://x.vercel.app' }), NOW).signals.liveUrl).toBe('https://bot.acme.dev')
    expect(repoFacts(raw({ deployUrl: 'https://x.vercel.app' }), NOW).signals.liveUrl).toBe('https://x.vercel.app')
  })
  it('ignores empty or non-web links', () => {
    expect(repoFacts(raw({ meta: { ...raw().meta, homepage: '' } }), NOW).signals.liveUrl).toBeNull()
    expect(repoFacts(raw({ meta: { ...raw().meta, homepage: 'javascript:alert(1)' } }), NOW).signals.liveUrl).toBeNull()
    expect(repoFacts(raw({ meta: { ...raw().meta, homepage: 'acme.dev' } }), NOW).signals.liveUrl).toBe('https://acme.dev')
  })
})
