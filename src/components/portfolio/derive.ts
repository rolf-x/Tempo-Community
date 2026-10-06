// Pure helpers behind the Portfolio grid: app ownership, repo health and latest activity.
import type { Activity, Member, Project } from '../../types'
import { health, quietPeriodKept, type HealthFlag } from '../../ai/tools/health'
import { isAtRisk, needsAttention } from '../../lib/attention'

export type PortfolioFilter = 'all' | 'attention' | 'stale' | 'no-owner' | 'changed' | 'risk' | 'warn' | 'healthy' | `stage:${'live' | 'building' | 'idea' | 'stale' | 'none'}`

export interface PortfolioRow {
  project: Project
  owner: Member | null
  flags: HealthFlag[]
  needsAttention: boolean
  last: Activity | null
  lastAt: number
}

export function portfolioRows(projects: Project[], members: Member[], activity: Activity[], now = new Date(), opts: { personal?: boolean } = {}): PortfolioRow[] {
  const latest = new Map<string, Activity>()
  for (const item of activity) {
    if (item.kind === 'sync') continue
    const current = latest.get(item.projectId)
    if (!current || item.at > current.at) latest.set(item.projectId, item)
  }
  return projects.filter((project) => !project.archived).map((project) => {
    const flags = health(project, members, now, { ...opts, keptAt: project.keptAt })
    const last = latest.get(project.id) ?? null
    const stamp = last?.at ?? project.lastActivityAt ?? project.signals?.lastCommitAt ?? project.createdAt
    return {
      project,
      owner: members.find((member) => member.id === project.ownerId) ?? null,
      flags,
      needsAttention: needsAttention(flags),
      last,
      lastAt: Date.parse(stamp) || 0,
    }
  }).sort(byAttention)
}

export const byAttention = (a: PortfolioRow, b: PortfolioRow) => Number(b.needsAttention) - Number(a.needsAttention) || b.lastAt - a.lastAt

export const isStale = (row: PortfolioRow) => row.flags.some((flag) => flag.kind === 'stale')
  || (row.project.appCard?.stage === 'stale' && !quietPeriodKept(row.project.signals?.lastCommitAt, row.project.keptAt))
export const hasNoOwner = (row: PortfolioRow) => row.flags.some((flag) => flag.kind === 'no-owner' || flag.kind === 'owner-left')

const WEEK = 7 * 86_400_000

/**
 * When the app's work last changed: the newest of its latest non-sync activity, lastActivityAt (a push) and last commit.
 * Adding the app to Tempo is not a change, so createdAt (and `lastAt`, which falls back to it) never counts.
 */
export function lastChangeAt(row: PortfolioRow): number {
  const { project } = row
  return Math.max(0, ...[row.last?.at, project.lastActivityAt, project.signals?.lastCommitAt].map((at) => Date.parse(at ?? '') || 0))
}

/** Changed in the last 7 days (exactly 7 days still counts). A push moves lastActivityAt, so this follows every push. */
export const changedThisWeek = (row: PortfolioRow, now = new Date()): boolean => {
  const at = lastChangeAt(row)
  return at > 0 && now.getTime() - at <= WEEK
}

export function matchesFilter(row: PortfolioRow, filter: PortfolioFilter, ownerId: string | null, now = new Date()): boolean {
  if (ownerId && row.project.ownerId !== ownerId) return false
  switch (filter) {
    case 'attention': return row.needsAttention
    case 'stale': return isStale(row)
    case 'no-owner': return hasNoOwner(row)
    case 'changed': return changedThisWeek(row, now)
    case 'risk': return isAtRisk(row.flags)
    case 'warn': return !isAtRisk(row.flags) && needsAttention(row.flags)
    case 'healthy': return !needsAttention(row.flags)
    default:
      if (filter.startsWith('stage:')) return (row.project.appCard?.stage ?? 'none') === filter.slice(6)
      return true
  }
}

export function portfolioCounts(rows: PortfolioRow[], now = new Date()) {
  return {
    apps: rows.length,
    live: rows.filter((row) => row.project.appCard?.stage === 'live').length,
    attention: rows.filter((row) => row.needsAttention).length,
    stale: rows.filter(isStale).length,
    noOwner: rows.filter(hasNoOwner).length,
    changed: rows.filter((row) => changedThisWeek(row, now)).length,
  }
}
