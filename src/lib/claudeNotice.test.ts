import { describe, expect, it } from 'vitest'
import { claudeNotice, claudeNoticeOn, type ClaudeNoticeInput } from './claudeNotice'

const base: ClaudeNoticeInput = { on: true, connected: false, hasApps: true, signIn: 's1', notice: undefined }

describe('telling a person Claude is not connected', () => {
  it('shows the banner and the pop-up once per sign-in when Claude is not connected', () => {
    expect(claudeNotice(base)).toEqual({ banner: true, remind: true, settle: true })
    expect(claudeNotice({ ...base, notice: { remindedFor: 's1' } })).toEqual({ banner: true, remind: false, settle: false })
    expect(claudeNotice({ ...base, notice: { remindedFor: 's1' }, signIn: 's2' })).toEqual({ banner: true, remind: true, settle: true })
  })

  it('keeps a closed banner hidden until the next sign-in', () => {
    expect(claudeNotice({ ...base, notice: { remindedFor: 's1', bannerHiddenFor: 's1' } }).banner).toBe(false)
    expect(claudeNotice({ ...base, signIn: 's2', notice: { remindedFor: 's1', bannerHiddenFor: 's1' } }).banner).toBe(true)
  })

  it('says nothing until the connection list is read, and nothing when Claude is connected', () => {
    expect(claudeNotice({ ...base, connected: null })).toEqual({ banner: false, remind: false, settle: false })
    expect(claudeNotice({ ...base, connected: true })).toEqual({ banner: false, remind: false, settle: true })
  })

  it('waits for the first apps on a first visit, and settles the sign-in so the pop-up does not follow later', () => {
    expect(claudeNotice({ ...base, hasApps: false })).toEqual({ banner: false, remind: false, settle: true })
  })

  it('is off outside mcp mode, signed out or in the demo', () => {
    expect(claudeNotice({ ...base, on: false })).toEqual({ banner: false, remind: false, settle: false })
  })
})

describe('whether the notices are on', () => {
  const input = { mcp: true, keyed: false, signedIn: true, demo: false, userId: 'u1' }

  it('is on when Claude (MCP) is on and no key writes the descriptions', () => {
    expect(claudeNoticeOn(input)).toBe(true)
  })

  it('stays off when a saved API key writes the descriptions, so a person who chose the key is not nagged', () => {
    expect(claudeNoticeOn({ ...input, keyed: true })).toBe(false)
  })

  it('stays off without Claude (legacy), signed out, in the demo or with no person', () => {
    expect(claudeNoticeOn({ ...input, mcp: false })).toBe(false)
    expect(claudeNoticeOn({ ...input, signedIn: false })).toBe(false)
    expect(claudeNoticeOn({ ...input, demo: true })).toBe(false)
    expect(claudeNoticeOn({ ...input, userId: null })).toBe(false)
  })
})
