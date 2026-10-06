import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextStep, type GuideSnapshot } from '../../lib/nextStep'
import { SetupChecklist } from './SetupChecklist'
import { NextStepBar } from './NextStepBar'
import { useGuide } from './useGuide'

vi.mock('./useGuide', () => ({ useGuide: vi.fn() }))

const snapshot: GuideSnapshot = {
  projects: [], members: [], me: { id: 'owner', name: 'Maya', active: true, role: 'owner', email: null, avatarUrl: null, githubLogin: 'maya', userId: 'user' }, workspace: { id: 'team', name: 'Team' }, githubLogin: 'maya', githubConnected: true,
  settings: { ai: { provider: 'demo', preset: null, baseUrl: null, apiKey: null, model: null }, theme: 'dark', teamSize: 5, onboarded: true, demo: false },
}
const state = () => ({ ...nextStep(snapshot), visible: true, checklistCollapsed: false, setCollapsed: vi.fn() })

beforeEach(() => vi.mocked(useGuide).mockReturnValue(state()))

describe('guide rendering', () => {
  it('renders compact progress, all steps, results and accessible completion labels', () => {
    const html = renderToStaticMarkup(createElement(SetupChecklist))
    expect(html).toContain('Get set up · 1 of 5')
    expect(html).toContain('Done: ')
    expect(html).toContain('To do: ')
    expect(html).toContain('maya')
    expect(html).toContain('aria-expanded="true"')
    expect(html.match(/<li>/g)).toHaveLength(5)
    expect(html).toContain('Check the cards')
    expect(html.match(/class="focus-ring/g)).toHaveLength(6)
  })
  it('hides the steps when collapsed and preserves the progress control', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), checklistCollapsed: true })
    const html = renderToStaticMarkup(createElement(SetupChecklist))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('role="progressbar"')
    expect(html).toMatch(/<ul[^>]*hidden=""/)
  })
  it('defaults to collapsed once two setup steps are done', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), done: 2 })
    const html = renderToStaticMarkup(createElement(SetupChecklist))
    expect(html).toContain('Get set up · 2 of 5')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toMatch(/<ul[^>]*hidden=""/)
  })
  it('collapses a completed setup to its result', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), complete: true })
    const html = renderToStaticMarkup(createElement(SetupChecklist))
    expect(html).toContain('Set up ✓')
    expect(html).not.toContain('<ul')
  })
  it('hides guidance in sample and signed-out contexts', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), visible: false })
    expect(renderToStaticMarkup(createElement(SetupChecklist))).toBe('')
    expect(renderToStaticMarkup(createElement(NextStepBar))).toBe('')
  })
  it('gives the next step exactly one secondary action and no health colour for setup', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), next: { kind: 'ai', text: 'Your cards show facts only.', button: 'Pick your AI', action: { kind: 'ai' }, health: null } })
    const html = renderToStaticMarkup(createElement(NextStepBar))
    expect(html).toContain('Your cards show facts only.')
    expect(html).toContain('Pick your AI')
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('data-variant="secondary"')
    expect(html).not.toContain('text-danger')
  })
  it('pairs health colour with an icon and a readable label', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), next: { kind: 'owners', text: '3 apps have no owner.', button: 'Assign owners', action: { kind: 'owners', projectId: 'first' }, health: { kind: 'no-owner', label: 'No owner' } } })
    const html = renderToStaticMarkup(createElement(NextStepBar))
    expect(html).toContain('text-danger')
    expect(html).toContain('<svg')
    expect(html).toContain('No owner')
  })
  it('hides the next step when there is no suggestion', () => {
    vi.mocked(useGuide).mockReturnValue({ ...state(), next: null })
    expect(renderToStaticMarkup(createElement(NextStepBar))).toBe('')
  })
})
