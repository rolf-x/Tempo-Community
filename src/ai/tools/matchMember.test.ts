import { describe, expect, it } from 'vitest'
import { commitShareWindowStart, matchMember, suggestOwnerByCommitShare, suggestionSinceLabel } from './matchMember'
import type { Member } from '../../types'

const m = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  id, name, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: true, ...extra,
})
const team = [m('m1', 'Sam Haddad', { githubLogin: 'samh' }), m('m2', 'Nadia Karam'), m('m3', 'Samir Aoun'), m('m4', 'Lina Old', { active: false })]

describe('matchMember', () => {
  it('matches a full name, case-insensitive', () => expect(matchMember('nadia karam', team)).toBe('m2'))
  it('matches a unique first name', () => expect(matchMember('Nadia', team)).toBe('m2'))
  it('prefers an exact first name over a prefix ("Sam" is not "Samir")', () => expect(matchMember('Sam', team)).toBe('m1'))
  it('matches a GitHub login, with or without @', () => {
    expect(matchMember('@samh', team)).toBe('m1')
    expect(matchMember('samh', team)).toBe('m1')
  })
  it('matches email and a git name/email author', () => {
    const people = [m('m1', 'Sam Haddad', { email: 'sam@example.com' })]
    expect(matchMember('SAM@example.com', people)).toBe('m1')
    expect(matchMember('Sam Haddad <sam@example.com>', people)).toBe('m1')
  })
  it('returns null when ambiguous', () => {
    const two = [m('a', 'Sam One'), m('b', 'Sam Two')]
    expect(matchMember('Sam', two)).toBeNull()
  })
  it('returns null for no match, blank or null', () => {
    expect(matchMember('Zed', team)).toBeNull()
    expect(matchMember('  ', team)).toBeNull()
    expect(matchMember(null, team)).toBeNull()
  })
  it('still matches people who left (they keep their history)', () => expect(matchMember('Lina', team)).toBe('m4'))
})

describe('suggestOwnerByCommitShare', () => {
  const since = new Date('2026-07-01T00:00:00.000Z')
  const commits = [
    ...Array.from({ length: 4 }, () => ({ author: 'samh', date: '2026-09-01T10:00:00.000Z' })),
    { author: 'Nadia Karam', date: '2026-08-01T10:00:00.000Z' },
    { author: 'samh', date: '2026-06-30T23:59:59.000Z' },
  ]

  it('matches the top author to a member and reports their share inside the window', () => {
    expect(suggestOwnerByCommitShare(commits, team, since)).toMatchObject({
      name: 'Sam Haddad', memberId: 'm1', commits: 4, totalCommits: 5, share: 80,
    })
  })

  it('offers an author who is not a member yet', () => {
    expect(suggestOwnerByCommitShare([
      { authorName: 'Rami Saleh', authorEmail: 'rami@example.com', authorLogin: 'ramis', date: '2026-09-01T10:00:00.000Z' },
      { author: 'ramis', date: '2026-09-02T10:00:00.000Z' },
    ], team, since)).toMatchObject({ name: 'Rami Saleh', login: 'ramis', email: 'rami@example.com', memberId: null, share: 100 })
  })

  it('returns no suggestion for a tie, unknown authors, old commits or a known former member', () => {
    expect(suggestOwnerByCommitShare([
      { author: 'samh', date: '2026-09-01T10:00:00.000Z' },
      { author: 'nobody', date: '2026-09-01T10:00:00.000Z' },
    ], team, since)).toBeNull()
    expect(suggestOwnerByCommitShare([{ author: 'unknown', date: '2026-09-01T10:00:00.000Z' }], team, since)).toBeNull()
    expect(suggestOwnerByCommitShare([{ author: 'samh', date: '2026-06-01T10:00:00.000Z' }], team, since)).toBeNull()
    expect(suggestOwnerByCommitShare([{ author: 'Lina Old', date: '2026-09-01T10:00:00.000Z' }], team, since)).toBeNull()
  })

  it('uses a three-month calendar window and a plain month label', () => {
    const start = commitShareWindowStart(new Date('2026-10-04T12:00:00.000Z'))
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(6)
    expect(start.getDate()).toBe(1)
    expect(suggestionSinceLabel(start.toISOString())).toBe('July')
  })
})
