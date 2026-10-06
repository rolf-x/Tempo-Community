import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../lib/model'
import { useStore } from '../store/useStore'
import type { Member, Project } from '../types'
import PortfolioView from './PortfolioView'

vi.mock('../store/useStore', async (original) => {
  const actual = await original<typeof import('../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})
vi.mock('../components/guide/NextStepBar', () => ({ NextStepBar: () => null }))
// Show what the Portfolio asks of each owner picker instead of its (closed) popover.
vi.mock('../components/people/MemberPicker', () => ({
  MemberPicker: ({ trigger, emptyLabel, canAdd }: { trigger: ReactNode; emptyLabel?: string; canAdd?: boolean }) =>
    createElement('div', { 'data-picker': emptyLabel, 'data-can-add': String(canAdd) }, trigger),
}))

const maya: Member = { id: 'maya', name: 'Maya', email: null, avatarUrl: null, githubLogin: null, userId: 'u', role: 'owner', active: true }
const app: Project = { id: 'a', name: 'Tempo', emoji: 'T', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false, ...appDefaults(), ownerId: 'maya' }

beforeEach(() => {
  useStore.getState().resetAll()
  useStore.setState({ members: [maya], meId: 'maya', projects: [app], workspace: { id: 'team', name: 'Team' } })
})

describe('Portfolio owner filter', () => {
  it('only filters: its picker can not add or invite anyone', () => {
    const html = renderToStaticMarkup(createElement(PortfolioView))
    expect(html).toContain('data-picker="Anyone"')
    expect(html).toContain('data-can-add="false"')
  })
})
