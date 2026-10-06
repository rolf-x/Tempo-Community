import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../../lib/model'
import type { SyncOutcome } from '../../ai/router'
import type { Project } from '../../types'
import { keepsExistingAICard, SyncPreview } from './SyncPreview'

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>()
  return {
    ...actual,
    Modal: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => createElement('div', null, children, footer),
  }
})

const project: Project = {
  ...appDefaults(), id: 'p_1', name: 'Tempo', emoji: 'T', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false,
  appCard: { what: 'AI card', who: 'Teams', stage: 'live', status: 'Running', updatedAt: '2026-10-01T00:00:00Z', source: 'ai', checkedAt: '2026-10-02T00:00:00Z' },
}
const outcome: SyncOutcome = {
  card: { what: 'Facts card', who: 'Not stated', stage: 'building', status: 'Rules only', checkedAt: null },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: null, openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' },
  facts: { meta: { fullName: 'acme/tempo', url: 'https://github.com/acme/tempo', private: true, defaultBranch: 'main', description: null, pushedAt: null }, readme: null, files: [], deployFile: null, commits: [], pulls: [], issues: [] },
  source: 'fallback',
  note: 'AI unavailable. Rules only.',
}

describe('keepsExistingAICard', () => {
  it('keeps an AI card when a No-AI or failed sync falls back to facts', () => {
    expect(keepsExistingAICard(project, outcome)).toBe(true)
    const html = renderToStaticMarkup(createElement(SyncPreview, { open: true, onClose: () => undefined, project, outcome }))
    expect(html).toContain('Repo facts refreshed. The AI-written card was kept.')
    expect(html).toContain('>Close</button>')
    expect(html).not.toContain('Save card')
  })

  it('allows a successful AI draft and a facts-only card refresh', () => {
    expect(keepsExistingAICard(project, { ...outcome, source: 'ai' })).toBe(false)
    expect(keepsExistingAICard({ ...project, appCard: { ...project.appCard!, source: 'fallback' } }, outcome)).toBe(false)
  })

  it("shows the new outcome's last commit instead of the kept card evidence", () => {
    const oldCommit = '2026-09-01T00:00:00Z'
    const nextCommit = '2026-10-03T00:00:00Z'
    const withOldEvidence = {
      ...project,
      appCard: {
        ...project.appCard!,
        evidence: { readme: null, deployFile: null, lastCommit: { message: 'Old commit', author: 'Maya', at: oldCommit, url: 'https://github.com/acme/tempo/commit/old' } },
      },
    }
    const html = renderToStaticMarkup(createElement(SyncPreview, {
      open: true,
      onClose: () => undefined,
      project: withOldEvidence,
      outcome: { ...outcome, signals: { ...outcome.signals, lastCommitAt: nextCommit } },
    }))
    expect(html).toContain('Last commit')
    expect(html).not.toContain('Old commit')
  })

  it('shows a deploy file in the card evidence rows', () => {
    const html = renderToStaticMarkup(createElement(SyncPreview, {
      open: true,
      onClose: () => undefined,
      project,
      outcome: {
        ...outcome,
        card: { ...outcome.card, evidence: { readme: null, lastCommit: null, deployFile: 'vercel.json' } },
      },
    }))
    expect(html).toContain('Deploy file')
    expect(html).toContain('vercel.json')
  })

  it('shows one plain sentence and keeps the raw sync error under Details', () => {
    const raw = 'could not start claude: spawn claude ENOENT'
    const html = renderToStaticMarkup(createElement(SyncPreview, {
      open: true,
      onClose: () => undefined,
      project,
      outcome: { ...outcome, note: null, error: raw, errorProvider: 'local' },
    }))
    expect(html).toContain('The local AI bridge is unavailable; start Tempo locally and make sure Claude Code is installed.')
    expect(html).toContain('>Details</summary>')
    expect(html).toContain(raw)
    expect(html).not.toContain('AI unavailable (')
  })
})
