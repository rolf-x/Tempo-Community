import { describe, expect, it } from 'vitest'
import {
  inviteAnswerToast,
  inviteAnswerSummary,
  inviteDeadCopy,
  inviteListStatus,
  inviteReminderText,
  isInviteToken,
  pendingInviteReminder,
  type WorkspaceInvite,
} from './invites'

describe('isInviteToken', () => {
  const token = '0123456789abcdef0123456789abcdef'
  it('accepts exactly 32 lowercase hexadecimal characters', () => {
    expect(isInviteToken(token)).toBe(true)
    expect(isInviteToken('0'.repeat(32))).toBe(true)
  })
  it.each(['', 'abc_123', token.slice(1), `${token}0`, token.toUpperCase(), `g${token.slice(1)}`, ` ${token}`, `${token}\n`, `${token}\r\n`, `${token}/extra`])('rejects malformed tokens: %j', (value) => {
    expect(isInviteToken(value)).toBe(false)
  })
})

const invite = (patch: Partial<WorkspaceInvite> = {}): WorkspaceInvite => ({
  id: 'invite-1',
  token: '0123456789abcdef0123456789abcdef',
  email: 'sam@example.com',
  createdAt: '2026-10-01T12:00:00Z',
  expiresAt: '2026-10-08T12:00:00Z',
  usedAt: null,
  declinedAt: null,
  declineNote: null,
  appIds: ['app-1'],
  apps: [{ id: 'app-1', name: 'Route planner' }],
  inviterName: 'Maya',
  inviteeName: 'Sam',
  joinedMemberName: null,
  url: 'https://tempo.example/#/join/0123456789abcdef0123456789abcdef',
  ...patch,
})

describe('inviteListStatus', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')

  it('uses Joined before expiry so old accepted links stay joined', () => {
    expect(inviteListStatus(invite({ usedAt: '2026-10-04T12:00:00Z' }), now)).toBe('Joined')
  })

  it('shows a declined answer instead of calling it joined', () => {
    expect(inviteListStatus(invite({ usedAt: '2026-10-04T12:00:00Z', declinedAt: '2026-10-04T12:00:00Z' }), now)).toBe('Declined')
  })

  it('marks unanswered links expired at the expiry instant', () => {
    expect(inviteListStatus(invite(), now)).toBe('Expired')
  })

  it('keeps a live unanswered link sent', () => {
    expect(inviteListStatus(invite({ expiresAt: '2026-10-08T12:00:01Z' }), now)).toBe('Sent')
  })
})

describe('invite answer copy', () => {
  it('tells an answered link apart from an expired one', () => {
    expect(inviteDeadCopy('used', 'Maya')).toEqual({
      title: 'This invite was already answered',
      body: 'This invite was already answered. Ask Maya for a new one.',
    })
    expect(inviteDeadCopy('expired', null)).toEqual({
      title: 'This invite link has expired',
      body: 'This invite link has expired. Ask the person who sent it for a new one.',
    })
  })

  it('tells a removed person before they press Confirm', () => {
    expect(inviteDeadCopy('removed', 'Maya', 'Halden Freight')).toEqual({
      title: 'You were removed from Halden Freight',
      body: "This link was made before you were removed, so it can't bring you back. Ask an owner or admin for a new invite.",
    })
    expect(inviteDeadCopy('removed', null).title).toBe('You were removed from this workspace')
  })

  it('labels partial answers with the confirmed count and derives the declined app names', () => {
    const partial = invite({
      appIds: ['app-1', 'app-2'],
      apps: [{ id: 'app-1', name: 'Route planner' }, { id: 'app-2', name: 'Legacy CRM' }],
      usedAt: '2026-10-04T12:00:00Z',
      declinedAt: '2026-10-04T12:00:00Z',
      joinedMemberName: 'Sam Lee',
    })
    expect(inviteAnswerSummary(partial, [
      { id: 'app-1', name: 'Route planner', ownerId: 'sam' },
      { id: 'app-2', name: 'Legacy CRM', ownerId: null },
    ], [{ id: 'sam', name: 'Sam Lee', email: 'sam@example.com', userId: 'user-sam' }])).toEqual({
      label: 'Answered · 1 of 2 confirmed', declinedApps: ['Legacy CRM'], derivable: true,
    })
  })

  it('uses Answered without guessing declined apps when the accepting person is ambiguous', () => {
    expect(inviteAnswerSummary(invite({ declinedAt: '2026-10-04T12:00:00Z', joinedMemberName: null, email: null }), [], [])).toEqual({
      label: 'Answered', declinedApps: [], derivable: false,
    })
  })

  it('explains a Not mine answer without saying the person joined', () => {
    expect(inviteAnswerToast(0, 2, 'Halden Freight')).toBe("You said these apps aren't yours. The workspace admin can review your answer.")
    expect(inviteAnswerToast(2, 2, 'Halden Freight')).toBe('You confirmed these apps are yours.')
    expect(inviteAnswerToast(0, 0, 'Halden Freight')).toBe('Joined Halden Freight')
  })
})

describe('invite reminders', () => {
  it('asks to send again after two days', () => {
    const now = Date.parse('2026-10-03T12:00:00Z')
    expect(inviteReminderText(invite(), now)).toBe("Sam hasn't joined yet.")
  })

  it('uses the expiry reminder during the final day', () => {
    const now = Date.parse('2026-10-07T18:00:00Z')
    expect(inviteReminderText(invite(), now)).toBe("Sam's link expires tomorrow.")
  })

  it('does not remind for a joined or expired invite', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    expect(inviteReminderText(invite(), now)).toBeNull()
    expect(inviteReminderText(invite({ usedAt: '2026-10-02T12:00:00Z' }), now)).toBeNull()
  })

  it('returns the expiring link before an older send-again reminder', () => {
    const now = Date.parse('2026-10-07T18:00:00Z')
    const old = invite({ id: 'old', createdAt: '2026-09-28T12:00:00Z', expiresAt: '2026-10-10T12:00:00Z' })
    const expiring = invite({ id: 'urgent' })
    expect(pendingInviteReminder([old, expiring], now)).toEqual({
      inviteId: 'urgent',
      kind: 'new-link',
      text: "Sam's link expires tomorrow.",
    })
  })

  it('never nags about a reusable team link (no email, no apps)', () => {
    const now = Date.parse('2026-10-07T18:00:00Z')
    expect(pendingInviteReminder([invite({ email: null, appIds: [], apps: [] })], now)).toBeNull()
  })

  it('returns null before a reminder is due', () => {
    const now = Date.parse('2026-10-02T11:59:59Z')
    expect(pendingInviteReminder([invite()], now)).toBeNull()
  })
})
