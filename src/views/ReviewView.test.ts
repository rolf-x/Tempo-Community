import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../lib/model'
import { useStore } from '../store/useStore'
import type { Member, Project } from '../types'
import ReviewView from './ReviewView'

vi.mock('../store/useStore', async (original) => {
  const actual = await original<typeof import('../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})

const member = (id: string, role: Member['role'] = 'member'): Member => ({
  id, name: id, email: null, avatarUrl: null, githubLogin: id, userId: `${id}-user`, role, active: true,
})
const app = (id: string, ownerId: string, source: 'ai' | 'fallback' = 'ai'): Project => ({
  id, name: id, emoji: '', color: 'slate', description: '', createdAt: '2026-10-01', archived: false,
  ...appDefaults(), ownerId,
  appCard: { what: `${id} card`, who: 'Team', stage: 'live', status: 'Ready', updatedAt: '2026-10-04', source, checkedAt: source === 'ai' ? null : undefined },
})

beforeEach(() => {
  // The approve-card counts are the same in every mode; pin one so the build's VITE_AI_MODE doesn't change them.
  vi.stubEnv('VITE_AI_MODE', 'both')
  useStore.getState().resetAll()
  const viewer = member('viewer')
  useStore.setState({
    workspace: { id: 'team', name: 'Team' },
    members: [viewer, member('other')],
    meId: viewer.id,
    projects: [app('mine', viewer.id), app('foreign', 'other')],
  })
  useStore.getState().setAI({ provider: 'anthropic', apiKey: 'test-key' })
})

afterEach(() => vi.unstubAllEnvs())

describe('ReviewView permissions', () => {
  it('counts and renders only cards the member can approve', () => {
    const html = renderToStaticMarkup(createElement(ReviewView))
    expect(html).toContain('Check cards · 0 of 1')
    expect(html).toContain('mine card')
    expect(html).not.toContain('foreign card')
    expect(html).toContain('Looks right')
    expect(html).toContain('Draft again')
  })

  it('excludes facts-only cards from the list and progress count', () => {
    useStore.setState({ projects: [app('mine', 'viewer'), app('facts', 'viewer', 'fallback')] })
    const html = renderToStaticMarkup(createElement(ReviewView))
    expect(html).toContain('Check cards · 0 of 1')
    expect(html).toContain('mine card')
    expect(html).not.toContain('facts card')
  })

  it('hides redrafting when no AI is selected', () => {
    useStore.getState().setAI({ provider: 'none' })
    const html = renderToStaticMarkup(createElement(ReviewView))
    expect(html).toContain('Looks right')
    expect(html).not.toContain('Draft again')
  })

  it('shows no approval queue when every draft belongs to someone else', () => {
    useStore.setState({ projects: [app('foreign', 'other')] })
    const html = renderToStaticMarkup(createElement(ReviewView))
    expect(html).toContain('No app cards need checking.')
    expect(html).not.toContain('Looks right')
  })
})

describe('ReviewView author line', () => {
  const drafted = (patch: Partial<NonNullable<NonNullable<Project['appCard']>['draftedBy']>> = {}): Project => {
    const base = app('mine', 'viewer')
    return { ...base, appCard: { ...base.appCard!, draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'viewer', at: new Date().toISOString(), ...patch } } }
  }

  it('says who drafted an MCP card and for whom', () => {
    useStore.setState({ projects: [drafted()] })
    expect(renderToStaticMarkup(createElement(ReviewView))).toContain('Drafted by Claude Code for viewer · today')
  })

  it('names the agent once: the author line replaces the generic badge', () => {
    useStore.setState({ projects: [drafted()] })
    const html = renderToStaticMarkup(createElement(ReviewView))
    expect(html).not.toContain('Drafted by Tempo')
    expect(html.split('Drafted by Claude Code')).toHaveLength(2)
  })

  it('says a teammate when the member is unknown', () => {
    useStore.setState({ projects: [drafted({ memberId: 'gone' })] })
    expect(renderToStaticMarkup(createElement(ReviewView))).toContain('Drafted by Claude Code for a teammate · today')
  })

  it('shows no author line for a card Tempo drafted in the app', () => {
    expect(renderToStaticMarkup(createElement(ReviewView))).not.toContain('Drafted by Claude Code')
  })
})

