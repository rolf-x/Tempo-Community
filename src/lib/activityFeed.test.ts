import { describe, expect, it } from 'vitest'
import type { Activity } from '../types'
import { feedRowTitle, groupRepeats, withoutRetiredActivity, SYNC_NO_CHANGES } from './activityFeed'

const a = (id: string, kind: Activity['kind'], title: string, at: string): Activity =>
  ({ id, projectId: 'p1', kind, actor: 'Tempo', title, url: null, at })

describe('groupRepeats', () => {
  it('merges back-to-back identical syncs and keeps the newest', () => {
    const rows = groupRepeats([
      a('s3', 'sync', SYNC_NO_CHANGES, '2026-10-04T10:00:00Z'),
      a('s2', 'sync', SYNC_NO_CHANGES, '2026-10-04T09:00:00Z'),
      a('c1', 'commit', 'fix: totals', '2026-10-04T08:00:00Z'),
      a('s1', 'sync', SYNC_NO_CHANGES, '2026-10-04T07:00:00Z'),
    ])
    expect(rows.map((r) => [r.item.id, r.count])).toEqual([['s3', 2], ['c1', 1], ['s1', 1]])
    expect(feedRowTitle(rows[0])).toBe('Card refreshed 2 times')
    expect(feedRowTitle(rows[1])).toBe('fix: totals')
  })

  it('keeps different syncs and repeated commits apart', () => {
    const rows = groupRepeats([
      a('s2', 'sync', 'Synced: 2 updates applied', '2026-10-04T10:00:00Z'),
      a('s1', 'sync', SYNC_NO_CHANGES, '2026-10-04T09:00:00Z'),
      a('c2', 'commit', 'wip', '2026-10-04T08:00:00Z'),
      a('c1', 'commit', 'wip', '2026-10-04T07:00:00Z'),
    ])
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1, 1])
  })
})

describe('withoutRetiredActivity', () => {
  it('drops task and coding-agent entries without throwing, and keeps everything else', () => {
    const list = [
      a('c1', 'commit', 'fix: totals', '2026-10-04T08:00:00Z'),
      { ...a('h1', 'commit', 'Shipped it', '2026-10-04T07:00:00Z'), kind: 'heartbeat' as Activity['kind'] },
      { ...a('t1', 'commit', 'Old task entry', '2026-10-04T06:00:00Z'), kind: 'task' as Activity['kind'] },
      a('s1', 'sync', SYNC_NO_CHANGES, '2026-10-04T05:00:00Z'),
      null,
    ]
    expect(withoutRetiredActivity(list).map((item) => item?.id ?? null)).toEqual(['c1', 's1', null])
  })
})
