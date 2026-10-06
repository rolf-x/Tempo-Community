import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInviteForApps } from '../../data/inviteForApps'
import { useStore } from '../../store/useStore'
import type { Member } from '../../types'
import {
  assignAndInvite,
  inviteFormDefaults,
  inviteFormError,
  inviteRowLabel,
  looksLikeEmail,
  makeOwnerAndInvite,
  MemberPickerPanel,
  memberChoiceLabel,
  needsOwnerInvite,
  pickerList,
} from './MemberPicker'

vi.mock('../../data/inviteForApps', () => ({ createInviteForApps: vi.fn() }))
vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})

const person = (id: string, name: string, patch: Partial<Member> = {}): Member => ({
  id, name, email: null, avatarUrl: null, githubLogin: null, userId: `user-${id}`, role: 'member', active: true, ...patch,
})
const maya = person('maya', 'Maya Chen', { role: 'owner', email: 'maya@acme.com' })
const sam = person('sam', 'Sam Lee', { email: 'sam@acme.com' })
const inviteOnAssign = { projectId: 'app-1', appName: 'Invoice hub' }

describe('memberChoiceLabel', () => {
  const joined = { id: 'sam', name: 'Sam Lee', userId: 'user-sam' }
  const placeholder = { id: 'pat', name: 'Pat Doe', userId: null }

  it('offers a direct owner change for someone who has already joined', () => {
    expect(memberChoiceLabel(joined, 'maya', true)).toBe('Make Sam Lee the owner')
  })

  it('keeps placeholders and non-owner pickers on their existing labels', () => {
    expect(memberChoiceLabel(placeholder, 'maya', true)).toBe('Pat Doe')
    expect(memberChoiceLabel(joined, 'maya', false)).toBe('Sam Lee')
    expect(memberChoiceLabel(joined, 'sam', true)).toBe('Sam Lee')
  })

  it('makes links only for placeholders, never for joined members', () => {
    expect(needsOwnerInvite(placeholder, 'maya', true)).toBe(true)
    expect(needsOwnerInvite(joined, 'maya', true)).toBe(false)
    expect(needsOwnerInvite(placeholder, 'pat', true)).toBe(false)
    expect(needsOwnerInvite(placeholder, 'maya', false)).toBe(false)
  })
})

describe('searching people', () => {
  const team = [maya, sam, person('pat', 'Pat Doe', { userId: null }), person('old', 'Old Timer', { active: false })]

  it('matches an email only for owner pickers in a team', () => {
    expect(pickerList(team, 'sam@acme', null, 'maya', true).map((m) => m.id)).toEqual(['sam'])
    expect(pickerList(team, 'SAM@ACME', null, 'maya', true).map((m) => m.id)).toEqual(['sam'])
    expect(pickerList(team, 'sam@acme', null, 'maya', false)).toEqual([])
  })

  it('still matches names, puts you first and hides people who left', () => {
    expect(pickerList(team, '', null, 'maya', true).map((m) => m.id)).toEqual(['maya', 'pat', 'sam'])
    expect(pickerList(team, 'pat', null, 'maya', false).map((m) => m.id)).toEqual(['pat'])
    expect(pickerList(team, 'old', 'old', 'maya', false).map((m) => m.id)).toEqual(['old'])
  })

  it('tells an email from a name', () => {
    expect(looksLikeEmail('pat@acme.com')).toBe(true)
    expect(looksLikeEmail('  pat@acme.com ')).toBe(true)
    expect(looksLikeEmail('pat@acme')).toBe(false)
    expect(looksLikeEmail('Pat Doe')).toBe(false)
  })
})

describe('the invite row and form', () => {
  it('reads "Invite someone new" until there is a search with no exact match', () => {
    expect(inviteRowLabel('')).toBe('Invite someone new')
    expect(inviteRowLabel('  ')).toBe('Invite someone new')
    expect(inviteRowLabel('Zed Hall')).toBe('Invite “Zed Hall”')
    expect(inviteRowLabel('Sam Lee', true)).toBe('Invite someone new')
  })

  it('starts the form from the search: a name fills the name, an email fills the email', () => {
    expect(inviteFormDefaults('Zed Hall')).toEqual({ name: 'Zed Hall', email: '' })
    expect(inviteFormDefaults(' zed@acme.com ')).toEqual({ name: '', email: 'zed@acme.com' })
    expect(inviteFormDefaults('')).toEqual({ name: '', email: '' })
  })

  it('needs a name, takes an optional email that must be one, and refuses an email already in the team', () => {
    expect(inviteFormError({ name: '', email: '' }, [maya])).toMatchObject({ field: 'name' })
    expect(inviteFormError({ name: 'Zed', email: '' }, [maya])).toBeNull()
    expect(inviteFormError({ name: 'Zed', email: 'zed@acme.com' }, [maya])).toBeNull()
    expect(inviteFormError({ name: 'Zed', email: 'zed@' }, [maya])).toMatchObject({ field: 'email', message: "That email doesn't look right." })
    expect(inviteFormError({ name: 'Zed', email: 'MAYA@acme.com' }, [maya])).toMatchObject({ field: 'email', message: 'Maya Chen already has that email. Pick them from the list.' })
  })
})

