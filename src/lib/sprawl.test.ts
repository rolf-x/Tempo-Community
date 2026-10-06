import { describe, expect, it } from 'vitest'
import { SPRAWL_DEFAULTS, fillPercent, formatMoney, sprawlEstimate } from './sprawl'

describe('sprawlEstimate', () => {
  it('multiplies apps × share × monthly cost × 12', () => {
    expect(sprawlEstimate({ apps: 40, stalePct: 30, monthlyPerApp: 80 })).toEqual({ staleApps: 12, monthly: 960, yearly: 11520 })
  })
  it('rounds the stale-app count before calculating its cost', () => {
    expect(sprawlEstimate({ apps: 25, stalePct: 30, monthlyPerApp: 100 })).toEqual({ staleApps: 8, monthly: 800, yearly: 9600 })
  })
  it('is zero when any input is zero and never negative', () => {
    expect(sprawlEstimate({ apps: 0, stalePct: 30, monthlyPerApp: 80 }).yearly).toBe(0)
    expect(sprawlEstimate({ apps: 40, stalePct: 0, monthlyPerApp: 80 }).yearly).toBe(0)
    expect(sprawlEstimate({ apps: 40, stalePct: 30, monthlyPerApp: 0 }).yearly).toBe(0)
    expect(sprawlEstimate({ apps: -5, stalePct: 130, monthlyPerApp: -1 }).yearly).toBe(0)
  })
  it('has sensible defaults', () => {
    expect(sprawlEstimate(SPRAWL_DEFAULTS).yearly).toBeGreaterThan(0)
  })
})

describe('formatMoney', () => {
  it('formats whole dollars', () => {
    expect(formatMoney(11520)).toBe('$11,520')
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(999.6)).toBe('$1,000')
  })
})

describe('fillPercent', () => {
  it('maps a value onto 0–100 inside its range', () => {
    expect(fillPercent(5, 5, 300)).toBe(0)
    expect(fillPercent(300, 5, 300)).toBe(100)
    expect(fillPercent(40, 0, 80)).toBe(50)
    expect(fillPercent(3, 3, 3)).toBe(0)
  })
})
