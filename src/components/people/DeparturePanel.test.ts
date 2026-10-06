import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../../lib/model'
import { useStore } from '../../store/useStore'
import type { Member, Project } from '../../types'
import { allAppsHaveNewOwners, DeparturePanel } from './DeparturePanel'

vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})

const person = (id: string, name: string, leavingOn: string | null = null): Member => ({
  id, name, leavingOn, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: true,
})
const app = (id: string, ownerId: string | null = 'm1'): Project => ({
  id, name: `App ${id}`, emoji: 'A', color: 'blue', description: '', createdAt: '2026-09-01T00:00:00.000Z', archived: false,
  ...appDefaults(),
  ownerId,
})

beforeEach(() => {
  useStore.getState().resetAll()
  useStore.setState({ members: [person('m1', 'Sam Lee', '2026-10-30'), person('m2', 'Alex Kim')], projects: [app('one'), app('two'), app('three')] })
})

describe('DeparturePanel', () => {
  it('lists the departing owner apps with handover and owner controls', () => {
    const html = renderToStaticMarkup(createElement(DeparturePanel, { memberId: 'm1' }))
    expect(html).toContain('Sam Lee leaves on 30 Oct · <span class="tabular-nums">3</span> apps')
    expect(html.match(/Handover pack/g)).toHaveLength(3)
    expect(html.match(/Choose owner/g)).toHaveLength(3)
    expect(html).not.toContain('data-variant="primary"')
  })

  it('only completes when every app has an active new owner', () => {
    const members = [person('m1', 'Sam', '2026-10-30'), person('m2', 'Alex')]
    expect(allAppsHaveNewOwners([app('one', 'm2'), app('two', 'm2')], members, 'm1', new Date('2026-10-03T12:00:00Z'))).toBe(true)
    expect(allAppsHaveNewOwners([app('one', 'm2'), app('two', null)], members, 'm1', new Date('2026-10-03T12:00:00Z'))).toBe(false)
  })

  it('stores and cancels a leaving date in local mode', () => {
    useStore.getState().setMemberLeavingOn('m1', '2026-10-30')
    expect(useStore.getState().members.find((member) => member.id === 'm1')?.leavingOn).toBe('2026-10-30')
    useStore.getState().setMemberLeavingOn('m1', null)
    expect(useStore.getState().members.find((member) => member.id === 'm1')?.leavingOn).toBeNull()
  })
})
