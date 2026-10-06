import { describe, expect, it } from 'vitest'
import { DEAD_DAYS, findDeadApps, findDuplicates, savedEstimate } from './overlap'
import type { Activity, Project } from '../../types'
import { appDefaults } from '../../lib/model'

const NOW = new Date('2026-10-03T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const app = (id: string, name: string, what: string, over: Partial<Project> = {}): Project => ({
  id, name, emoji: '📁', color: 'blue', description: '', createdAt: daysAgo(200), archived: false, ...appDefaults(),
  ownerId: 'm1',
  repo: { fullName: `acme/${id}`, url: `https://github.com/acme/${id}`, private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: daysAgo(1), openIssues: 0, openPrs: 0, syncedAt: daysAgo(0) },
  appCard: { what, who: 'Everyone', stage: 'live', status: '', updatedAt: daysAgo(1), source: 'demo' },
  ...over,
})
const act = (projectId: string, d: number): Activity => ({ id: `a${projectId}${d}`, projectId, kind: 'commit', actor: 'x', title: 't', url: null, at: daysAgo(d) })

const expense = app('e', 'Expense Bot', 'A Slack bot that reads receipt photos and adds each expense to the finance sheet.')
const receipts = app('r', 'Receipts Helper', 'Upload a receipt photo and it extracts the amount and files the expense in the finance spreadsheet.')
const desk = app('d', 'Desk Booking', 'A page to book a desk for office days, with a floor map.')

describe('findDuplicates', () => {
  it('groups apps with the same purpose and explains why', () => {
    const g = findDuplicates([expense, receipts, desk])
    expect(g).toHaveLength(1)
    expect(g[0].appIds.sort()).toEqual(['e', 'r'])
    expect(g[0].reason).toMatch(/expense|receipt/)
    expect(g[0].score).toBeGreaterThan(0.25)
  })
  it('does not group unrelated apps', () => {
    expect(findDuplicates([expense, desk, app('s', 'Sales Dashboard', 'Pipeline and quota view pulled from the CRM hourly.')])).toEqual([])
  })
  it('excludes archived apps', () => {
    expect(findDuplicates([expense, { ...receipts, archived: true }])).toEqual([])
  })
  it('is deterministic and handles apps without a card', () => {
    const bare = app('b', 'Thing', '', { appCard: null })
    expect(findDuplicates([receipts, bare, expense])).toEqual(findDuplicates([expense, bare, receipts]))
  })
})

describe('findDeadApps', () => {
  const at = (d: number) => app('x', 'X', 'x', { signals: { ...expense.signals!, lastCommitAt: daysAgo(d) } })
  it('dead at 30 days, not at 29', () => {
    expect(DEAD_DAYS).toBe(30)
    expect(findDeadApps([at(30)], [], NOW).map((d) => d.days)).toEqual([30])
    expect(findDeadApps([at(29)], [], NOW)).toEqual([])
  })
  it('a recent commit in the activity feed keeps an app alive', () => {
    expect(findDeadApps([at(90)], [act('x', 2)], NOW)).toEqual([])
    expect(findDeadApps([at(90)], [act('other', 2)], NOW)).toHaveLength(1)
  })
  it('a recent sync does not make a dead app active', () => {
    expect(findDeadApps([at(90)], [{ ...act('x', 1), kind: 'sync' }], NOW).map((d) => d.days)).toEqual([90])
  })
  it('skips archived apps; new apps with nothing yet use their creation date', () => {
    expect(findDeadApps([{ ...at(90), archived: true }], [], NOW)).toEqual([])
    expect(findDeadApps([app('n', 'N', 'n', { signals: null, createdAt: daysAgo(3) })], [], NOW)).toEqual([])
    expect(findDeadApps([app('n', 'N', 'n', { signals: null, createdAt: daysAgo(40) })], [], NOW)[0].reason).toMatch(/30\+|40/)
  })
})

describe('savedEstimate', () => {
  it('counts only', () => {
    const e = savedEstimate(findDuplicates([expense, receipts]), findDeadApps([app('x', 'X', 'x', { signals: null, createdAt: daysAgo(60) })], [], NOW))
    expect(e).toEqual({ duplicateGroups: 1, appsInDuplicateGroups: 2, deadApps: 1, appsToReview: 3 })
  })
})

describe('kept quiet apps', () => {
  it('are not listed as abandoned once someone chose to keep the quiet period', async () => {
    const { findDeadApps } = await import('./overlap')
    const now = new Date('2026-10-04T12:00:00Z')
    const base = { id: 'p_old', name: 'Legacy crm sync', archived: false, createdAt: '2026-01-01T00:00:00Z', lastActivityAt: null, signals: { lastCommitAt: '2026-07-22T00:00:00Z' } }
    expect(findDeadApps([base] as never, [], now)).toHaveLength(1)
    expect(findDeadApps([{ ...base, keptAt: '2026-10-04T10:00:00Z' }] as never, [], now)).toHaveLength(0)
  })
})
