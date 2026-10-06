import { describe, expect, it } from 'vitest'
import { migrateV1 } from './migrate'

describe('migrateV1', () => {
  it('keeps apps and discards stored task data', () => {
    const out = migrateV1({
      version: 1,
      projects: [{ id: 'p1', name: 'Web', emoji: 'W', color: 'teal', description: '', createdAt: 'x', archived: false }],
      tasks: [{ id: 't1', title: 'Old task' }],
      today: { picks: ['t1'] },
    } as never)
    expect(out.version).toBe(3)
    expect(out.projects?.[0]).toMatchObject({ name: 'Web', ownerId: null, repo: null, appCard: null })
    expect(out).not.toHaveProperty('tasks')
    expect(out).not.toHaveProperty('today')
    expect(out.members?.[0].role).toBe('owner')
  })
})
