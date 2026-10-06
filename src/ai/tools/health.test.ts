import { describe, expect, it } from 'vitest'
import { flagTone, health, quietPeriodKept } from './health'
import type { Member, Project } from '../../types'
import { appDefaults } from '../../lib/model'

const NOW = new Date('2026-10-03T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const member = (id: string, active = true, leavingOn: string | null = null): Member => ({ id, name: id, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active, leavingOn })
const members = [member('m1'), member('gone', false)]
const app = (over: Partial<Project> = {}): Project => ({
  id: 'p', name: 'App', emoji: '📁', color: 'blue', description: '', createdAt: daysAgo(30), archived: false, ...appDefaults(),
  ownerId: 'm1',
  repo: { fullName: 'acme/app', url: 'https://github.com/acme/app', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: daysAgo(1), openIssues: 0, openPrs: 0, syncedAt: daysAgo(0) },
  ...over,
})
const kinds = (p: Project) => health(p, members, NOW).map((f) => f.kind)

describe('health', () => {
  it('a healthy app has no flags', () => expect(kinds(app())).toEqual([]))
  it('no owner', () => expect(kinds(app({ ownerId: null }))).toEqual(['no-owner']))
  it('owner left (inactive) or unknown id', () => {
    expect(kinds(app({ ownerId: 'gone' }))).toEqual(['owner-left'])
    expect(kinds(app({ ownerId: 'deleted-member' }))).toEqual(['owner-left'])
  })
  it('warns in the 30 days before an owner leaves', () => {
    const departing = [member('m1', true, '2026-11-02')]
    expect(health(app(), departing, NOW)).toContainEqual({ kind: 'owner-leaving', severity: 'medium', label: 'Owner leaves on 2 Nov' })
    expect(health(app(), [member('m1', true, '2026-11-03')], NOW).map((f) => f.kind)).not.toContain('owner-leaving')
  })
  it('counts the owner as left on and after their leaving date', () => {
    expect(health(app(), [member('m1', true, '2026-10-03')], NOW).map((f) => f.kind)).toContain('owner-left')
    expect(health(app(), [member('m1', true, '2026-10-02')], NOW).map((f) => f.kind)).toContain('owner-left')
  })
  it('ignores an invalid leaving date', () => {
    expect(health(app(), [member('m1', true, 'not-a-date')], NOW).map((f) => f.kind)).toEqual([])
  })
  it('stale at 14 days, not at 13', () => {
    expect(kinds(app({ signals: { ...app().signals!, lastCommitAt: daysAgo(14) } }))).toEqual(['stale'])
    expect(kinds(app({ signals: { ...app().signals!, lastCommitAt: daysAgo(13.9) } }))).toEqual([])
  })
  it('public repo', () => expect(kinds(app({ repo: { ...app().repo!, private: false } }))).toEqual(['public-repo']))
  it('committed secrets name the files', () => {
    const f = health(app({ signals: { ...app().signals!, secretFiles: ['.env', 'config/key.pem'] } }), members, NOW)
    expect(f.map((x) => x.kind)).toEqual(['secrets'])
    expect(f[0].label).toContain('.env')
  })
  it('no README', () => expect(kinds(app({ signals: { ...app().signals!, hasReadme: false } }))).toEqual(['no-readme']))
  it('no repo connected: only ownership flags, plus a hint', () => expect(kinds(app({ repo: null, signals: null, ownerId: null }))).toEqual(['no-owner', 'no-repo']))
  it('sorted by severity: high first', () => {
    const p = app({ ownerId: null, repo: { ...app().repo!, private: false }, signals: { ...app().signals!, hasReadme: false, secretFiles: ['.env'] } })
    expect(health(p, members, NOW).map((f) => f.severity)).toEqual(['high', 'high', 'medium', 'low'])
  })
  it('archived apps are not flagged', () => expect(kinds(app({ archived: true, ownerId: null }))).toEqual([]))
  it('hides an acknowledged quiet period, then allows a later commit to become stale again', () => {
    const old = daysAgo(30)
    const keptAt = daysAgo(1)
    expect(health(app({ signals: { ...app().signals!, lastCommitAt: old } }), members, NOW, { keptAt }).map((f) => f.kind)).not.toContain('stale')
    expect(quietPeriodKept(daysAgo(20), daysAgo(25))).toBe(false)
    expect(health(app({ signals: { ...app().signals!, lastCommitAt: daysAgo(20) } }), members, NOW, { keptAt: daysAgo(25) }).map((f) => f.kind)).toContain('stale')
  })
  it('reads the shared acknowledgement from the project', () => {
    expect(kinds(app({ keptAt: daysAgo(1), signals: { ...app().signals!, lastCommitAt: daysAgo(30) } }))).not.toContain('stale')
  })

  it('ignores invalid keep dates', () => expect(quietPeriodKept(daysAgo(20), 'not-a-date')).toBe(false))
})

describe('health in a personal workspace', () => {
  it('never raises ownership flags: everything is yours', () => {
    const flags = (p: Project) => health(p, members, NOW, { personal: true }).map((f) => f.kind)
    expect(flags(app({ ownerId: null }))).not.toContain('no-owner')
    expect(flags(app({ ownerId: 'gone' }))).not.toContain('owner-left')
  })
})

describe('flagTone', () => {
  it('keeps red for real risk and turns people and pace flags amber', () => {
    expect(flagTone({ kind: 'secrets', severity: 'high' })).toBe('risk')
    expect(flagTone({ kind: 'public-repo', severity: 'medium' })).toBe('risk')
    expect(flagTone({ kind: 'no-owner', severity: 'high' })).toBe('warn')
    expect(flagTone({ kind: 'owner-left', severity: 'high' })).toBe('warn')
    expect(flagTone({ kind: 'stale', severity: 'medium' })).toBe('warn')
    expect(flagTone({ kind: 'no-repo', severity: 'low' })).toBe('quiet')
  })
})
