import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthFlag } from '../../ai/tools/health'
import { appDefaults } from '../../lib/model'
import { useStore } from '../../store/useStore'
import type { Project } from '../../types'
import { FlagFix, readmeDescription } from './FlagFix'

const project: Project = {
  id: 'app', name: 'Tempo', emoji: '🎯', color: 'violet', description: '', createdAt: '2026-10-01T00:00:00.000Z', archived: false,
  ...appDefaults(),
  repo: { fullName: 'acme/tempo', url: 'https://github.com/acme/tempo', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: ['.env'], lastCommitAt: '2026-10-04T00:00:00.000Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00.000Z' },
}

function render(flag: HealthFlag, patch: Partial<Project> = {}) {
  return renderToStaticMarkup(createElement(FlagFix, {
    flag,
    project: { ...project, ...patch },
    aiConnected: false,
    syncing: false,
    onSync: vi.fn(),
    onOwnerChange: vi.fn(),
    onPickOwner: vi.fn(),
    onHandover: vi.fn(),
  }))
}

beforeEach(() => useStore.setState({ members: [] }))

describe('FlagFix tone', () => {
  it('uses danger only for risk flags', () => {
    const html = render({ kind: 'secrets', severity: 'high', label: 'Secret file committed: .env' })
    expect(html).toContain('border-danger/25 bg-danger-soft/40')
    expect(html).toContain('text-danger')
  })

  it('uses warning for a high-severity ownership flag', () => {
    const html = render({ kind: 'no-owner', severity: 'high', label: 'No owner' }, { ownerId: null })
    expect(html).toContain('border-warning/25 bg-warning-soft/40')
    expect(html).toContain('text-warning')
    expect(html).not.toContain('text-danger')
  })

  it('uses neutral styling for quiet flags', () => {
    const html = render({ kind: 'no-repo', severity: 'low', label: 'No repo connected' }, { repo: null, signals: null })
    expect(html).toContain('border-border bg-surface-2')
    expect(html).toContain('text-text-muted')
  })
})

describe('owner fixes', () => {
  it('links no-owner health to the shared Owner picker', () => {
    const html = render({ kind: 'no-owner', severity: 'high', label: 'No owner' }, { ownerId: null })
    expect(html).toContain('>Pick owner</button>')
    expect(html).not.toContain('aria-haspopup')
  })

  it('keeps the owner-leaving picker in the health fix', () => {
    const html = render({ kind: 'owner-leaving', severity: 'medium', label: 'Owner leaves on 20 Oct' })
    expect(html).toContain('aria-haspopup="dialog"')
  })
})

describe('README draft facts', () => {
  it('falls back to the app card when the repo description is blank', () => {
    expect(readmeDescription({ ...project, description: '', appCard: { what: 'Nightly CRM warehouse sync', who: 'Data team', stage: 'stale', status: 'Quiet', updatedAt: 'now', source: 'fallback' } })).toBe('Nightly CRM warehouse sync')
    expect(readmeDescription({ ...project, description: 'Repo description', appCard: { what: 'Card copy', who: '', stage: 'live', status: '', updatedAt: 'now', source: 'fallback' } })).toBe('Repo description')
  })
})
