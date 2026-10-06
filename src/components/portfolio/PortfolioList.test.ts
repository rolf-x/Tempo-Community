import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../types'
import type { PortfolioRow } from './derive'
import { PortfolioList } from './PortfolioList'

vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})

const project = (id: string, ownerId: string | null): Project => ({
  id, name: id, emoji: 'T', color: 'blue', description: '', createdAt: '2026-01-01T00:00:00Z', archived: false, ownerId,
  repo: { fullName: `team/${id}`, url: 'https://example.test', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-03T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-03T00:00:00Z' },
  appCard: { what: '', who: '', stage: 'live', status: '', updatedAt: '2026-10-03T00:00:00Z', source: 'demo' },
  lastActivityAt: '2026-10-03T00:00:00Z', autoApply: false,
})
const row = (id: string): PortfolioRow => ({
  project: project(id, null), owner: null,
  flags: [
    { kind: 'no-owner', severity: 'high', label: 'No owner' },
    { kind: 'public-repo', severity: 'medium', label: 'Public repo' },
    { kind: 'no-readme', severity: 'low', label: 'No README' },
  ],
  needsAttention: true,
  last: null,
  lastAt: Date.parse('2026-10-03T00:00:00Z'),
})

describe('PortfolioList', () => {
  it('renders grouped, sortable rows with compact mobile columns and owner assignment', () => {
    const html = renderToStaticMarkup(createElement(PortfolioList, {
      rows: [row('Tempo')], group: 'stage', sort: 'last-commit', direction: 'desc', onSort: () => {},
    }))
    expect(html).toContain('aria-label="Apps list"')
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Live <span class="font-normal tabular-nums text-text-faint">1</span>')
    expect(html).toContain('href="#/p/Tempo/app"')
    expect(html).toContain('team/Tempo')
    expect(html).toContain('>Pick owner</button>')
    expect(html).toContain('hidden sm:table-cell')
    expect(html).toContain('bg-danger-soft text-danger')
    expect(html).toContain('bg-warning-soft text-warning')
    expect(html).toContain('>+1</li>')
  })
})
