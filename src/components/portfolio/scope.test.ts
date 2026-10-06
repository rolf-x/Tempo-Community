import { describe, expect, it } from 'vitest'
import type { Member, Project } from '../../types'
import { appDefaults } from '../../lib/model'
import { portfolioCounts, portfolioRows } from './derive'
import { defaultPortfolioScope, portfolioStorageKey, rowsInScope } from './scope'

const member = (id: string, role: Member['role'] = 'member', isAdmin = false): Member => ({
  id, name: id, email: null, avatarUrl: null, githubLogin: id, userId: id, role, isAdmin, active: true,
})
const app = (id: string, ownerId: string | null, stale = false): Project => ({
  ...appDefaults(), id, name: id, emoji: 'A', color: 'blue', description: '', createdAt: '2026-09-01T00:00:00Z', archived: false,
  ownerId, repo: { fullName: `team/${id}`, url: `https://github.com/team/${id}`, private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: stale ? '2026-09-01T00:00:00Z' : '2026-10-03T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' },
  appCard: { what: id, who: 'Team', stage: stale ? 'stale' : 'live', status: 'Known', updatedAt: '2026-10-04T00:00:00Z', source: 'fallback' },
})

describe('portfolio scope', () => {
  const me = member('me')
  const teammate = member('other')
  const members = [me, teammate]
  const rows = portfolioRows([app('mine', 'me'), app('theirs', 'other', true), app('unowned', null)], members, [], new Date('2026-10-04T12:00:00Z'))

  it('separates my, team and all apps before counts', () => {
    const mine = rowsInScope(rows, 'my', me.id, members)
    const team = rowsInScope(rows, 'team', me.id, members)
    const all = rowsInScope(rows, 'all', me.id, members)
    expect(mine.map((row) => row.project.id)).toEqual(['mine'])
    expect(team.map((row) => row.project.id)).toEqual(['theirs'])
    expect(all).toHaveLength(3)
    expect(portfolioCounts(mine)).toMatchObject({ apps: 1, live: 1, stale: 0, noOwner: 0 })
    expect(portfolioCounts(team)).toMatchObject({ apps: 1, live: 0, stale: 1, noOwner: 0 })
    expect(portfolioCounts(all)).toMatchObject({ apps: 3, live: 2, stale: 1, noOwner: 1 })
  })

  it('defaults owners and admins to all, and members to my apps', () => {
    expect(defaultPortfolioScope(member('owner', 'owner'))).toBe('all')
    expect(defaultPortfolioScope(member('admin', 'member', true))).toBe('all')
    expect(defaultPortfolioScope(me)).toBe('my')
  })

  it('stores each viewer under a separate key', () => {
    expect(portfolioStorageKey('me')).not.toBe(portfolioStorageKey('other'))
  })
})
