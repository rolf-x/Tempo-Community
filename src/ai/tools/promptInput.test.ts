import { describe, expect, it } from 'vitest'
import { handoverSystem, tasksSystem } from '../prompts'
import { handoverInput, syncAppInput, tasksInput } from './promptInput'
import type { RepoFacts } from './repoFacts'

// Built from pieces so no scanner mistakes this file for a leak.
const token = 'gh' + 'p_' + 'a'.repeat(36)
const stripe = 'sk_' + 'live_' + 'Ab1'.repeat(8)
const password = 'hunter2' + 'xyz99'

const facts: RepoFacts = {
  meta: { fullName: 'acme/app', url: 'https://github.com/acme/app', private: true, defaultBranch: 'main', description: 'Bot', pushedAt: null },
  readme: '# App',
  files: [],
  deployFile: null,
  commits: [{ sha: 'abc1234', message: 'feat: x', author: `sam-${token}`, date: '2026-10-04T10:00:00Z', url: 'https://github.com/acme/app/commit/abc1234' }],
  pulls: [{ number: 3, title: 'Add y', author: 'nadia', url: 'https://github.com/acme/app/pull/3', draft: false }],
  issues: [{ number: 7, title: 'Bug z', url: 'https://github.com/acme/app/issues/7', labels: [`label ${stripe}`] }],
}
const project = { name: `Bot ${stripe}`, description: `Runs on password: ${password}` }

describe('syncAppInput', () => {
  const user = syncAppInput(project, facts)
  it('redacts every free-text field before it goes to the provider', () => {
    for (const secret of [token, stripe, password]) expect(user).not.toContain(secret)
    const parsed = JSON.parse(user)
    expect(parsed.app).toEqual({ name: 'Bot [redacted]', description: 'Runs on password: [redacted]' })
    expect(parsed.facts.commits[0].author).toBe('sam-[redacted]')
    expect(parsed.facts.issues[0].labels).toEqual(['label [redacted]'])
  })
  it('sends the same facts otherwise', () => {
    const parsed = JSON.parse(user)
    expect(parsed.facts.meta.fullName).toBe('acme/app')
    expect(parsed.facts.pulls[0]).toEqual(facts.pulls[0])
    expect(Object.keys(parsed)).toEqual(['app', 'facts'])
  })
})

describe('handoverInput', () => {
  const user = handoverInput({
    project, owner: `Maya ${token}`, deployment: { liveUrl: `https://ci:${password}@app.acme.test`, deployFile: 'vercel.json' },
    facts, flags: [{ label: `Secret file committed: ${stripe}` }],
  })
  it('redacts the app, owner, deployment link, health labels', () => {
    for (const secret of [token, stripe, password]) expect(user).not.toContain(secret)
    const parsed = JSON.parse(user)
    expect(Object.keys(parsed)).toEqual(['app', 'deployment', 'facts', 'health'])
    expect(parsed.app.owner).toBe('Maya [redacted]')
    expect(parsed.deployment).toEqual({ liveUrl: 'https://[redacted]@app.acme.test', deployFile: 'vercel.json' })
    expect(parsed.health).toEqual(['Secret file committed: [redacted]'])
  })
  it('redacts the owner in the system prompt too', () => {
    expect(handoverSystem({ today: '2026-10-05', owner: `Maya ${token}` })).not.toContain(token)
  })
})

describe('tasksInput', () => {
  const repoRef = { fullName: 'acme/app', url: 'https://github.com/acme/app', private: false, defaultBranch: 'main' }
  const signals = { hasReadme: false, secretFiles: [`.env.${stripe}`], lastCommitAt: '2026-09-01T00:00:00Z', openIssues: 3, openPrs: 1, syncedAt: '2026-10-04T00:00:00Z', liveUrl: 'https://app.acme.test' }
  const card = { what: `Runs on password: ${password}`, who: 'Finance', stage: 'live' as const, status: 'Quiet since September', updatedAt: '2026-10-01T00:00:00Z', source: 'ai' as const }
  const tasks = [
    { id: 't1', problem: 'stale' as const, title: `Archive it ${token}`, detail: null, createdAt: '', draftedBy: { client: 'x', clientId: null, memberId: null, at: '' }, fixedAt: null, removedAt: '2026-10-03T00:00:00Z' },
    { id: 't2', problem: 'stale' as const, title: 'Still open', detail: null, createdAt: '', draftedBy: { client: 'x', clientId: null, memberId: null, at: '' }, fixedAt: null },
  ]
  const user = tasksInput({
    project: { name: `Bot ${stripe}`, description: 'Internal', repo: repoRef, signals, appCard: card, tasks },
    flags: [{ kind: 'secrets', label: `Secret file committed: .env.${stripe}` }, { kind: 'no-readme', label: 'No README' }],
  })
  it('redacts every free-text field before it goes to the provider', () => {
    for (const secret of [token, stripe, password]) expect(user).not.toContain(secret)
    const parsed = JSON.parse(user)
    expect(parsed.app.name).toBe('Bot [redacted]')
    expect(parsed.app.what).toBe('Runs on password: [redacted]')
    expect(parsed.problems[0]).toEqual({ kind: 'secrets', detail: 'Secret file committed: .env.[redacted]' })
    expect(parsed.alreadyRemoved).toEqual(['Archive it [redacted]'])
  })
  it('sends the app, the problems and the repo facts Tempo already holds, and nothing else', () => {
    const parsed = JSON.parse(user)
    expect(Object.keys(parsed).sort()).toEqual(['alreadyRemoved', 'app', 'problems', 'signals'])
    expect(parsed.app).toMatchObject({ repo: 'acme/app', description: 'Internal', status: 'Quiet since September' })
    expect(parsed.problems.map((item: { kind: string }) => item.kind)).toEqual(['secrets', 'no-readme'])
    expect(Object.keys(parsed.signals).sort()).toEqual(['hasReadme', 'lastCommitAt', 'openIssues', 'openPrs', 'secretFiles'])
  })
  it('copes with an app that was never synced and has no card', () => {
    const parsed = JSON.parse(tasksInput({ project: { name: 'New', description: '', repo: null, signals: null, appCard: null }, flags: [{ kind: 'no-owner', label: 'No owner' }] }))
    expect(parsed).toEqual({ app: { name: 'New', repo: null, description: '', what: null, status: null }, problems: [{ kind: 'no-owner', detail: 'No owner' }], signals: null, alreadyRemoved: [] })
  })
})

describe('tasksSystem', () => {
  const system = tasksSystem({ today: '2026-10-06' })
  it('carries the date, the limits and the same task rules as the MCP tool', () => {
    expect(system).toContain('2026-10-06 (Tuesday)')
    expect(system).toContain('Title up to 80 characters, detail up to 240')
    expect(system).toContain('no links, no secrets')
    expect(system).toContain('write_tasks')
  })
})
