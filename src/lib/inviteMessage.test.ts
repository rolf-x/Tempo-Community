import { describe, expect, it } from 'vitest'
import { inviteMessage, type InviteMessageInput } from './inviteMessage'

const now = Date.parse('2026-10-04T12:00:00Z')
const input: InviteMessageInput = {
  inviterName: 'Maya', inviteeName: 'Sam', workspaceName: 'Halden Freight',
  url: 'https://tempo.example/#/join/abc', expiresAt: '2026-10-11T12:00:00Z',
}

describe('inviteMessage', () => {
  it('writes an owner invite with facts, names, a link and expiry', () => {
    const message = inviteMessage({ ...input, appNames: ['Route planner', 'Fuel card reconciliation'] }, now)
    expect(message.subject).toBe('Maya asked you to own 2 apps in Tempo')
    expect(message.emailBody).toContain('Hi Sam,')
    expect(message.emailBody).toContain('Maya asked you to own Route planner and Fuel card reconciliation in Tempo.')
    expect(message.emailBody).toContain('Tempo keeps track of the apps our team has built.')
    expect(message.emailBody).toContain(`Sign in with GitHub to confirm:\n${input.url}`)
    expect(message.emailBody).toContain('The link works for 7 days.')
    expect(message.slackMessage).toContain('@Sam, Maya asked you to own 2 apps')
    expect(message.slackMessage.split('\n')).toHaveLength(2)
    expect(message.slackMessage).toContain(input.url)
  })

  it.each([undefined, []])('writes a workspace invite without apps (%s)', (appNames) => {
    const message = inviteMessage({ ...input, inviteeName: null, appNames }, now)
    expect(message.subject).toBe('Maya invited you to Halden Freight in Tempo')
    expect(message.emailBody).toMatch(/^Hi,\n/)
    expect(message.emailBody).not.toContain('own')
    expect(message.slackMessage).not.toContain('@')
  })

  it('uses singular for one app and safely encodes email fields', () => {
    const message = inviteMessage({ ...input, inviterName: 'Maïa & Maya', appNames: ['R&D'], inviteeEmail: 'sam+work@example.com' }, now)
    expect(message.subject).toBe('Maïa & Maya asked you to own 1 app in Tempo')
    const url = new URL(message.mailtoUrl!)
    expect(decodeURIComponent(url.pathname)).toBe('sam+work@example.com')
    expect(url.searchParams.get('subject')).toBe(message.subject)
    expect(url.searchParams.get('body')).toBe(message.emailBody)
  })

  it.each([
    ['2026-10-05T12:00:00Z', 'The link works for 1 day.'],
    ['2026-10-04T13:00:00Z', 'The link works for less than a day.'],
    ['2026-10-04T12:00:00Z', 'This link has expired. Ask for a new one.'],
    ['2026-10-03T12:00:00Z', 'This link has expired. Ask for a new one.'],
    ['invalid', 'Check the link for its expiry date.'],
  ])('uses the actual expiry %s', (expiresAt, expected) => {
    expect(inviteMessage({ ...input, expiresAt }, now).emailBody).toContain(expected)
  })

  it('shortens app names first, preserving the full copyable message and join link', () => {
    const appNames = Array.from({ length: 50 }, (_, i) => `App ${i} ${'😀'.repeat(20)}`)
    const message = inviteMessage({ ...input, appNames }, now)
    expect(message.mailtoUrl).not.toBeNull()
    expect(message.mailtoUrl!.length).toBeLessThan(2_000)
    const url = new URL(message.mailtoUrl!)
    expect(url.searchParams.get('subject')).toBe(message.subject)
    expect(url.searchParams.get('body')).toContain('Hi Sam,')
    expect(url.searchParams.get('body')).toContain(input.url)
    expect(url.searchParams.get('body')).toMatch(/more apps/)
    appNames.forEach((name) => expect(message.emailBody).toContain(name))
  })

  it('also bounds long Unicode names without cutting surrogate pairs', () => {
    const message = inviteMessage({ ...input, inviterName: '😀'.repeat(500), workspaceName: 'é'.repeat(500), inviteeName: '😀'.repeat(500) }, now)
    expect(message.mailtoUrl).not.toBeNull()
    expect(message.mailtoUrl!.length).toBeLessThan(2_000)
    expect(new URL(message.mailtoUrl!).searchParams.get('body')).toContain(input.url)
  })

  it('offers full text when the link alone cannot fit without corruption', () => {
    const url = input.url + 'a'.repeat(2_000)
    const message = inviteMessage({ ...input, url }, now)
    expect(message.mailtoUrl).toBeNull()
    expect(message.emailBody).toContain(url)
  })

  it('does not mutate inputs and removes line breaks from names', () => {
    const source = Object.freeze({ ...input, inviterName: 'Maya\r\nBcc: nobody', appNames: ['App'] })
    expect(inviteMessage(source, now)).toEqual(inviteMessage(source, now))
    expect(inviteMessage(source, now).subject).not.toMatch(/[\r\n]/)
    expect(source.appNames).toEqual(['App'])
  })
})
