import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import type { Member, Project } from '../types'
import PortfolioView from './PortfolioView'

vi.mock('../store/useStore', async (original) => {
  const actual = await original<typeof import('../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})
vi.mock('../components/guide/NextStepBar', () => ({ NextStepBar: () => null }))

const member: Member = { id: 'm1', name: 'Maya', email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'owner', active: true }
const project = (ownerId: string | null): Project => ({
  id: 'app', name: 'Tempo', emoji: 'T', color: 'blue', description: 'Plans work.', createdAt: '2026-10-01T00:00:00Z', archived: false,
  ownerId, repo: { fullName: 'team/tempo', url: 'https://github.com/team/tempo', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-03T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-03T00:00:00Z' },
  appCard: { what: 'Plans work.', who: 'Teams.', stage: 'live', status: 'Live', updatedAt: '2026-10-03T00:00:00Z', source: 'demo' },
  lastActivityAt: '2026-10-03T00:00:00Z', autoApply: false,
})

beforeEach(() => {
  useStore.getState().resetAll()
  useStore.setState({ members: [member], meId: 'm1', projects: [project('m1')], workspace: { id: 'team', name: 'Team' } })
})

afterEach(() => vi.useRealTimers())

describe('PortfolioView', () => {
  it('shows the portfolio dashboard', () => {
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toContain('At a glance')
    expect(html).not.toContain('href="#/digest"')
    expect(html).toContain('aria-label="Tempo: Healthy"')
  })

  it('shows stages without owner wording in a personal workspace', () => {
    useStore.setState({
      workspace: { id: 'personal', name: 'Personal', kind: 'personal' },
      members: [{ ...member, role: 'member' }],
      projects: Array.from({ length: 5 }, (_, index) => ({ ...project(null), id: `app-${index}`, name: `App ${index}` })),
    })
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toContain('>Stages</p>')
    expect(html).not.toContain('>Ownership</p>')
    expect(html).not.toContain('without an owner')
    expect(html).not.toContain('aria-label="App scope"')
    expect(html).toContain('5 apps · 5 live')
  })

  it('quiets inactive zero-count filters without dimming the active filter', () => {
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?<span class="">All<\/span><span class="tabular-nums text-text-muted">1<\/span>/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?<span class="text-text-faint">Needs attention<\/span><span class="tabular-nums text-text-faint">0<\/span>/)
    expect(html).toMatch(/<span class="text-text-faint">Stale<\/span><span class="tabular-nums text-text-faint">0<\/span>/)
  })

  it('uses an amber dot and normal text when apps need attention', () => {
    useStore.setState({ projects: [project(null)] })
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toContain('rounded-full bg-warning')
    expect(html).toContain('1 needs attention')
    expect(html).not.toContain('font-medium text-danger')
  })

  it('defaults developers to their apps before counts, filters and cards', () => {
    useStore.setState({
      members: [{ ...member, role: 'member' }],
      projects: [{ ...project('m1'), id: 'mine', name: 'Mine' }, { ...project(null), id: 'other', name: 'Other app' }],
    })
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toContain('aria-label="App scope"')
    expect(html).toMatch(/aria-selected="true"[^>]*title="My apps"/)
    expect(html).toContain('1 app · 1 live')
    expect(html).toContain('>Mine</a>')
    expect(html).not.toContain('>Other app</a>')
    expect(html).toContain('>All</span><span class="tabular-nums text-text-muted">1</span>')
    expect(html).not.toContain('>No owner</span>')
  })

  it('shows the dedicated My apps empty state when a developer owns none', () => {
    useStore.setState({ members: [{ ...member, role: 'member' }], projects: [{ ...project(null), id: 'other' }] })
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toContain('No apps of yours yet')
    expect(html).toContain('See all apps')
    expect(html).toContain('0 apps · 0 live')
  })
})

describe('PortfolioView: Changed this week', () => {
  const today = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
  }

  it('adds the chip with its count, without touching the other chips or the default filter', () => {
    today('2026-10-06T12:00:00Z') // the app's last change is 3 days old
    const html = renderToStaticMarkup(createElement(PortfolioView))

    expect(html).toContain('>Changed this week</span><span class="tabular-nums text-text-muted">1</span>')
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?<span class="">All<\/span><span class="tabular-nums text-text-muted">1<\/span>/)
    expect(html).toMatch(/aria-pressed="false"[^>]*><span class="">Changed this week<\/span>/)
    expect(html).toContain('>Needs attention</span>')
    expect(html).toContain('>Tempo</a>') // the card is still listed
  })

  it('quiets the count when nothing changed this week', () => {
    today('2026-10-20T12:00:00Z') // 17 days later
    const html = renderToStaticMarkup(createElement(PortfolioView))

    expect(html).toContain('<span class="text-text-faint">Changed this week</span><span class="tabular-nums text-text-faint">0</span>')
  })

  it('counts an app on the day it is exactly 7 days old and not a moment later', () => {
    today('2026-10-10T00:00:00Z') // last change 2026-10-03T00:00:00Z
    expect(renderToStaticMarkup(createElement(PortfolioView))).toContain('>Changed this week</span><span class="tabular-nums text-text-muted">1</span>')
    today('2026-10-10T00:00:01Z')
    expect(renderToStaticMarkup(createElement(PortfolioView))).toContain('<span class="text-text-faint">Changed this week</span>')
  })
})

