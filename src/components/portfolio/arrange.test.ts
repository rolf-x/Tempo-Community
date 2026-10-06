import { describe, expect, it } from 'vitest'
import type { HealthFlag } from '../../ai/tools/health'
import type { Member, Project } from '../../types'
import type { PortfolioRow } from './derive'
import { arrangePortfolioRows, defaultSortDirection, sortPortfolioRows, statusOf } from './arrange'

const member = (id: string, name: string, active = true): Member => ({ id, name, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active })
const flag = (kind: HealthFlag['kind'], severity: HealthFlag['severity'] = 'medium'): HealthFlag => ({ kind, severity, label: kind })
const project = (id: string, patch: Partial<Project> = {}): Project => ({
  id,
  name: id,
  emoji: 'T',
  color: 'blue',
  description: '',
  createdAt: '2026-01-01T00:00:00Z',
  archived: false,
  ownerId: 'maya',
  repo: { fullName: `team/${id}`, url: 'https://example.test', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-01T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-01T00:00:00Z' },
  appCard: { what: '', who: '', stage: 'live', status: '', updatedAt: '2026-10-01T00:00:00Z', source: 'demo' },
  lastActivityAt: '2026-10-01T00:00:00Z',
  autoApply: false,
  ...patch,
})
const row = (id: string, patch: Partial<PortfolioRow> = {}): PortfolioRow => ({
  project: project(id),
  owner: member('maya', 'Maya'),
  flags: [],
  needsAttention: false,
  last: null,
  lastAt: Date.parse('2026-10-01T00:00:00Z'),
  ...patch,
})

describe('portfolio sorting', () => {
  it('sorts status as risk, attention, then healthy with recent ties first', () => {
    const healthy = row('healthy')
    const oldRisk = row('old-risk', { flags: [flag('public-repo')], lastAt: 1 })
    const newRisk = row('new-risk', { flags: [flag('secrets', 'high')], lastAt: 2 })
    const warning = row('warning', { flags: [flag('stale')] })
    expect([oldRisk, newRisk, warning, healthy].map(statusOf)).toEqual(['risk', 'risk', 'attention', 'healthy'])
    expect(sortPortfolioRows([healthy, oldRisk, newRisk, warning], 'status', 'asc').map((item) => item.project.id))
      .toEqual(['new-risk', 'old-risk', 'warning', 'healthy'])
  })

  it('uses the requested stage, commit, name and owner orders without mutating input', () => {
    const noOwner = row('Zulu', { project: project('Zulu', { ownerId: null }), owner: null, flags: [flag('no-owner', 'high')] })
    const building = row('beta', { project: project('beta', { appCard: { ...project('beta').appCard!, stage: 'building' }, signals: { ...project('beta').signals!, lastCommitAt: '2026-10-03T00:00:00Z' } }), owner: member('zoe', 'Zoe') })
    const idea = row('Alpha', { project: project('Alpha', { appCard: { ...project('Alpha').appCard!, stage: 'idea' }, signals: { ...project('Alpha').signals!, lastCommitAt: '2026-10-02T00:00:00Z' } }), owner: member('amy', 'Amy') })
    const input = [idea, noOwner, building]
    expect(sortPortfolioRows(input, 'stage', 'asc').map((item) => item.project.id)).toEqual(['Zulu', 'beta', 'Alpha'])
    expect(sortPortfolioRows(input, 'last-commit', 'desc').map((item) => item.project.id)).toEqual(['beta', 'Alpha', 'Zulu'])
    expect(sortPortfolioRows(input, 'name', 'asc').map((item) => item.project.id)).toEqual(['Alpha', 'beta', 'Zulu'])
    expect(sortPortfolioRows(input, 'owner', 'asc').map((item) => item.project.id)).toEqual(['Zulu', 'Alpha', 'beta'])
    expect(input.map((item) => item.project.id)).toEqual(['Alpha', 'Zulu', 'beta'])
    expect(defaultSortDirection('last-commit')).toBe('desc')
    expect(defaultSortDirection('name')).toBe('asc')
  })
})

describe('portfolio grouping', () => {
  it('keeps canonical status and stage group order and sorts inside each group', () => {
    const rows = [
      row('healthy'),
      row('warning', { flags: [flag('stale')] }),
      row('risk', { flags: [flag('public-repo')] }),
      row('building', { project: project('building', { appCard: { ...project('building').appCard!, stage: 'building' } }) }),
    ]
    expect(arrangePortfolioRows(rows, 'status', 'name', 'asc').map((group) => [group.label, group.rows.length])).toEqual([
      ['At risk', 1], ['Needs a look', 1], ['Healthy', 2],
    ])
    expect(arrangePortfolioRows(rows, 'stage', 'name', 'asc').map((group) => group.label)).toEqual(['Live', 'Building'])
  })

  it('puts No owner before alphabetical owner groups', () => {
    const rows = [
      row('maya'),
      row('zoe', { owner: member('zoe', 'Zoe'), project: project('zoe', { ownerId: 'zoe' }) }),
      row('none', { owner: null, project: project('none', { ownerId: null }), flags: [flag('no-owner', 'high')] }),
    ]
    expect(arrangePortfolioRows(rows, 'owner', 'name', 'asc').map((group) => group.label)).toEqual(['No owner', 'Maya', 'Zoe'])
  })
})
