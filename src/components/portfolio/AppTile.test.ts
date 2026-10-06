import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import type { Member, Project } from '../../types'
import { AppTile, lastActivityText } from './AppTile'
import type { PortfolioRow } from './derive'

const picker = vi.hoisted(() => ({ props: null as null | { onChange: (ownerId: string | null) => void; inviteOnAssign: { projectId: string; appName: string } } }))

vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})
vi.mock('../people/MemberPicker', () => ({
  MemberPicker: (props: { onChange: (ownerId: string | null) => void; inviteOnAssign: { projectId: string; appName: string }; trigger: ReactNode }) => {
    picker.props = props
    return props.trigger
  },
}))

const project: Project = {
  id: 'app', name: 'Tempo', emoji: '🎤', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false,
  ownerId: null, repo: null, signals: null, lastActivityAt: null, autoApply: false,
  appCard: { what: 'Plan work.', who: 'Teams.', stage: 'building', status: 'In progress', updatedAt: '2026-10-01T00:00:00Z', source: 'fallback' },
}
const row: PortfolioRow = {
  project, owner: null, flags: [], needsAttention: true, last: null, lastAt: 0,
}
const formerOwner: Member = {
  id: 'former', name: 'Maya', email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: false,
}

beforeEach(() => {
  useStore.getState().resetAll()
  useStore.setState({ projects: [project] })
  useStore.getState().setAI({ provider: 'none' })
  picker.props = null
})
afterEach(() => vi.unstubAllEnvs())

describe('AppTile', () => {
  it('does not present a sync row as real app activity', () => {
    const sync = { id: 'sync', projectId: project.id, kind: 'sync' as const, actor: 'Tempo', title: 'Synced', url: null, at: '2026-10-04T00:00:00Z' }
    const withCommit = { ...row, project: { ...project, signals: { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-01T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: sync.at } }, last: sync }
    expect(lastActivityText(withCommit, Date.parse('2026-10-05T00:00:00Z'))).toBe('Last commit · 4 d ago')
  })

  it('hides the drafting button without AI', () => {
    const html = renderToStaticMarkup(createElement(AppTile, { row, href: '#/p/app/app' }))
    expect(html).not.toContain('Pick your AI')
    expect(html).not.toContain('Draft again')
    expect(html).not.toContain('🎤')
    expect(html).toContain('bg-p-blue-soft')
  })

  it('keeps Draft again when AI is connected', () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    useStore.getState().setAI({ provider: 'anthropic' })
    const html = renderToStaticMarkup(createElement(AppTile, { row, href: '#/p/app/app' }))
    expect(html).toContain('Draft again')
  })

  describe('an out-of-date AI card with no key', () => {
    const stale = (): PortfolioRow => ({
      ...row,
      project: {
        ...project,
        repo: { fullName: 'acme/tempo', url: 'https://github.com/acme/tempo', private: true, defaultBranch: 'main' },
        signals: { hasReadme: true, secretFiles: ['.env'], lastCommitAt: '2026-10-03T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' },
        appCard: {
          what: 'Plan work.', who: 'Teams.', stage: 'building', status: 'No secrets.', updatedAt: '2026-10-01T00:00:00Z', source: 'ai',
          evidence: { readme: null, deployFile: null, lastCommit: null, repoFacts: { hasReadme: true, secretFiles: [], private: true, lastCommitAt: '2026-10-03T00:00:00Z' } },
        },
      },
    })

    it.each(['both', 'mcp'])('asks Claude to draft it again in %s mode, where Claude is on', (mode) => {
      vi.stubEnv('VITE_AI_MODE', mode)
      const html = renderToStaticMarkup(createElement(AppTile, { row: stale(), href: '#/p/app/app' }))
      expect(html).toContain('title="Ask Claude to draft this card again"')
      expect(html).not.toContain('Draft again')
    })
  })

  it('links an out-of-date AI card to Settings when no AI is connected', () => {
    vi.stubEnv('VITE_AI_MODE', 'legacy')
    const staleProject: Project = {
      ...project,
      repo: { fullName: 'acme/tempo', url: 'https://github.com/acme/tempo', private: true, defaultBranch: 'main' },
      signals: { hasReadme: true, secretFiles: ['.env'], lastCommitAt: '2026-10-03T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' },
      appCard: {
        what: 'Plan work.', who: 'Teams.', stage: 'building', status: 'No secrets.', updatedAt: '2026-10-01T00:00:00Z', source: 'ai',
        evidence: { readme: null, deployFile: null, lastCommit: null, repoFacts: { hasReadme: true, secretFiles: [], private: true, lastCommitAt: '2026-10-03T00:00:00Z' } },
      },
    }
    const html = renderToStaticMarkup(createElement(AppTile, { row: { ...row, project: staleProject }, href: '#/p/app/app' }))
    expect(html).toContain('>Out of date</a>')
    expect(html).toContain('title="Pick your AI to draft this card again"')
    expect(html).toContain('href="#/settings"')
    expect(html).not.toContain('Draft again')
  })

  it('moves owner warnings to the footer picker and keeps other compact flags', () => {
    const flagged = {
      ...row,
      flags: [
        { kind: 'no-owner' as const, severity: 'high' as const, label: 'No owner' },
        { kind: 'public-repo' as const, severity: 'medium' as const, label: 'Public repo' },
        { kind: 'no-readme' as const, severity: 'low' as const, label: 'No README' },
      ],
    }
    const html = renderToStaticMarkup(createElement(AppTile, { row: flagged, href: '#/p/app/app' }))

    expect(html).toContain('>No owner</button>')
    expect(html).not.toContain('title="No owner"')
    expect(html).toContain('title="Public repo"')
    expect(html).toContain('title="No README"')
    expect(picker.props?.inviteOnAssign).toEqual({ projectId: 'app', appName: 'Tempo' })

    picker.props?.onChange('m1')
    expect(useStore.getState().projects[0].ownerId).toBe('m1')
  })

  it('makes a departed owner footer the picker without repeating its flag', () => {
    const departedProject = { ...project, ownerId: formerOwner.id }
    const departed = {
      ...row,
      project: departedProject,
      owner: formerOwner,
      flags: [{ kind: 'owner-left' as const, severity: 'high' as const, label: 'Owner has left' }],
    }
    useStore.setState({ projects: [departedProject], members: [formerOwner] })

    const html = renderToStaticMarkup(createElement(AppTile, { row: departed, href: '#/p/app/app' }))
    expect(html).toContain('Maya<span class="font-normal text-text-muted"> · left</span>')
    expect(html).not.toContain('title="Owner has left"')
  })
})
