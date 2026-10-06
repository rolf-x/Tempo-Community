import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, formatCalendarDate, isValidISODate, monthGrid, todayISO, weekdayName } from './dates'

describe('dates', () => {
  it('todayISO uses local time', () => {
    expect(todayISO(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
  })
  it('addDays crosses month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-10-03', -3)).toBe('2026-09-30')
  })
  it('daysBetween', () => {
    expect(daysBetween('2026-10-03', '2026-10-09')).toBe(6)
    expect(daysBetween('2026-10-05', '2026-10-03')).toBe(-2)
  })
  it('weekdayName', () => {
    expect(weekdayName('2026-10-03')).toBe('Saturday')
  })
  it('isValidISODate rejects impossible dates', () => {
    expect(isValidISODate('2026-02-30')).toBe(false)
    expect(isValidISODate('2026-10-03')).toBe(true)
    expect(isValidISODate('tomorrow')).toBe(false)
  })
  it('formats a timestamp as a calendar date', () => {
    expect(formatCalendarDate('2026-10-04T12:30:00.000Z')).toBe('4 Oct 2026')
  })
  it('monthGrid is Monday-first and covers the whole month in full weeks', () => {
    const oct = monthGrid('2026-10-15')
    expect(oct[0]).toBe('2026-09-28')
    expect(oct.length % 7).toBe(0)
    expect(oct).toContain('2026-10-31')
    expect(oct.at(-1)).toBe('2026-11-01')
    expect(monthGrid('2027-02-10').length).toBe(28) // Feb 2027 starts on a Monday
  })
})