const panel = (props: Partial<Parameters<typeof MemberPickerPanel>[0]> = {}) =>
  renderToStaticMarkup(createElement(MemberPickerPanel, { value: null, onChange: vi.fn(), close: vi.fn(), ...props }))

beforeEach(() => {
  vi.mocked(createInviteForApps).mockReset()
  useStore.getState().resetAll()
  useStore.setState({ members: [maya, sam], meId: 'maya', workspace: { id: 'team', name: 'Acme' } })
})

describe('MemberPickerPanel', () => {
  it('always ends an owner picker in a team with "Invite someone new"', () => {
    const html = panel({ inviteOnAssign })
    expect(html).toContain('Invite someone new')
    expect(html).toContain('lucide-user-plus')
    expect(html).toContain('Search by name or email')
    expect(html.lastIndexOf('Invite someone new')).toBeGreaterThan(html.lastIndexOf('Sam Lee'))
  })

  it('turns a search with no match into Invite “name”, not Add', () => {
    const html = panel({ inviteOnAssign, initialQuery: 'Zed Hall' })
    expect(html).toContain('Invite “Zed Hall”')
    expect(html).not.toContain('Add “')
    expect(html).not.toContain('Invite someone new')
  })

  it('finds a member by email, and shows the email that matched', () => {
    const html = panel({ inviteOnAssign, initialQuery: 'sam@acme' })
    expect(html).toContain('Make Sam Lee the owner')
    expect(html).toContain('sam@acme.com')
    expect(html).not.toContain('Maya Chen')
  })

  it('does not offer to invite someone whose email is already a member', () => {
    expect(panel({ inviteOnAssign, initialQuery: 'sam@acme.com' })).toContain('Invite someone new')
  })

  it('shows the form with the name from the search', () => {
    const html = panel({ inviteOnAssign, initialQuery: 'Zed Hall', initialStep: 'invite' })
    expect(html).toContain('<form')
    expect(html).toContain('Make owner and invite')
    expect(html).toContain('>Back<')
    expect(html).toMatch(/<input[^>]*value="Zed Hall"/)
    expect(html).toContain('(optional)')
    expect(html).not.toContain('Search by name or email')
  })

  it('shows the form with the email from the search and no name', () => {
    const html = panel({ inviteOnAssign, initialQuery: 'zed@acme.com', initialStep: 'invite' })
    expect(html).toMatch(/<input[^>]*value=""[^>]*>[\s\S]*<input[^>]*type="email"[^>]*value="zed@acme.com"/)
  })

  it('gives the owner filter no add or invite row', () => {
    for (const q of ['', 'Zed Hall']) {
      const html = panel({ emptyLabel: 'Anyone', canAdd: false, initialQuery: q })
      expect(html).not.toContain('Add “')
      expect(html).not.toContain('Invite')
      expect(html).toContain('Anyone')
    }
    // Even when it is an owner picker, canAdd=false wins.
    const html = panel({ inviteOnAssign, canAdd: false, initialQuery: 'Zed Hall' })
    expect(html).not.toContain('Invite')
    expect(html).not.toContain('Add “')
  })

  it('keeps today’s Add row for pickers that are not owner pickers (assignees, the departure panel)', () => {
    const html = panel({ initialQuery: 'Zed Hall' })
    expect(html).toContain('Add “Zed Hall”')
    expect(html).not.toContain('Invite')
    expect(html).toContain('Search people')
  })

  it('shows no add or invite row to a teammate who may not add people (only owners and admins may)', () => {
    useStore.setState({ meId: 'sam' })
    for (const q of ['', 'Zed Hall']) {
      for (const props of [{ inviteOnAssign }, {}]) {
        const html = panel({ ...props, initialQuery: q })
        expect(html).not.toContain('Invite')
        expect(html).not.toContain('Add “')
      }
    }
    useStore.setState({ members: [maya, { ...sam, isAdmin: true }] })
    expect(panel({ inviteOnAssign })).toContain('Invite someone new')
  })

  it('keeps today’s behaviour in a personal workspace and when signed out', () => {
    for (const workspace of [{ id: 'me', name: 'Me', kind: 'personal' as const }, null]) {
      useStore.setState({ workspace })
      const html = panel({ inviteOnAssign, initialQuery: 'Zed Hall' })
      expect(html).toContain('Add “Zed Hall”')
      expect(html).not.toContain('Invite')
      expect(html).toContain('Search people')
    }
  })
})

