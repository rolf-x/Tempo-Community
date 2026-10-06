import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../../lib/model'
import type { Activity, Member, Project } from '../../types'
import { changedThisWeek, lastChangeAt, matchesFilter, portfolioCounts, portfolioRows } from './derive'
import { NoMatches } from './NoMatches'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const maya: Member = { id: 'maya', name: 'Maya', email: null, avatarUrl: null, githubLogin: 'maya', userId: 'u', role: 'owner', active: true }
// Every date in the fixture is old unless a test moves one, so each test changes only the date it is about.
const app = (id: string, change: Partial<Project> = {}, signals: Partial<NonNullable<Project['signals']>> = {}): Project => ({
  ...appDefaults(), id, name: id, emoji: 'A', color: 'blue', description: '', createdAt: ago(60 * DAY), archived: false, ownerId: 'maya',
  repo: { fullName: `acme/${id}`, url: `https://github.com/acme/${id}`, private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: ago(40 * DAY), openIssues: 0, openPrs: 0, syncedAt: ago(40 * DAY), ...signals },
  lastActivityAt: ago(40 * DAY), ...change,
})
const rowsOf = (projects: Project[], activity: Activity[] = []) => portfolioRows(projects, [maya], activity, NOW)
const commit = (projectId: string, at: string): Activity => ({ id: `c-${projectId}-${at}`, projectId, kind: 'commit', at, text: 'Fix', actorId: null } as unknown as Activity)

describe('Changed this week', () => {
  it('counts an app whose last change is inside the last 7 days, including exactly 7 days', () => {
    const rows = rowsOf([
      app('today', { lastActivityAt: ago(0) }),
      app('six-days', { lastActivityAt: ago(6 * DAY) }),
      app('seven-days', { lastActivityAt: ago(7 * DAY) }),
      app('just-over', { lastActivityAt: ago(7 * DAY + 1) }),
      app('quiet'),
    ])
    const changed = rows.filter((row) => changedThisWeek(row, NOW)).map((row) => row.project.id).sort()

    expect(changed).toEqual(['seven-days', 'six-days', 'today'])
    expect(portfolioCounts(rows, NOW).changed).toBe(3)
    expect(rows.filter((row) => matchesFilter(row, 'changed', null, NOW)).map((row) => row.project.id).sort()).toEqual(changed)
  })

  it('uses the newest of activity, lastActivityAt and last commit; being added this week is not a change', () => {
    const rows = rowsOf([
      app('by-push', { lastActivityAt: ago(DAY) }),
      app('by-commit', {}, { lastCommitAt: ago(2 * DAY) }),
      app('by-activity', {}),
      // Added to Tempo three days ago, but its repo hasn't moved: not a change (a whole portfolio added on day one
      // would otherwise all count as changed).
      app('added-this-week', { createdAt: ago(3 * DAY) }, { lastCommitAt: ago(90 * DAY) }),
      // An old logged event does not hide a newer push (the webhook moves lastActivityAt).
      app('old-event-new-push', { lastActivityAt: ago(DAY) }),
      app('quiet'),
    ], [commit('by-activity', ago(4 * DAY)), commit('old-event-new-push', ago(30 * DAY))])

    expect(rows.filter((row) => matchesFilter(row, 'changed', null, NOW)).map((row) => row.project.id).sort())
      .toEqual(['by-activity', 'by-commit', 'by-push', 'old-event-new-push'])
  })

  it('ignores sync events and missing or unreadable dates', () => {
    const rows = rowsOf([
      app('synced-only'),
      app('no-dates', { lastActivityAt: null, createdAt: 'not a date' }, { lastCommitAt: '' }),
    ], [{ id: 's', projectId: 'synced-only', kind: 'sync', at: ago(DAY), text: 'Synced' } as unknown as Activity])

    expect(rows.find((row) => row.project.id === 'no-dates')).toBeTruthy()
    expect(portfolioCounts(rows, NOW).changed).toBe(0)
    expect(lastChangeAt(rows.find((row) => row.project.id === 'no-dates')!)).toBe(0)
  })

  it('does not change the default view: All keeps every app in the same order, and the other counts are untouched', () => {
    const projects = [app('a', { lastActivityAt: ago(DAY) }), app('b'), app('c', { lastActivityAt: ago(3 * DAY) })]
    const rows = rowsOf(projects)

    expect(rows.filter((row) => matchesFilter(row, 'all', null, NOW))).toEqual(rows)
    expect(rows.map((row) => row.project.id)).toEqual(['a', 'c', 'b']) // newest first, as before
    expect(portfolioCounts(rows, NOW)).toEqual({ apps: 3, live: 0, attention: 3, stale: 3, noOwner: 0, changed: 2 }) // the last commit is old on all three
  })

  it('filters on the owner as well', () => {
    const rows = rowsOf([app('mine', { lastActivityAt: ago(DAY) }), app('theirs', { lastActivityAt: ago(DAY), ownerId: 'sam' })])
    expect(rows.filter((row) => matchesFilter(row, 'changed', 'maya', NOW)).map((row) => row.project.id)).toEqual(['mine'])
  })

  it('keeps a changed app out of the count once the week has passed', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
      const rows = rowsOf([app('a', { lastActivityAt: '2026-10-05T12:00:00.000Z' })])
      expect(portfolioCounts(rows).changed).toBe(1)
      vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z')) // exactly 7 days
      expect(portfolioCounts(rows).changed).toBe(1)
      vi.setSystemTime(new Date('2026-10-12T12:00:00.001Z'))
      expect(portfolioCounts(rows).changed).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('NoMatches', () => {
  const html = (filter: Parameters<typeof NoMatches>[0]['filter'], ownerFiltered = false) =>
    renderToStaticMarkup(createElement(NoMatches, { filter, ownerFiltered, onClear: vi.fn() }))

  it('says no app changed this week when that filter leaves nothing', () => {
    const out = html('changed')
    expect(out).toContain('No app changed this week')
    expect(out).toContain('An app shows up here as soon as someone pushes to it.')
    expect(out).toContain('>Show all apps</button>')
    expect(out).not.toContain('No apps match')
  })

  it('keeps the general message for other filters, and when an owner is picked too', () => {
    for (const out of [html('stale'), html('changed', true)]) {
      expect(out).toContain('No apps match')
      expect(out).toContain('Nothing fits these filters.')
      expect(out).toContain('>Clear filters</button>')
      expect(out).not.toContain('No app changed this week')
    }
  })
})
