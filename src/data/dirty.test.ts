import { describe, expect, it } from 'vitest'
import { DirtySet } from './dirty'

describe('DirtySet', () => {
  it('a record edited locally stays dirty until its save is acknowledged', () => {
    const d = new DirtySet()
    d.touch('projects', ['p1'])
    expect(d.has('projects', 'p1')).toBe(true)
    const sent = d.snapshot('projects', ['p1'])
    d.ack(sent)
    expect(d.has('projects', 'p1')).toBe(false)
  })
  it('an edit made while a save is in flight keeps it dirty after the ack (the lost-update case)', () => {
    const d = new DirtySet()
    d.touch('projects', ['p1'])
    const sent = d.snapshot('projects', ['p1'])
    d.touch('projects', ['p1']) // edited again while the first save was on the wire
    d.ack(sent)
    expect(d.has('projects', 'p1')).toBe(true)
  })
  it('tables are independent', () => {
    const d = new DirtySet()
    d.touch('projects', ['x'])
    expect(d.has('members', 'x')).toBe(false)
  })
})