describe('assignAndInvite', () => {
  const invite = { url: 'https://tempo/join/abc', token: 'abc', expiresAt: '2026-10-20T00:00:00Z', appIds: ['app-1'] }

  it('closes at once for someone who has joined, with no invite', async () => {
    const onChange = vi.fn()
    const showInvite = vi.fn()
    expect(await assignAndInvite('sam', { onChange, inviteOnAssign, meId: 'maya', showInvite })).toBe(false)
    expect(onChange).toHaveBeenCalledWith('sam')
    expect(createInviteForApps).not.toHaveBeenCalled()
  })

  it('makes the link for someone who has not joined yet, using their email', async () => {
    const pat = useStore.getState().addMember({ name: 'Pat Doe', email: 'pat@acme.com', userId: null, active: true })
    vi.mocked(createInviteForApps).mockResolvedValue(invite)
    const onChange = vi.fn()
    const shown: unknown[] = []
    expect(await assignAndInvite(pat.id, { onChange, inviteOnAssign, meId: 'maya', showInvite: (state) => shown.push(state) })).toBe(true)
    expect(createInviteForApps).toHaveBeenCalledWith(['app-1'], 'pat@acme.com')
    expect(shown.map((state) => (state as { status?: string } | null)?.status ?? null)).toEqual([null, 'loading', 'ready'])
  })

  it('says so when the link could not be made', async () => {
    const pat = useStore.getState().addMember({ name: 'Pat Doe', userId: null, active: true })
    vi.mocked(createInviteForApps).mockRejectedValue(new Error('Network down'))
    const shown: Array<{ status?: string; error?: string } | null> = []
    expect(await assignAndInvite(pat.id, { onChange: vi.fn(), inviteOnAssign, meId: 'maya', showInvite: (state) => shown.push(state) })).toBe(true)
    expect(shown.at(-1)).toMatchObject({ status: 'error', error: 'Network down' })
  })

  it('does nothing extra for "no owner" or a picker with no invite', async () => {
    const onChange = vi.fn()
    expect(await assignAndInvite(null, { onChange, inviteOnAssign, meId: 'maya', showInvite: vi.fn() })).toBe(false)
    expect(onChange).toHaveBeenCalledWith(null)
    const pat = useStore.getState().addMember({ name: 'Pat Doe', userId: null, active: true })
    expect(await assignAndInvite(pat.id, { onChange, meId: 'maya', showInvite: vi.fn() })).toBe(false)
    expect(createInviteForApps).not.toHaveBeenCalled()
  })
})

describe('makeOwnerAndInvite (the form, sent)', () => {
  const invite = { url: 'https://tempo/join/abc', token: 'abc', expiresAt: '2026-10-20T00:00:00Z', appIds: ['app-1'] }
  const run = (form: { name: string; email: string }, onChange = vi.fn()) =>
    makeOwnerAndInvite(form, { onChange, inviteOnAssign, meId: 'maya', showInvite: vi.fn(), members: useStore.getState().members, addMember: useStore.getState().addMember })

  it('adds the person, makes them the owner and makes their invite link with their email', async () => {
    vi.mocked(createInviteForApps).mockResolvedValue(invite)
    const onChange = vi.fn()
    const sent = await run({ name: '  Zed Hall ', email: ' zed@acme.com ' }, onChange)
    expect('member' in sent && sent.kept).toBe(true)
    const zed = useStore.getState().members.find((member) => member.name === 'Zed Hall')
    expect(zed).toMatchObject({ email: 'zed@acme.com', userId: null, active: true })
    expect(onChange).toHaveBeenCalledWith(zed!.id)
    expect(createInviteForApps).toHaveBeenCalledWith(['app-1'], 'zed@acme.com')
  })

  it('works without an email: the link is made without one', async () => {
    vi.mocked(createInviteForApps).mockResolvedValue(invite)
    await run({ name: 'Zed Hall', email: '' })
    expect(useStore.getState().members.find((member) => member.name === 'Zed Hall')?.email).toBeNull()
    expect(createInviteForApps).toHaveBeenCalledWith(['app-1'], null)
  })

  it('adds nobody and assigns nobody when the form is wrong', async () => {
    const onChange = vi.fn()
    expect(await run({ name: '', email: '' }, onChange)).toMatchObject({ error: { field: 'name' } })
    expect(await run({ name: 'Zed', email: 'not-an-email' }, onChange)).toMatchObject({ error: { field: 'email' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(useStore.getState().members).toHaveLength(2)
    expect(createInviteForApps).not.toHaveBeenCalled()
  })
})
