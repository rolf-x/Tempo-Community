import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import type { Member } from '../../types'
import { appDefaults } from '../../lib/model'
import type { PopoverProps } from '../ui'
import { isInviteEmail, WorkspaceCard } from './WorkspaceCard'

vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})
vi.mock('../../data/session', async (original) => {
  const actual = await original<typeof import('../../data/session')>()
  return { ...actual, useSession: Object.assign((selector: (state: ReturnType<typeof actual.useSession.getState>) => unknown) => selector(actual.useSession.getState()), actual.useSession) }
})
vi.mock('../ui', async (original) => {
  const actual = await original<typeof import('../ui')>()
  const react = await import('react')
  return {
    ...actual,
    Modal: () => null,
    Popover: ({ trigger, children }: PopoverProps) => react.createElement(
      react.Fragment,
      null,
      trigger,
      typeof children === 'function' ? children(() => undefined) : children,
    ),
  }
})

const member = (id: string, name: string, patch: Partial<Member> = {}): Member => ({
  id, name, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: true, leavingOn: null, ...patch,
})

beforeEach(() => {
  useStore.getState().resetAll()
  useStore.setState({
    workspace: { id: 'team', name: 'Tempo team', kind: 'org' },
    meId: 'owner',
    members: [
      member('owner', 'Maya Chen', { role: 'owner', userId: 'u-owner' }),
      member('sam', 'Sam Lee', { leavingOn: '2026-10-12', userId: 'u-sam' }),
    ],
  })
})

describe('WorkspaceCard', () => {
  it('keeps a leaving date on the row and moves its control behind a small menu', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceCard))

    expect(html).toContain('Leaves 12 Oct')
    expect(html).toContain('aria-label="More for Sam Lee"')
    expect(html).toContain('title="More for Sam Lee"')
    expect(html).toContain('size-7')
    expect(html).toContain('Set leaving date')
    expect(html).toContain('Clear leaving date')
    expect(html).not.toContain('Leaving on…')
    expect(html).not.toContain('Change date')
  })

  it('shows one name-or-email invite row to managers, which makes the team link when left empty', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceCard))

    expect(html).toContain('placeholder="Name or email (optional)"')
    expect(html).toContain('aria-label="Name or email"')
    expect(html).toContain('Invite link</button>')
    expect(html).not.toContain('Add person')
    expect(html).not.toContain('Invite email')
  })

  it('shows roles as pills and gives the owner a role menu for joined members', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceCard))

    expect(html).toContain('The owner and admins invite people and edit every app. Members edit the apps they own.')
    expect(html).toContain('Owner</span>')
    expect(html).toContain('Change Sam Lee&#x27;s role, currently Member')
    expect(html).toContain('Edits the apps they own and sees the rest')
    expect(html).toContain('Invites people and edits every app')
    expect(html).toContain('aria-label="Current role"')
  })

  it('keeps people who have not joined on a static Member pill', () => {
    useStore.setState({ members: [
      member('owner', 'Maya Chen', { role: 'owner', userId: 'u-owner' }),
      member('pending', 'Pat Doe', { isAdmin: true }),
    ] })

    const html = renderToStaticMarkup(createElement(WorkspaceCard))
    expect(html).toContain('Member</span>')
    expect(html).not.toContain('Change Pat Doe')
    expect(html).not.toContain('Edits the apps they own and sees the rest')
  })

  it("offers one invite for all apps owned by a placeholder", () => {
    useStore.setState({
      members: [
        member('owner', 'Maya Chen', { role: 'owner', userId: 'u-owner' }),
        member('pat', 'Pat Doe'),
      ],
      projects: ['one', 'two'].map((id) => ({
        id, name: `App ${id}`, emoji: '📁', color: 'blue' as const, description: '', createdAt: '2026-10-01T00:00:00Z', archived: false,
        ...appDefaults(), ownerId: 'pat',
      })),
    })
    const html = renderToStaticMarkup(createElement(WorkspaceCard))
    expect(html).toContain("Invite for all Pat Doe&#x27;s apps")
  })

  it('calls an inactive person Left and offers a fresh invite', () => {
    useStore.setState({ members: [
      member('owner', 'Maya Chen', { role: 'owner', userId: 'u-owner' }),
      member('former', 'Former Member', { active: false, leavingOn: '2026-10-18', userId: 'u-former' }),
    ] })
    const html = renderToStaticMarkup(createElement(WorkspaceCard))
    expect(html).toContain('Left')
    expect(html).not.toContain('Leaves 18 Oct')
    expect(html).toContain('Invite again')
  })

  it('keeps member controls hidden from non-managers', () => {
    useStore.setState({ meId: 'sam', members: [
      member('owner', 'Maya Chen', { role: 'owner', userId: 'u-owner' }),
      member('sam', 'Sam Lee', { userId: 'u-sam' }),
    ] })

    const html = renderToStaticMarkup(createElement(WorkspaceCard))
    expect(html).not.toContain('Name or email')
    expect(html).not.toContain('More for')
    expect(html).not.toContain('Change Sam Lee')
    expect(html).toContain('Only the owner and admins can invite or remove people.')
  })
})

describe('isInviteEmail', () => {
  it('routes only email-shaped values to the link flow', () => {
    expect(isInviteEmail(' sam@example.com ')).toBe(true)
    expect(isInviteEmail('Sam Lee')).toBe(false)
    expect(isInviteEmail('sam@')).toBe(false)
    expect(isInviteEmail('sam @example.com')).toBe(false)
  })
})
