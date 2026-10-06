import { flagTone } from '../../ai/tools/health'
import { hasNoOwner, type PortfolioRow } from './derive'

export type PortfolioViewMode = 'cards' | 'list'
export type PortfolioSort = 'status' | 'stage' | 'last-commit' | 'name' | 'owner'
export type PortfolioGroup = 'none' | 'status' | 'stage' | 'owner'
export type SortDirection = 'asc' | 'desc'

export interface PortfolioGroupRows {
  key: string
  label: string | null
  rows: PortfolioRow[]
}

const STAGE_ORDER = ['live', 'building', 'idea', 'stale', 'none'] as const
const STAGE_LABEL: Record<(typeof STAGE_ORDER)[number], string> = {
  live: 'Live',
  building: 'Building',
  idea: 'Idea',
  stale: 'Stale',
  none: 'No card yet',
}
const STATUS_ORDER = ['risk', 'attention', 'healthy'] as const
const STATUS_LABEL: Record<(typeof STATUS_ORDER)[number], string> = {
  risk: 'At risk',
  attention: 'Needs a look',
  healthy: 'Healthy',
}

const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
const commitAt = (row: PortfolioRow) => Date.parse(row.project.signals?.lastCommitAt ?? '') || 0

export function statusOf(row: PortfolioRow): (typeof STATUS_ORDER)[number] {
  if (row.flags.some((flag) => flagTone(flag) === 'risk')) return 'risk'
  if (row.needsAttention || row.flags.some((flag) => flagTone(flag) === 'warn')) return 'attention'
  return 'healthy'
}

export function defaultSortDirection(sort: PortfolioSort): SortDirection {
  return sort === 'last-commit' ? 'desc' : 'asc'
}

function compareRows(a: PortfolioRow, b: PortfolioRow, sort: PortfolioSort): number {
  switch (sort) {
    case 'status': {
      const rank = STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b))
      return rank || b.lastAt - a.lastAt || compareText(a.project.name, b.project.name)
    }
    case 'stage': {
      const aStage = a.project.appCard?.stage ?? 'none'
      const bStage = b.project.appCard?.stage ?? 'none'
      return STAGE_ORDER.indexOf(aStage) - STAGE_ORDER.indexOf(bStage) || b.lastAt - a.lastAt || compareText(a.project.name, b.project.name)
    }
    case 'last-commit':
      return commitAt(a) - commitAt(b) || compareText(a.project.name, b.project.name)
    case 'name':
      return compareText(a.project.name, b.project.name)
    case 'owner': {
      const aNone = !a.owner || hasNoOwner(a)
      const bNone = !b.owner || hasNoOwner(b)
      return Number(bNone) - Number(aNone) || compareText(a.owner?.name ?? '', b.owner?.name ?? '') || compareText(a.project.name, b.project.name)
    }
  }
}

export function sortPortfolioRows(rows: PortfolioRow[], sort: PortfolioSort, direction: SortDirection): PortfolioRow[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => factor * compareRows(a, b, sort))
}

export function arrangePortfolioRows(rows: PortfolioRow[], group: PortfolioGroup, sort: PortfolioSort, direction: SortDirection): PortfolioGroupRows[] {
  if (group === 'none') return [{ key: 'all', label: null, rows: sortPortfolioRows(rows, sort, direction) }]

  const grouped = new Map<string, { label: string; rank: number; rows: PortfolioRow[] }>()
  for (const row of rows) {
    let key: string
    let label: string
    let rank: number
    if (group === 'status') {
      const status = statusOf(row)
      key = status
      label = STATUS_LABEL[status]
      rank = STATUS_ORDER.indexOf(status)
    } else if (group === 'stage') {
      const stage = row.project.appCard?.stage ?? 'none'
      key = stage
      label = STAGE_LABEL[stage]
      rank = STAGE_ORDER.indexOf(stage)
    } else if (!row.owner || hasNoOwner(row)) {
      key = 'no-owner'
      label = 'No owner'
      rank = 0
    } else {
      key = `owner:${row.owner!.id}`
      label = row.owner!.name
      rank = 1
    }
    const current = grouped.get(key)
    if (current) current.rows.push(row)
    else grouped.set(key, { label, rank, rows: [row] })
  }

  return [...grouped.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank || compareText(a.label, b.label))
    .map(([key, value]) => ({ key, label: value.label, rows: sortPortfolioRows(value.rows, sort, direction) }))
}
