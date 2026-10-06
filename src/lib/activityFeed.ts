// Back-to-back identical sync entries collapse into one row, so an app that syncs with nothing new doesn't fill its feed
// with "no changes". Only syncs merge: two commits with the same message are still two commits.
import type { Activity } from '../types'

export const SYNC_NO_CHANGES = 'Synced: card refreshed'

const RETIRED_KINDS: unknown[] = ['task', 'heartbeat']

/** Drops the entry kinds Tempo no longer has (task entries and coding-agent updates). Old local copies, backups and rows may still hold them. */
export function withoutRetiredActivity<T>(list: readonly T[]): T[] {
  return list.filter((item) => !RETIRED_KINDS.includes((item as { kind?: unknown } | null)?.kind))
}

export interface FeedRow {
  /** The newest entry of the run (the feed is sorted newest first). */
  item: Activity
  count: number
}

export function groupRepeats(feed: Activity[]): FeedRow[] {
  const rows: FeedRow[] = []
  for (const item of feed) {
    const last = rows[rows.length - 1]
    if (last && item.kind === 'sync' && last.item.kind === 'sync' && last.item.title === item.title) last.count += 1
    else rows.push({ item, count: 1 })
  }
  return rows
}

export function feedRowTitle({ item, count }: FeedRow): string {
  if (count === 1) return item.title
  return item.title === SYNC_NO_CHANGES ? `Card refreshed ${count} times` : `${item.title} (${count} times)`
}
