import { describe, expect, it } from 'vitest'
import type { HealthKind } from '../ai/tools/health'
import type { AppTask } from '../types'
import { closeFixedTasks, fixedTasks, isTaskFixed, openTasks } from './tasks'

const NOW = '2026-10-06T10:00:00.000Z'
const task = (id: string, problem: HealthKind, fixedAt: string | null = null): AppTask => ({
  id, problem, title: `Task ${id}`, detail: null, createdAt: '2026-10-05T09:00:00.000Z',
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: '2026-10-05T09:00:00.000Z' }, fixedAt,
})
const flags = (...kinds: HealthKind[]): ReadonlySet<HealthKind> => new Set(kinds)

describe('isTaskFixed', () => {
  it('is open while its flag is on the app', () => expect(isTaskFixed(task('a', 'no-readme'), flags('no-readme', 'stale'))).toBe(false))
  it('is fixed as soon as its flag is gone, before any sync saves it', () => expect(isTaskFixed(task('a', 'no-readme'), flags('stale'))).toBe(true))
  it('stays fixed when the same flag comes back', () => expect(isTaskFixed(task('a', 'stale', '2026-10-01T00:00:00.000Z'), flags('stale'))).toBe(true))
})

describe('openTasks and fixedTasks', () => {
  const list = [task('a', 'no-readme'), task('b', 'stale'), task('c', 'no-owner', '2026-10-01T00:00:00.000Z')]
  it('split the list by flag and fixedAt, keeping order', () => {
    expect(openTasks(list, flags('no-readme')).map((t) => t.id)).toEqual(['a'])
    expect(fixedTasks(list, flags('no-readme')).map((t) => t.id)).toEqual(['b', 'c'])
  })
  it('take no list', () => {
    expect(openTasks(undefined, flags())).toEqual([])
    expect(fixedTasks(null, flags())).toEqual([])
  })
})

describe('closeFixedTasks', () => {
  it('sets fixedAt on open tasks whose flag is gone and leaves the rest', () => {
    const list = [task('a', 'no-readme'), task('b', 'stale'), task('c', 'no-owner', '2026-10-01T00:00:00.000Z')]
    const out = closeFixedTasks(list, flags('stale'), NOW)!
    expect(out.map((t) => t.fixedAt)).toEqual([NOW, null, '2026-10-01T00:00:00.000Z'])
    expect(out[1]).toBe(list[1])
    expect(list[0].fixedAt).toBeNull()
  })
  it('keeps an earlier fixedAt when the flag is gone again', () => {
    expect(closeFixedTasks([task('c', 'no-owner', '2026-10-01T00:00:00.000Z')], flags(), NOW)).toBeNull()
  })
  it('is null when nothing changed', () => {
    expect(closeFixedTasks([task('a', 'stale')], flags('stale'), NOW)).toBeNull()
    expect(closeFixedTasks([], flags(), NOW)).toBeNull()
    expect(closeFixedTasks(undefined, flags(), NOW)).toBeNull()
  })
  it('takes a Date for now', () => expect(closeFixedTasks([task('a', 'stale')], flags(), new Date(NOW))![0].fixedAt).toBe(NOW))
})

describe('a task a person removed', () => {
  const removed = (id: string, problem: HealthKind): AppTask => ({ id, problem, title: id, detail: null, createdAt: '2026-10-05T00:00:00Z',
    draftedBy: { client: 'Claude', clientId: null, memberId: null, at: '2026-10-05T00:00:00Z' }, fixedAt: null, removedAt: '2026-10-06T00:00:00Z' })
  it('is neither open nor fixed, and a sync leaves it alone', () => {
    const kinds = new Set<HealthKind>(['no-readme'])
    expect(openTasks([removed('a', 'no-readme')], kinds)).toEqual([])
    expect(fixedTasks([removed('b', 'stale')], kinds)).toEqual([])
    expect(closeFixedTasks([removed('b', 'stale')], kinds, '2026-10-07T00:00:00Z')).toBeNull()
  })
})
