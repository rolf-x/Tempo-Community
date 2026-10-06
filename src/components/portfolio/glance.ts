import { flagTone, quietPeriodKept, STALE_DAYS, type FlagTone, type HealthFlag } from '../../ai/tools/health'
import type { Stage } from '../../types'
import { hasNoOwner, type PortfolioRow } from './derive'
import { isAtRisk, needsAttention } from '../../lib/attention'

const DAY = 86_400_000
const PULSE_DAYS = 60
const LANE_GAP = 4
export const PULSE_QUIET_X = ((PULSE_DAYS - STALE_DAYS) / PULSE_DAYS) * 100
export const PULSE_TICKS = [{ day: 60, x: 0, label: '60 d' }, { day: 30, x: 50, label: '30 d' }, { day: STALE_DAYS, x: PULSE_QUIET_X, label: `${STALE_DAYS} d` }, { day: 0, x: 100, label: 'Today' }] as const

export type HealthBucket = 'risk' | 'warn' | 'healthy'
export type StageKey = Stage | 'none'

export interface HealthState {
  bucket: HealthBucket
  flag: HealthFlag | null
}

export interface StageSegment {
  stage: StageKey
  count: number
  start: number
  share: number
}

export interface PulsePoint {
  row: PortfolioRow
  at: number
  x: number
  lane: number
  olderThanRange: boolean
  quiet: boolean
}

const TONE_RANK: Record<FlagTone, number> = { risk: 0, warn: 1, quiet: 2 }
export const STAGE_ORDER: StageKey[] = ['live', 'building', 'idea', 'stale', 'none']

export function worstHealth(row: PortfolioRow): HealthState {
  const flag = row.flags.reduce<HealthFlag | null>((worst, current) => {
    if (!worst || TONE_RANK[flagTone(current)] < TONE_RANK[flagTone(worst)]) return current
    return worst
  }, null)
  return { bucket: isAtRisk(row.flags) ? 'risk' : needsAttention(row.flags) ? 'warn' : 'healthy', flag }
}

export function healthCounts(rows: PortfolioRow[]) {
  const counts = { risk: 0, warn: 0, healthy: 0 }
  for (const row of rows) counts[worstHealth(row).bucket] += 1
  return counts
}

const HEALTH_RANK: Record<HealthBucket, number> = { risk: 0, warn: 1, healthy: 2 }

/** Keep each severity together without changing the order of apps inside a severity. */
export function orderByHealth(rows: PortfolioRow[]): PortfolioRow[] {
  return rows
    .map((row, index) => ({ row, index, rank: HEALTH_RANK[worstHealth(row).bucket] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ row }) => row)
}

export function ownershipCounts(rows: PortfolioRow[]) {
  const unowned = rows.filter(hasNoOwner).length
  const owned = rows.length - unowned
  return {
    total: rows.length,
    owned,
    unowned,
    ownedShare: rows.length ? Math.round((owned / rows.length) * 100) : 0,
  }
}

export function donutArcs(owned: number, total: number) {
  const ownedArc = total ? (owned / total) * 100 : 0
  const unownedArc = 100 - ownedArc
  return {
    owned: { dash: `${ownedArc} ${unownedArc}`, offset: 0 },
    unowned: { dash: `${unownedArc} ${ownedArc}`, offset: -ownedArc },
  }
}

export function stageSegments(rows: PortfolioRow[]): StageSegment[] {
  const counts = new Map<StageKey, number>(STAGE_ORDER.map((stage) => [stage, 0]))
  for (const row of rows) {
    const stage = row.project.appCard?.stage ?? 'none'
    counts.set(stage, (counts.get(stage) ?? 0) + 1)
  }
  let start = 0
  return STAGE_ORDER.map((stage) => {
    const count = counts.get(stage) ?? 0
    const share = rows.length ? (count / rows.length) * 100 : 0
    const segment = { stage, count, start, share }
    start += share
    return segment
  })
}

export function pulsePosition(at: number, now: Date) {
  if (!Number.isFinite(at) || at <= 0) return null
  const ageDays = Math.max(0, (now.getTime() - at) / DAY)
  return {
    x: Math.max(0, Math.min(100, ((PULSE_DAYS - ageDays) / PULSE_DAYS) * 100)),
    ageDays,
    olderThanRange: ageDays > PULSE_DAYS,
    quiet: ageDays >= STALE_DAYS,
  }
}

export function pulsePoints(rows: PortfolioRow[], now: Date): PulsePoint[] {
  const points = rows.flatMap((row) => {
    const commit = row.project.signals?.lastCommitAt
    const at = commit ? Date.parse(commit) : row.lastAt
    const position = pulsePosition(at, now)
    if (position && quietPeriodKept(commit, row.project.keptAt)) position.quiet = false // kept: quiet on purpose
    return position ? [{ row, at, ...position, lane: 0 }] : []
  }).sort((a, b) => a.x - b.x || a.at - b.at || a.row.project.id.localeCompare(b.row.project.id))

  const lastX = [-Infinity, -Infinity, -Infinity, -Infinity]
  for (const point of points) {
    const available = lastX.findIndex((x) => point.x - x >= LANE_GAP)
    const lane = available >= 0 ? available : lastX.indexOf(Math.min(...lastX))
    point.lane = lane
    lastX[lane] = point.x
  }
  return points
}

export function pulseCounts(rows: PortfolioRow[], now: Date) {
  let active = 0
  let quiet = 0
  let noData = 0
  for (const row of rows) {
    const commit = row.project.signals?.lastCommitAt
    const point = pulsePosition(commit ? Date.parse(commit) : row.lastAt, now)
    if (point?.quiet && quietPeriodKept(commit, row.project.keptAt)) continue // quiet on purpose: not a warning
    if (!point) noData += 1
    else if (point.quiet) quiet += 1
    else active += 1
  }
  return { active, quiet, noData }
}
