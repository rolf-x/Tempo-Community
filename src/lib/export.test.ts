import { describe, expect, it } from 'vitest'
import type { PersistedState } from '../types'
import { exportData, parseImport } from './export'
import { makeSeed } from './seed'

const state = (): PersistedState => {
  const seed = makeSeed()
  return {
    version: 3, ...seed, workspace: null,
    settings: { ai: { provider: 'anthropic', preset: null, baseUrl: null, apiKey: 'sk-do-not-export', model: null }, theme: 'system', teamSize: 5, onboarded: true, demo: false },
  }
}
const backup = () => JSON.parse(exportData(state()))
const load = (b: unknown) => parseImport(JSON.stringify(b))

describe('exportData', () => {
  it('leaves every saved API key out of a backup, the default and the others', () => {
    const base = state()
    const saved = (id: string, apiKey: string) => ({ id, savedAt: '2026-10-05', ai: { ...base.settings.ai, apiKey } })
    const json = exportData({ ...base, settings: { ...base.settings, aiConnections: [saved('a', 'sk-do-not-export'), saved('b', 'sk-other-key')], aiDefaultId: 'a' } })
    expect(json).not.toContain('sk-do-not-export')
    expect(json).not.toContain('sk-other-key')
    expect(JSON.parse(json).settings.aiConnections.map((item: { id: string }) => item.id)).toEqual(['a', 'b'])
  })
})

