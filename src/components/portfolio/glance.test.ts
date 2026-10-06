import { describe, expect, it } from 'vitest'
import type { HealthFlag } from '../../ai/tools/health'
import type { PortfolioRow } from './derive'
import { donutArcs, healthCounts, orderByHealth, ownershipCounts, pulseCounts, pulsePoints, pulsePosition, stageSegments, worstHealth } from './glance'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const flag = (kind: HealthFlag['kind'], severity: HealthFlag['severity'], label: string = kind): HealthFlag => ({ kind, severity, label })
const row = (id: string, patch: Partial<PortfolioRow> = {}): PortfolioRow => ({
  project: {
    id, name: id, emoji: 'T', color: 'blue', description: '', createdAt: ago(30), archived: false,
    ownerId: 'm1', repo: { fullName: `team/${id}`, url: 'https://example.test', private: true, defaultBranch: 'main' },
    signals: { hasReadme: true, secretFiles: [], lastCommitAt: ago(2), openIssues: 0, openPrs: 0, syncedAt: ago(1) },
    appCard: { what: '', who: '', stage: 'live', status: '', updatedAt: ago(1), source: 'demo' },
    lastActivityAt: ago(2), autoApply: false,
  },
  owner: null,
  flags: [],
  needsAttention: false,
  last: null,
  lastAt: Date.parse(ago(2)),
  ...patch,
})

describe('health and ownership maths', () => {
  it('uses flag tone precedence and treats low-only apps as healthy', () => {
    const low = row('low', { flags: [flag('no-readme', 'low', 'No README')] })
    const warn = row('warn', { flags: [flag('stale', 'medium', 'Quiet'), flag('no-readme', 'low')] })
    const risk = row('risk', { flags: [flag('stale', 'medium'), flag('public-repo', 'medium', 'Public repo')] })
    expect(worstHealth(low)).toEqual({ bucket: 'healthy', flag: low.flags[0] })
    expect(worstHealth(warn).bucket).toBe('warn')
    expect(worstHealth(risk)).toEqual({ bucket: 'risk', flag: risk.flags[1] })
    expect(healthCounts([low, warn, risk, row('clear')])).toEqual({ risk: 1, warn: 1, healthy: 2 })
  })

  it('groups health-map rows risk first, then warning, then healthy, preserving order within each group', () => {
    const firstHealthy = row('healthy-1')
    const firstWarn = row('warn-1', { flags: [flag('stale', 'medium')] })
    const risk = row('risk', { flags: [flag('public-repo', 'medium')] })
    const secondWarn = row('warn-2', { flags: [flag('stale', 'medium')] })
    const secondHealthy = row('healthy-2')
    expect(orderByHealth([firstHealthy, firstWarn, risk, secondWarn, secondHealthy]).map((item) => item.project.id)).toEqual([
      'risk', 'warn-1', 'warn-2', 'healthy-1', 'healthy-2',
    ])
  })

  it('counts owners using ownership health flags and creates normalized donut arcs', () => {
    const left = row('left', { flags: [flag('owner-left', 'high')] })
    expect(ownershipCounts([row('owned'), left])).toEqual({ total: 2, owned: 1, unowned: 1, ownedShare: 50 })
    expect(donutArcs(3, 4)).toEqual({
      owned: { dash: '75 25', offset: 0 },
      unowned: { dash: '25 75', offset: -75 },
    })
  })
})

describe('stage and pulse maths', () => {
  it('returns ordered stage segments with percentages and a no-card segment', () => {
    const building = row('building')
    building.project.appCard = { ...building.project.appCard!, stage: 'building' }
    const none = row('none')
    none.project.appCard = null
    const segments = stageSegments([row('live'), building, none])
    expect(segments.map(({ stage, count }) => ({ stage, count }))).toEqual([
      { stage: 'live', count: 1 },
      { stage: 'building', count: 1 },
      { stage: 'idea', count: 0 },
      { stage: 'stale', count: 0 },
      { stage: 'none', count: 1 },
    ])
    expect(segments[0].start).toBe(0)
    expect(segments[1].start).toBeCloseTo(100 / 3)
    expect(segments[4].start).toBeCloseTo(200 / 3)
    expect(segments[4].share).toBeCloseTo(100 / 3)
  })

  it('positions the pulse across 60 days and clamps older activity', () => {
    expect(pulsePosition(Date.parse(ago(0)), NOW)).toMatchObject({ x: 100, quiet: false, olderThanRange: false })
    expect(pulsePosition(Date.parse(ago(30)), NOW)).toMatchObject({ x: 50, quiet: true, olderThanRange: false })
    expect(pulsePosition(Date.parse(ago(60)), NOW)).toMatchObject({ x: 0, olderThanRange: false })
    expect(pulsePosition(Date.parse(ago(80)), NOW)).toMatchObject({ x: 0, olderThanRange: true })
    expect(pulsePosition(0, NOW)).toBeNull()
  })

  it('uses commit time before row activity, spreads collisions over four lanes and counts missing data', () => {
    const same = Array.from({ length: 5 }, (_, index) => row(`same-${index}`))
    const fallback = row('fallback', { lastAt: Date.parse(ago(20)) })
    fallback.project.signals = null
    const missing = row('missing', { lastAt: 0 })
    missing.project.signals = null
    const points = pulsePoints([...same, fallback, missing], NOW)
    expect(points.filter((point) => point.row.project.id.startsWith('same')).map((point) => point.lane)).toEqual([0, 1, 2, 3, 0])
    expect(points.find((point) => point.row.project.id === 'fallback')?.x).toBeCloseTo(200 / 3)
    expect(points.some((point) => point.row.project.id === 'missing')).toBe(false)
    expect(pulseCounts([...same, fallback, missing], NOW)).toEqual({ active: 5, quiet: 1, noData: 1 })
  })
})
