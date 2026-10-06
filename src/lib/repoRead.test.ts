import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { readRepoFactsOnly, readRepoRaw, readRepoWork, toRef, type ApiRepo, type GitHubGet, type GitHubGetOptions, type OptionalRead } from './repoRead'
import { repoFacts } from '../ai/tools/repoFacts'

const apiRepo = (over: Partial<ApiRepo> = {}): ApiRepo => ({
  id: 99, full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: true, default_branch: 'main',
  description: 'A repo', pushed_at: '2026-10-05T12:00:00Z', homepage: 'https://web.example', fork: false, archived: false,
  is_template: false, size: 5, language: 'TypeScript', ...over,
})
const commit = { sha: 'abcdef123', html_url: 'commit-url', commit: { message: 'Ship it', author: { name: 'Maya', date: '2026-10-04' } }, author: null }
const pull = { number: 1, title: 'Release', html_url: 'pull-url', user: null, created_at: '2026-10-04' }
const issue = { number: 2, title: 'Fix', html_url: 'issue-url', labels: ['bug', { name: 'urgent' }, {}], created_at: '2026-10-04' }

class FakeError extends Error {
  constructor(readonly status: number, readonly kind = 'other') { super(`status ${status}`) }
}

/** A getter answering from a table keyed by path prefix; a value that is an Error is thrown. */
function fakeGet(table: Record<string, unknown> = {}) {
  const calls: Array<{ path: string; opts: GitHubGetOptions | undefined }> = []
  const defaults: Record<string, unknown> = {
    '/repos/acme/web': apiRepo(),
    '/repos/acme/web/readme': '# Web',
    '/repos/acme/web/commits': [commit],
    '/repos/acme/web/pulls': [pull],
    '/repos/acme/web/issues': [{ ...issue, pull_request: {} }, issue],
    '/repos/acme/web/git/trees/': { tree: [{ type: 'blob', path: 'CLAUDE.md' }, { type: 'blob', path: 'src/a.ts' }, { type: 'tree', path: 'src' }] },
    '/repos/acme/web/contents/': 'Memory',
    '/repos/acme/web/deployments?': [{ id: 7 }],
    '/repos/acme/web/deployments/7/statuses': [{ state: 'success', environment_url: 'https://web.example' }],
  }
  const get: GitHubGet = async <T>(path: string, opts?: GitHubGetOptions) => {
    calls.push({ path, opts })
    const answers = { ...defaults, ...table }
    const key = Object.keys(answers).filter((prefix) => path === prefix || path.startsWith(prefix)).sort((a, b) => b.length - a.length)[0]
    const value = answers[key]
    if (value instanceof Error) throw value
    return (value ?? null) as T | null
  }
  return { get, calls }
}
const soft: OptionalRead = () => null

describe('toRef', () => {
  it('carries GitHub\'s repo id, and leaves it off when GitHub did not send one', () => {
    expect(toRef(apiRepo())).toMatchObject({ id: 99, fullName: 'acme/web', private: true, defaultBranch: 'main' })
    expect('id' in toRef({ ...apiRepo(), id: undefined as unknown as number })).toBe(false)
  })
})

describe('readRepoWork', () => {
  it('reads commits, open pull requests and issues (never the pull requests listed among issues)', async () => {
    const { get, calls } = fakeGet()
    expect(await readRepoWork(get, 'acme/web')).toEqual({
      commits: [{ sha: 'abcdef123', message: 'Ship it', author: 'Maya', date: '2026-10-04', url: 'commit-url' }],
      pulls: [{ number: 1, title: 'Release', author: 'unknown', url: 'pull-url', draft: false, createdAt: '2026-10-04' }],
      issues: [{ number: 2, title: 'Fix', url: 'issue-url', labels: ['bug', 'urgent'], createdAt: '2026-10-04' }],
    })
    expect(calls.map((c) => c.path)).toEqual([
      '/repos/acme/web/commits?per_page=30', '/repos/acme/web/pulls?state=open&per_page=20', '/repos/acme/web/issues?state=open&per_page=30',
    ])
    for (const call of calls) expect(call.opts).toEqual({ allow404: true })
  })

  it('treats any error with status 409 (an empty repo) as no commits, and rethrows every other', async () => {
    const empty = fakeGet({ '/repos/acme/web/commits': new FakeError(409) })
    expect(await readRepoWork(empty.get, 'acme/web')).toMatchObject({ commits: [], pulls: [{ number: 1 }], issues: [{ number: 2 }] })
    const broken = fakeGet({ '/repos/acme/web/commits': new FakeError(500) })
    await expect(readRepoWork(broken.get, 'acme/web')).rejects.toMatchObject({ status: 500 })
    const pullsBroken = fakeGet({ '/repos/acme/web/pulls': new FakeError(409) })
    await expect(readRepoWork(pullsBroken.get, 'acme/web')).rejects.toMatchObject({ status: 409 })
  })
})

