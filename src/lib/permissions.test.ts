import { describe, expect, it } from 'vitest'
import { canEditApp, canManagePeople, readOnlyAppMessage } from './permissions'
import type { Member } from '../types'

const m = (over: Partial<Member>): Member => ({ id: 'm1', name: 'A', email: null, avatarUrl: null, githubLogin: null, userId: 'u', role: 'member', active: true, ...over })

describe('permissions (mirror supabase 0005)', () => {
  it('owner and admins manage people; members do not', () => {
    expect(canManagePeople(m({ role: 'owner' }))).toBe(true)
    expect(canManagePeople(m({ isAdmin: true }))).toBe(true)
    expect(canManagePeople(m({}))).toBe(false)
    expect(canManagePeople(null)).toBe(false)
  })
  it('a member edits only the apps they own; managers edit all', () => {
    expect(canEditApp(m({}), { ownerId: 'm1' })).toBe(true)
    expect(canEditApp(m({}), { ownerId: 'm2' })).toBe(false)
    expect(canEditApp(m({ isAdmin: true }), { ownerId: 'm2' })).toBe(true)
    expect(canEditApp(m({ role: 'owner' }), { ownerId: null })).toBe(true)
  })
  it('uses one read-only explanation across every app view', () => {
    expect(readOnlyAppMessage(m({ name: 'Maya' }))).toBe('Only Maya or an admin can change this app.')
    expect(readOnlyAppMessage(null)).toBe('Only an admin can change this app.')
  })
})
