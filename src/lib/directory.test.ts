import { describe, expect, it } from 'vitest'
import { appLink, directoryRows } from './directory'
import { appDefaults } from './model'
import type { Member, Project } from '../types'

const app = (over: Partial<Project>): Project => ({ ...appDefaults(), id: over.id ?? 'p', name: 'App', color: 'blue', createdAt: '2026-10-01T00:00:00.000Z', archived: false, ...over }) as Project
const members: Member[] = [{ id: 'm1', name: 'Sam Lee', email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: true }]

describe('appLink', () => {
  it('prefers the link a person set over the one found in the repo', () => {
    expect(appLink(app({ liveUrl: 'https://a.dev', signals: { liveUrl: 'https://b.dev' } as never }))).toBe('https://a.dev')
    expect(appLink(app({ signals: { liveUrl: 'https://b.dev' } as never }))).toBe('https://b.dev')
    expect(appLink(app({}))).toBeNull()
  })
})

describe('directoryRows', () => {
  const apps = [
    app({ id: 'a', name: 'Expense Bot', ownerId: 'm1', appCard: { what: 'Files expense reports from Slack' } as never, liveUrl: 'https://exp.dev' }),
    app({ id: 'b', name: 'Desk Booking', appCard: { what: 'Book a desk' } as never }),
    app({ id: 'c', name: 'Old thing', archived: true, liveUrl: 'https://old.dev' }),
  ]
  it('lists apps you can open first and skips archived ones', () => {
    expect(directoryRows(apps, members, '').map((r) => r.project.id)).toEqual(['a', 'b'])
  })
  it('searches name, what it does and owner', () => {
    expect(directoryRows(apps, members, 'slack').map((r) => r.project.id)).toEqual(['a'])
    expect(directoryRows(apps, members, 'sam').map((r) => r.project.id)).toEqual(['a'])
    expect(directoryRows(apps, members, 'desk').map((r) => r.project.id)).toEqual(['b'])
  })
  it('can show only apps with a live link', () => {
    expect(directoryRows(apps, members, '', { liveOnly: true }).map((r) => r.project.id)).toEqual(['a'])
  })
})
