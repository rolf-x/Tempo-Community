import { describe, expect, it } from 'vitest'
import { makeSeed } from './seed'
import { health } from '../ai/tools/health'
import { directoryRows } from './directory'

describe('Acme demo seed', () => {
  const seed = makeSeed()
  it('covers every health case the landing page promises', () => {
    const kinds = new Set(seed.projects.flatMap((p) => health(p, seed.members).map((f) => f.kind)))
    for (const k of ['no-owner', 'owner-left', 'secrets', 'public-repo', 'stale', 'no-readme']) expect(kinds.has(k as never), k).toBe(true)
  })
  it('offers three sample apps in the openable directory', () => {
    const rows = directoryRows(seed.projects, seed.members, '', { liveOnly: true })
    expect(rows.map((r) => r.project.name).sort()).toEqual(['Onboarding Portal', 'Sales Dashboard', 'Support Triage'])
    for (const row of rows) expect(row.link).toMatch(/^https:\/\/[a-z]+\.acme\.example$/)
  })
})

describe('Acme demo seed: cleanup section', () => {
  it('has one duplicate pair and one dead app', async () => {
    const { findDeadApps, findDuplicates } = await import('../ai/tools/overlap')
    const seed = makeSeed()
    const names = (ids: string[]) => ids.map((id) => seed.projects.find((p) => p.id === id)!.name).sort()
    const groups = findDuplicates(seed.projects)
    expect(groups.map((g) => names(g.appIds))).toEqual([['Expense Bot', 'Receipts Helper']])
    expect(findDeadApps(seed.projects, seed.activity).map((d) => names([d.appId])[0])).toEqual(['Hackday Quiz'])
  })
})
