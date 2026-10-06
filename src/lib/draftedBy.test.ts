import { describe, expect, it } from 'vitest'
import type { DraftedBy } from '../types'
import { draftedByLine, handoverByline, relativeDay } from './draftedBy'

const NOW = new Date(2026, 9, 5, 15, 0, 0) // 5 Oct 2026, local time
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour, 0, 0).toISOString()
const by = (patch: Partial<DraftedBy> = {}): DraftedBy => ({ client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: at(5), ...patch })
const members = [{ id: 'm1', name: 'Dana' }, { id: 'm2', name: 'Lee' }]

describe('relativeDay', () => {
  it('reads today, yesterday and days ago, then a date', () => {
    expect(relativeDay(at(5), NOW)).toBe('today')
    expect(relativeDay(at(4, 23), NOW)).toBe('yesterday')
    expect(relativeDay(at(2), NOW)).toBe('3 days ago')
    expect(relativeDay(new Date(2026, 8, 29, 9).toISOString(), NOW)).toBe('6 days ago')
    expect(relativeDay(new Date(2026, 8, 20, 9).toISOString(), NOW)).toBe('20 Sep 2026')
  })

  it('counts a time in the future as today', () => {
    expect(relativeDay(at(9), NOW)).toBe('today')
  })

  it('is empty when there is no usable date', () => {
    expect(relativeDay('nonsense', NOW)).toBe('')
    expect(relativeDay(null, NOW)).toBe('')
  })
})

describe('draftedByLine', () => {
  it('names the client, the member and the day', () => {
    expect(draftedByLine(by(), members, NOW)).toBe('Drafted by Claude Code for Dana · today')
    expect(draftedByLine(by({ memberId: 'm2', at: at(3) }), members, NOW)).toBe('Drafted by Claude Code for Lee · 2 days ago')
  })

  it('says a teammate when the member is not in the list', () => {
    expect(draftedByLine(by({ memberId: 'gone' }), members, NOW)).toBe('Drafted by Claude Code for a teammate · today')
    expect(draftedByLine(by({ memberId: null }), members, NOW)).toBe('Drafted by Claude Code for a teammate · today')
  })

  it('never claims the client name was verified', () => {
    expect(draftedByLine(by(), members, NOW).toLowerCase()).not.toMatch(/verif|confirm|trusted/)
  })

  it('shortens a long client name and handles a missing one and a missing date', () => {
    expect(draftedByLine(by({ client: ' a '.repeat(60) }), members, NOW).length).toBeLessThan(120)
    expect(draftedByLine(by({ client: '  ', at: 'x' }), members, NOW)).toBe('Drafted by an AI agent for Dana')
  })
})

describe('handoverByline', () => {
  it('reads Written by {client} for {member} on {date}', () => {
    expect(handoverByline(by({ at: at(3) }), members)).toBe('Written by Claude Code for Dana on 3 Oct 2026')
  })

  it('drops the date when there is none and falls back to a teammate', () => {
    expect(handoverByline(by({ at: '', memberId: 'x' }), members)).toBe('Written by Claude Code for a teammate')
  })
})