describe('parseImport', () => {
  it('round-trips a full export unchanged', () => {
    const before = state()
    const after = parseImport(exportData(before))
    expect(after.projects).toMatchObject(before.projects) // plus the defaults an old backup gets (keptAt: null)
    expect(after.members).toEqual(before.members)
    expect(after.activity).toEqual(before.activity)
    expect(JSON.stringify(after)).not.toContain('sk-do-not-export')
  })

  it('has seed data that exercises every checked field', () => {
    const { projects, activity } = state()
    expect(projects.some((p) => p.repo)).toBe(true)
    expect(projects.some((p) => p.signals)).toBe(true)
    expect(projects.some((p) => p.appCard)).toBe(true)
    expect(activity.some((a) => a.url)).toBe(true)
  })

  it('accepts a backup with no optional parts', () => {
    const minimal = { version: 3, projects: [{ id: 'p1', name: 'A', emoji: 'x', color: 'blue', description: '', createdAt: '2026-10-01', archived: false }] }
    expect(load(minimal).projects[0]).toMatchObject({ id: 'p1', repo: null, signals: null, appCard: null, ownerId: null })
  })

  it('drops task entries from old backups instead of failing on them', () => {
    const b = backup()
    b.tasks = [{ id: 't1' }]
    b.activity = [{ id: 'a', projectId: 'p', kind: 'task', actor: 'x', title: 'old', at: 'x', url: 'javascript:alert(1)' }, ...b.activity]
    expect(load(b).activity).toHaveLength(state().activity.length)
  })

  it('drops coding-agent entries from old backups instead of failing on them, and the agent name on the rest', () => {
    const b = backup()
    const row = b.activity.find((item: any) => item.kind === 'commit')
    b.activity = [{ ...row, id: 'old-update', kind: 'heartbeat', agent: 'claude-code', url: null }, { ...row, id: 'old-commit', agent: 'codex' }, ...b.activity]
    const after = load(b).activity
    expect(after.map((item) => item.id)).not.toContain('old-update')
    expect(after).toHaveLength(state().activity.length + 1)
    expect(after.find((item) => item.id === 'old-commit')).not.toHaveProperty('agent')
  })

  it('drops fields it does not know, including a __proto__ key', () => {
    const text = JSON.stringify(backup()).replace('"projects":[{', '"projects":[{"isAdmin":true,"__proto__":{"polluted":true},')
    expect(text).toContain('"__proto__"')
    const project = parseImport(text).projects[0]
    expect(project).not.toHaveProperty('isAdmin')
    expect(Object.getPrototypeOf(project)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('says what it is when the text is not JSON or not a backup', () => {
    expect(() => parseImport('nope')).toThrow("isn't valid JSON")
    expect(() => parseImport('{"hello":1}')).toThrow("isn't a Tempo backup")
    expect(() => parseImport('[]')).toThrow("isn't a Tempo backup")
  })
})

describe('parseImport rejects what the app would render unsafely', () => {
  const withProject = (change: (project: Record<string, any>) => void) => {
    const b = backup()
    change(b.projects.find((p: any) => p.repo && p.signals && p.appCard))
    return b
  }

  it.each([
    ['a repo link that is not github', (p: any) => { p.repo.url = 'https://evil.example/acme/app' }, /projects\.\d+\.repo\.url: must be a https:\/\/github\.com\/owner\/repo link/],
    ['a repo link on http', (p: any) => { p.repo.url = 'http://github.com/acme/app' }, /repo\.url/],
    ['a repo link that is a script', (p: any) => { p.repo.url = 'javascript:alert(1)' }, /repo\.url/],
    ['a repo link on a lookalike host', (p: any) => { p.repo.url = 'https://github.com.evil.example/acme/app' }, /repo\.url/],
    ['a repo name that is not owner/name', (p: any) => { p.repo.fullName = '../etc/passwd' }, /repo\.fullName/],
    ['repo fields of the wrong type', (p: any) => { p.repo.private = 'yes' }, /repo\.private/],
    ['signals of the wrong type', (p: any) => { p.signals.openIssues = 'many' }, /signals\.openIssues/],
    ['signals with a script as the live link', (p: any) => { p.signals.liveUrl = 'javascript:alert(1)' }, /signals\.liveUrl/],
    ['an app link that is a script', (p: any) => { p.liveUrl = 'javascript:alert(1)' }, /liveUrl: must be an http or https link/],
    ['a card with an unknown stage', (p: any) => { p.appCard.stage = 'launched' }, /appCard\.stage/],
    ['a card source that is made up', (p: any) => { p.appCard.source = 'human' }, /appCard\.source/],
    ['a card commit link that is not github', (p: any) => { p.appCard.evidence = { readme: null, deployFile: null, lastCommit: { message: 'm', author: 'a', at: 'x', url: 'https://evil.example/c' } } }, /evidence\.lastCommit\.url/],
  ])('%s', (_name, change, message) => {
    expect(() => load(withProject(change))).toThrow(message)
    expect(() => load(withProject(change))).toThrow(/Nothing was imported/)
  })

  it.each([
    ['an activity link that is a script', (a: any) => { a.url = 'javascript:alert(1)' }, /activity\.\d+\.url/],
    ['an activity link that is not github', (a: any) => { a.url = 'https://evil.example/x' }, /activity\.\d+\.url/],
    ['an activity kind that does not exist', (a: any) => { a.kind = 'deploy' }, /activity\.\d+\.kind/],
    ['an activity title that is not text', (a: any) => { a.title = { html: '<b>x</b>' } }, /activity\.\d+\.title/],
  ])('%s', (_name, change, message) => {
    const b = backup()
    change(b.activity.find((a: any) => a.url))
    expect(() => load(b)).toThrow(message)
  })

  it('rejects a member avatar that is not https', () => {
    const b = backup()
    b.members[0].avatarUrl = 'http://tracker.example/pixel.gif'
    expect(() => load(b)).toThrow(/members\.0\.avatarUrl/)
    b.members[0].avatarUrl = 'https://avatars.githubusercontent.com/u/1'
    expect(load(b).members[0].avatarUrl).toBe('https://avatars.githubusercontent.com/u/1')
  })

  it('rejects the whole file when one part is bad', () => {
    const b = backup()
    b.projects[1].color = 'neon'
    expect(() => load(b)).toThrow(/projects\.1\.color/)
  })
})
