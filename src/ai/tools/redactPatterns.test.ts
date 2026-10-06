// One positive example per credential shape, then the things that must NOT be redacted. Secrets are built from pieces
// so no scanner mistakes this file for a leak.
import { describe, expect, it } from 'vitest'
import { redactDeep, redactSecrets } from './repoFacts'

const R = '[redacted]'
const rep = (ch: string, n: number) => ch.repeat(n)

describe('redactSecrets: assignments in any case', () => {
  const value = 'live-' + 'value-123'
  it.each([
    ['api_' + 'key=' + value, `api_key=${R}`],
    ['apiKey: ' + value, `apiKey: ${R}`],
    ['Use token=' + value + ' for CI', `Use token=${R} for CI`],
    ['the secret = ' + value, `the secret = ${R}`],
    ['set password: ' + value + ' now', `set password: ${R} now`],
    ['{"apiKey": "' + value + '", "name": "x"}', `{"apiKey": "${R}", "name": "x"}`],
    ['GET /v1/items?api_' + 'key=' + value, `GET /v1/items?api_key=${R}`],
    ['**API key:** ' + value, `**API key:** ${R}`],
    ['db_pass=' + value, `db_pass=${R}`],
    ['dbPwd: ' + value, `dbPwd: ${R}`],
  ])('%s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  it('keeps type names, short values and placeholders', () => {
    const text = ['apiKey: string', 'token: number', 'secret: required', 'Use apiKey: <your key>', 'the key: abc', 'password: ${PASSWORD}'].join('\n')
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('redactSecrets: provider token shapes', () => {
  it.each([
    ['Stripe live secret key', 'sk_' + 'live_' + rep('a1', 14)],
    ['Stripe restricted key', 'rk_' + 'live_' + rep('B2', 14)],
    ['Stripe webhook secret', 'whsec_' + rep('c3', 16)],
    ['GitLab token', 'glpat-' + rep('d4', 12)],
    ['npm token', 'npm_' + rep('e5', 18)],
    ['SendGrid key', 'SG.' + rep('f6', 11) + '.' + rep('G7', 22)],
    ['Google OAuth token', 'ya29.' + rep('h8', 15)],
    ['Google API key', 'AI' + 'za' + rep('i9', 18) + 'j'],
    ['Slack bot token', 'xox' + 'b-' + '1234567890-abcdefghij'],
    ['Slack user token', 'xox' + 'p-' + '1234567890-abcdefghij'],
    ['Slack refresh token', 'xox' + 'r-' + '1234567890-abcdefghij'],
    ['Slack app token', 'xa' + 'pp-1-' + 'A0123456789-abcdef'],
    ['Slack webhook', 'https://hooks.' + 'slack.com/services/T0000/B0000/' + rep('k1', 12)],
    ['Discord webhook', 'https://discord' + '.com/api/webhooks/123456789012345678/' + rep('l2', 30)],
    ['Discord webhook (older host)', 'https://discord' + 'app.com/api/v9/webhooks/123456789012345678/' + rep('m3', 30)],
    ['JWT', 'ey' + 'J' + rep('n', 12) + '.' + rep('o', 20) + '.' + rep('p', 20)],
    ['JWT without a signature', 'ey' + 'J' + rep('q', 12) + '.' + 'ey' + 'J' + rep('r', 20) + '.'],
    ['JWT with a short payload and signature', 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'JzdWIi' + '.' + 'SflKxwRJSMe'],
  ])('%s', (_name, secret) => {
    expect(redactSecrets(`before ${secret} after`)).toBe(`before ${R} after`)
    expect(redactSecrets(secret)).toBe(R)
  })

  it('redacts Azure account keys and keeps the name', () => {
    const key = rep('Ab1+', 12) + '=='
    expect(redactSecrets(`DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=${key};EndpointSuffix=core.windows.net`))
      .toBe(`DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=${R};EndpointSuffix=core.windows.net`)
    expect(redactSecrets(`Endpoint=sb://x.servicebus.windows.net/;SharedAccessKey=${key}`)).toBe(`Endpoint=sb://x.servicebus.windows.net/;SharedAccessKey=${R}`)
  })

  it('redacts AWS secret keys next to their name', () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYEXAMPLEKEY'
    expect(secret).toHaveLength(40)
    expect(redactSecrets('aws_secret_access_key = ' + secret)).toBe(`aws_secret_access_key = ${R}`)
    expect(redactSecrets('AWS Secret Access Key: ' + secret)).toBe(`AWS Secret Access Key: ${R}`)
    expect(redactSecrets('{"aws_secret_access_key": "' + secret + '"}')).toBe(`{"aws_secret_access_key": "${R}"}`)
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=' + secret)).toBe(`AWS_SECRET_ACCESS_KEY=${R}`)
  })
})

describe('redactSecrets: credentials in URLs and commands', () => {
  it('redacts URL credentials, including an empty user', () => {
    expect(redactSecrets('REDIS_URL=redis://:' + 'hunter2@cache.internal:6379')).toBe(`REDIS_URL=redis://${R}@cache.internal:6379`)
    expect(redactSecrets('postgres://app:' + 's3cret@db.internal/app')).toBe(`postgres://${R}@db.internal/app`)
    expect(redactSecrets('git clone https://oauth2:' + 'abc123@gitlab.com/acme/app.git')).toBe(`git clone https://${R}@gitlab.com/acme/app.git`)
  })

  it('leaves ordinary URLs and ssh remotes alone', () => {
    const text = 'See https://example.com:8443/docs, http://localhost:5173/app and ssh://git@github.com/acme/app.git'
    expect(redactSecrets(text)).toBe(text)
  })

  it('redacts curl -u and --user', () => {
    expect(redactSecrets('curl -u admin:' + 's3cretpw https://api.example.com/v1')).toBe(`curl -u ${R} https://api.example.com/v1`)
    expect(redactSecrets('curl -u user:' + 'pass https://api.example.com')).toBe(`curl -u ${R} https://api.example.com`)
    expect(redactSecrets('curl -sS --user "admin:' + 'p w" https://api.example.com')).toBe(`curl -sS --user ${R} https://api.example.com`)
    expect(redactSecrets("curl --user='ci:" + "token1' https://x.test")).not.toContain('token1')
  })

  it('keeps curl -u templates and other commands that use -u', () => {
    const text = ['curl -u $USER:$PASS https://x.test', 'curl -u <user>:<password> https://x.test', 'curl -u admin https://x.test', 'git push -u origin main'].join('\n')
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('redactSecrets: PEM blocks', () => {
  const begin = '-----BEGIN ' + 'RSA PRIVATE KEY-----'
  const end = '-----END ' + 'RSA PRIVATE KEY-----'
  const body = rep('MIIEowIBAAKCAQEA', 4)

  it('redacts a complete block', () => {
    expect(redactSecrets(`a\n${begin}\n${body}\n${body}\n${end}\nb`)).toBe(`a\n${R}\nb`)
  })

  it('redacts a block with no END line', () => {
    expect(redactSecrets(`a\n${begin}\n${body}\n${body}\nHere ends the file`)).not.toContain(body)
    expect(redactSecrets(`${begin}\n${body}\n${body}`)).toBe(R)
    expect(redactSecrets(`${begin}\r\n${body}\r\n${body}`)).toBe(R)
  })

  it('redacts a cut-off block inside a JSON string (escaped newlines)', () => {
    const json = `{"private_key": "${begin}\\n${body}\\n${body}`
    expect(redactSecrets(json)).not.toContain(body)
  })

  it('redacts other key kinds, including PGP blocks', () => {
    for (const kind of ['OPENSSH PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
      const open = `-----BEGIN ${kind}-----`
      expect(redactSecrets(`${open}\n${body}`), kind).toBe(R)
    }
  })

  it('keeps a header mentioned in docs when no key follows it', () => {
    const doc = `Paste the whole key, including the ${begin} line, into the form.\nThen press save.`
    expect(redactSecrets(doc)).toContain('Then press save.')
  })
})

describe('redactSecrets: things that are not secrets', () => {
  it('leaves prose, commit hashes, UUIDs, versions and paths alone', () => {
    const text = [
      'Fix the login redirect (closes #42)',
      'commit 0123456789abcdef0123456789abcdef01234567',
      'short 0123abc and merge of 9fceb02',
      'id: 123e4567-e89b-12d3-a456-426614174000',
      'trace 6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'Upgrade to v2.31.0 from 1.9.4',
      'src/components/app/HandoverModal.tsx',
      'The skeleton uses sk-ill words, npm_config_registry and npm_package_version.',
      'ghp is short for a handle, not a token',
      'Result PASS: everything green; bypass: enabled-for-tests',
      'Run npm run build, then open http://localhost:5173/#/settings',
      'sha256: see the release notes',
    ].join('\n')
    expect(redactSecrets(text)).toBe(text)
  })

  it('stays linear on long hostile input', () => {
    const inputs = [
      'a.b-c_d '.repeat(40_000),
      'a'.repeat(300_000),
      'key '.repeat(60_000),
      ('token' + '='.repeat(5) + 'x ').repeat(30_000),
      ('-----BEGIN ' + 'PRIVATE KEY-----\n').repeat(5_000),
    ]
    for (const text of inputs) {
      const start = performance.now()
      redactSecrets(text)
      expect(performance.now() - start).toBeLessThan(2_000)
    }
  })
})

describe('redactDeep', () => {
  it('redacts every string in nested values and keeps everything else', () => {
    const token = 'gh' + 'p_' + rep('a', 36)
    const input = {
      app: { name: `Bot ${token}`, count: 3, live: true, none: null },
      list: ['api_key=' + 'live-12345', 'plain', 7],
      updates: [{ by: 'codex', summary: `Deployed with ${token}`, at: '2026-10-04T10:00:00Z' }],
    }
    const out = redactDeep(input)
    expect(JSON.stringify(out)).not.toContain(token)
    expect(out.app).toEqual({ name: `Bot ${R}`, count: 3, live: true, none: null })
    expect(out.list).toEqual([`api_key=${R}`, 'plain', 7])
    expect(out.updates[0]).toEqual({ by: 'codex', summary: `Deployed with ${R}`, at: '2026-10-04T10:00:00Z' })
    expect(input.app.name).toContain(token) // the input is not changed
  })

  it('is stable when applied twice', () => {
    const once = redactDeep({ a: 'password: ' + 'hunter2xyz', b: 'redis://:' + 'pw1234@host', c: 'curl -u a:' + 'bcdefg x', d: 'Authorization: Bearer ' + 'abc123' + 'def456ghi789' })
    expect(redactDeep(once)).toEqual(once)
  })
})