describe('readRepoFactsOnly (the server\'s push refresh)', () => {
  const withReadme = (path: string) => ({ '/repos/acme/web/git/trees/': { tree: [{ type: 'blob', path }, { type: 'blob', path: '.env' }] } })

  it('never fetches a file\'s contents, and reads only the newest commit', async () => {
    const { get, calls } = fakeGet(withReadme('README.md'))
    await readRepoFactsOnly(get, 'acme/web', soft)
    const paths = calls.map((c) => c.path)
    expect(paths.some((path) => /\/readme|\/contents\//.test(path))).toBe(false)
    expect(calls.some((c) => c.opts?.raw)).toBe(false)
    expect(paths).toContain('/repos/acme/web/commits?per_page=1')
  })

  it('finds a README by name in the root, .github/ or docs/, any extension, and nowhere else', async () => {
    for (const path of ['README.md', 'readme', 'Readme.rst', '.github/README.md', 'docs/readme.txt']) {
      expect((await readRepoFactsOnly(fakeGet(withReadme(path)).get, 'acme/web', soft)).readme).toBe('')
    }
    for (const path of ['src/README.md', 'READMEs.md', 'not-readme.md']) {
      expect((await readRepoFactsOnly(fakeGet(withReadme(path)).get, 'acme/web', soft)).readme).toBeNull()
    }
  })

  it('gives the same signals as a browser Sync of the same repo', async () => {
    const table = { '/repos/acme/web/git/trees/': { tree: [{ type: 'blob', path: 'README.md' }, { type: 'blob', path: '.env' }, { type: 'blob', path: 'CLAUDE.md' }] } }
    const now = '2026-10-06T12:00:00.000Z'
    const server = repoFacts(await readRepoFactsOnly(fakeGet(table).get, 'acme/web', soft), now).signals
    const browser = repoFacts(await readRepoRaw(fakeGet(table).get, 'acme/web', soft), now).signals
    expect(server).toEqual(browser)
    expect(server).toMatchObject({ hasReadme: true, secretFiles: ['.env'] })
  })
})

describe('readRepoRaw', () => {
  it('reads the repo, its readme, work, tree, memory files and deployment through the getter alone', async () => {
    const { get, calls } = fakeGet()
    const raw = await readRepoRaw(get, 'acme/web', soft)
    expect(raw).toMatchObject({
      meta: { id: 99, fullName: 'acme/web', private: true, defaultBranch: 'main', description: 'A repo', pushedAt: '2026-10-05T12:00:00Z', homepage: 'https://web.example' },
      deployUrl: 'https://web.example',
      readme: '# Web',
      files: [{ path: 'CLAUDE.md', text: 'Memory' }],
      paths: ['CLAUDE.md', 'src/a.ts'],
      commits: [{ sha: 'abcdef123' }],
      pulls: [{ number: 1 }],
      issues: [{ number: 2 }],
    })
    const byPath = (path: string) => calls.find((c) => c.path === path)
    expect(byPath('/repos/acme/web')?.opts).toBeUndefined()
    expect(byPath('/repos/acme/web/readme')?.opts).toEqual({ allow404: true, raw: true })
    expect(byPath('/repos/acme/web/git/trees/main?recursive=1')?.opts).toEqual({ allow404: true })
    expect(byPath('/repos/acme/web/contents/CLAUDE.md')?.opts).toEqual({ allow404: true, raw: true })
    expect(calls).toHaveLength(9)
  })

  it('leaves out blank memory files and a missing readme', async () => {
    const { get } = fakeGet({ '/repos/acme/web/readme': null, '/repos/acme/web/contents/': '  \n' })
    expect(await readRepoRaw(get, 'acme/web', soft)).toMatchObject({ readme: null, files: [] })
  })

  it('hands a failed tree or deployment read to `optional`, and carries on when it answers null', async () => {
    const optional = vi.fn<OptionalRead>(() => null)
    const { get } = fakeGet({ '/repos/acme/web/git/trees/': new FakeError(500), '/repos/acme/web/deployments?': new FakeError(500) })
    const raw = await readRepoRaw(get, 'acme/web', optional)
    expect(raw).toMatchObject({ paths: [], files: [], deployUrl: null, commits: [{ sha: 'abcdef123' }] })
    expect(optional).toHaveBeenCalledTimes(2)
  })

  it.each(['/repos/acme/web/git/trees/', '/repos/acme/web/deployments?', '/repos/acme/web/deployments/7/statuses'])('stops the whole read when `optional` throws for %s', async (endpoint) => {
    const stop = new FakeError(429, 'rate-limit')
    const optional: OptionalRead = (error) => { if (error === stop) throw error; return null }
    const { get } = fakeGet({ [endpoint]: stop })
    await expect(readRepoRaw(get, 'acme/web', optional)).rejects.toBe(stop)
  })

  it('does not hand a failed required read (the repo, the readme, the work) to `optional`', async () => {
    const optional = vi.fn<OptionalRead>(() => null)
    await expect(readRepoRaw(fakeGet({ '/repos/acme/web': new FakeError(500) }).get, 'acme/web', optional)).rejects.toMatchObject({ status: 500 })
    await expect(readRepoRaw(fakeGet({ '/repos/acme/web/readme': new FakeError(500) }).get, 'acme/web', optional)).rejects.toMatchObject({ status: 500 })
    expect(optional).not.toHaveBeenCalled()
  })

  it('has no deploy URL when there is no production deployment or it did not succeed', async () => {
    expect((await readRepoRaw(fakeGet({ '/repos/acme/web/deployments?': [] }).get, 'acme/web', soft)).deployUrl).toBeNull()
    expect((await readRepoRaw(fakeGet({ '/repos/acme/web/deployments/7/statuses': [{ state: 'failure', target_url: 'x' }] }).get, 'acme/web', soft)).deployUrl).toBeNull()
    expect((await readRepoRaw(fakeGet({ '/repos/acme/web/deployments/7/statuses': [{ state: 'success', target_url: 'https://t.example' }] }).get, 'acme/web', soft)).deployUrl).toBe('https://t.example')
  })

  it('reads the tree of the default branch GitHub reports', async () => {
    const { get, calls } = fakeGet({ '/repos/acme/web': apiRepo({ default_branch: 'trunk' }) })
    await readRepoRaw(get, 'acme/web', soft)
    expect(calls.some((c) => c.path === '/repos/acme/web/git/trees/trunk?recursive=1')).toBe(true)
  })
})

describe('purity', () => {
  const file = readFileSync(new URL('./repoRead.ts', import.meta.url), 'utf8')
  const source = file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('uses no store, window, storage, env or relative /api URL', () => {
    expect(source).not.toMatch(/\b(?:window|document|localStorage|sessionStorage|indexedDB|navigator)\b|import\.meta|useStore|useSession|zustand|['"`]\/api\/|\bfetch\s*\(/)
  })

  it('imports only types and the pure repoFacts module, with the extension Node needs', () => {
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^'"]*from\s+'([^']+)'/gm)].map((m) => [Boolean(m[1]), m[2]])
    expect(imports.filter(([isType]) => !isType).map(([, from]) => from)).toEqual(['../ai/tools/repoFacts.js'])
    expect(imports.filter(([isType]) => isType).map(([, from]) => from)).toEqual(['../types'])
  })
})
