import type { KeyboardEvent, ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { STALE_DAYS } from '../../ai/tools/health'
import { toHash } from '../../lib/router'
import { timeAgo } from '../app/AppBadges'
import { appMonogram, Card, cn, fadeUp } from '../ui'
import type { PortfolioFilter, PortfolioRow } from './derive'
import { donutArcs, healthCounts, orderByHealth, ownershipCounts, PULSE_QUIET_X, PULSE_TICKS, pulseCounts, pulsePoints, stageSegments, worstHealth, type StageKey } from './glance'

export interface AtAGlanceProps {
  rows: PortfolioRow[]
  personal: boolean
  filter: PortfolioFilter
  onFilter: (filter: PortfolioFilter) => void
  now?: Date
}

const STAGE_LABEL: Record<StageKey, string> = {
  live: 'Live',
  building: 'Building',
  idea: 'Idea',
  stale: 'Stale',
  none: 'No card yet',
}

const STAGE_FILL: Record<StageKey, string> = {
  live: 'fill-success',
  building: 'fill-accent',
  idea: 'fill-text-faint',
  stale: 'fill-warning',
  none: 'fill-surface-2 stroke-border-strong',
}

const STAGE_DOT: Record<StageKey, string> = {
  live: 'bg-success',
  building: 'bg-accent',
  idea: 'bg-text-faint',
  stale: 'bg-warning',
  none: 'border border-border-strong bg-surface-2 box-border',
}

function LegendButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'focus-ring inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors',
        pressed ? 'border-accent bg-accent-soft text-text' : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

function PanelMetric({ label, value, unit, line }: { label: string; value: ReactNode; unit: string; line: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-medium tabular-nums text-text">{value}</span>
        <span className="text-sm text-text-muted">{unit}</span>
      </p>
      <p className="mt-0.5 text-xs text-text-muted">{line}</p>
    </div>
  )
}

/** Tiles shrink as the portfolio grows: lettered squares for a team's handful, a dense map for a hundred apps. */
function tileFor(count: number) {
  if (count <= 12) return { size: 'size-10 rounded-lg text-sm', gap: 'gap-2', letters: true }
  if (count <= 30) return { size: 'size-7 rounded-md text-[11px]', gap: 'gap-1.5', letters: true }
  if (count <= 60) return { size: 'size-5 rounded-[5px]', gap: 'gap-1', letters: false }
  return { size: 'size-3.5 rounded-[3px]', gap: 'gap-1', letters: false }
}

function HealthMap({ rows, filter, onFilter }: Pick<AtAGlanceProps, 'rows' | 'filter' | 'onFilter'>) {
  const counts = healthCounts(rows)
  const tile = tileFor(rows.length)
  const orderedRows = orderByHealth(rows)
  return (
    <Card className="flex min-h-64 min-w-0 flex-col">
      <PanelMetric label="Health map" value={<span className={cn(counts.risk > 0 && 'text-danger')}>{counts.risk}</span>} unit="at risk" line={`${counts.warn} ${counts.warn === 1 ? 'needs' : 'need'} a look · ${counts.healthy} healthy`} />
      <div className={cn('mt-5 flex flex-wrap', tile.gap)} aria-label="App health map">
        {orderedRows.map((row) => {
          const state = worstHealth(row)
          const label = state.flag?.label ?? 'Healthy'
          const muted = !row.project.repo && state.bucket === 'healthy'
          return (
            <a
              key={row.project.id}
              href={toHash({ name: 'project', projectId: row.project.id, view: 'app' })}
              aria-label={`${row.project.name}: ${label}`}
              title={`${row.project.name}: ${label}`}
              className={cn(
                'focus-ring grid shrink-0 place-items-center font-semibold leading-none transition-transform hover:scale-105 motion-reduce:transition-none',
                tile.size,
                state.bucket === 'risk' && 'bg-danger text-danger-ink',
                state.bucket === 'warn' && 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/50',
                state.bucket === 'healthy' && !muted && 'bg-success-soft text-success ring-1 ring-inset ring-success/40',
                muted && 'bg-surface-2 text-text-faint ring-1 ring-inset ring-border-strong',
              )}
            >
              {tile.letters && <span aria-hidden>{appMonogram(row.project.name)}</span>}
            </a>
          )
        })}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-5" aria-label="Health filters">
        <LegendButton pressed={filter === 'risk'} onClick={() => onFilter('risk')}><span className="size-1.5 rounded-full bg-danger" />Risk {counts.risk}</LegendButton>
        <LegendButton pressed={filter === 'warn'} onClick={() => onFilter('warn')}><span className="size-1.5 rounded-full bg-warning" />Needs a look {counts.warn}</LegendButton>
        <LegendButton pressed={filter === 'healthy'} onClick={() => onFilter('healthy')}><span className="size-1.5 rounded-full bg-success" />Healthy {counts.healthy}</LegendButton>
      </div>
    </Card>
  )
}

function StageBar({ rows, filter, onFilter }: Pick<AtAGlanceProps, 'rows' | 'filter' | 'onFilter'>) {
  const segments = stageSegments(rows)
  const activate = (event: KeyboardEvent<SVGGElement>, stage: StageKey) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onFilter(`stage:${stage}`)
    }
  }
  return (
    <div>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full overflow-hidden rounded-full" aria-label="Apps by stage">
        <rect width="100" height="10" rx="5" className="fill-surface-2" />
        {segments.filter((segment) => segment.count > 0).map((segment) => (
          <g
            key={segment.stage}
            role="button"
            tabIndex={0}
            aria-label={`Filter by ${STAGE_LABEL[segment.stage]} stage, ${segment.count} apps`}
            aria-pressed={filter === `stage:${segment.stage}`}
            onClick={() => onFilter(`stage:${segment.stage}`)}
            onKeyDown={(event) => activate(event, segment.stage)}
            className="group cursor-pointer focus:outline-none"
          >
            <rect x={segment.start} width={segment.share} height="10" className={cn(STAGE_FILL[segment.stage], 'group-focus-visible:stroke-text group-focus-visible:stroke-[1.5]')} />
          </g>
        ))}
      </svg>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {segments.map((segment) => (
          <LegendButton key={segment.stage} pressed={filter === `stage:${segment.stage}`} onClick={() => onFilter(`stage:${segment.stage}`)}>
            <span className={cn('size-1.5 rounded-full', STAGE_DOT[segment.stage])} />{STAGE_LABEL[segment.stage]} {segment.count}
          </LegendButton>
        ))}
      </div>
    </div>
  )
}

function Ownership({ rows, personal, filter, onFilter }: Pick<AtAGlanceProps, 'rows' | 'personal' | 'filter' | 'onFilter'>) {
  const counts = ownershipCounts(rows)
  const arcs = donutArcs(counts.owned, counts.total)
  const activateUnowned = (event: KeyboardEvent<SVGCircleElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onFilter('no-owner')
    }
  }
  return (
    <Card className="flex min-h-64 min-w-0 flex-col">
      {personal ? (
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">Stages</p>
      ) : (
        <PanelMetric label="Ownership" value={`${counts.ownedShare}%`} unit="owned" line={`${counts.unowned} without an owner`} />
      )}
      {!personal && (
        <div className="mt-4 flex items-center gap-4">
          <svg viewBox="0 0 48 48" className="size-24 shrink-0" aria-label={`${counts.owned} of ${counts.total} apps have an owner`}>
            <circle cx="24" cy="24" r="18" pathLength="100" fill="none" strokeWidth="6" className="stroke-border" />
            <circle cx="24" cy="24" r="18" pathLength="100" fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={arcs.owned.dash} strokeDashoffset={arcs.owned.offset} transform="rotate(-90 24 24)" className="stroke-success" />
            {counts.unowned > 0 && (
              <circle
                cx="24" cy="24" r="18" pathLength="100" fill="none" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={arcs.unowned.dash} strokeDashoffset={arcs.unowned.offset} transform="rotate(-90 24 24)"
                role="button" tabIndex={0} aria-label={`Filter ${counts.unowned} apps without an owner`} aria-pressed={filter === 'no-owner'}
                onClick={() => onFilter('no-owner')} onKeyDown={activateUnowned}
                className="cursor-pointer stroke-warning focus:outline-none focus-visible:stroke-text"
              />
            )}
            <text x="24" y="25" textAnchor="middle" dominantBaseline="middle" className="fill-text text-[7px] font-medium tabular-nums">{counts.owned}/{counts.total}</text>
          </svg>
          <div className="flex flex-col items-start gap-1.5 text-xs text-text-muted">
            <span><span className="mr-1.5 inline-block size-2 rounded-full bg-success" />Owned {counts.owned}</span>
            <LegendButton pressed={filter === 'no-owner'} onClick={() => onFilter('no-owner')}>Without owner {counts.unowned}</LegendButton>
          </div>
        </div>
      )}
      <div className={cn('mt-auto', personal ? 'pt-8' : 'pt-5')}>
        <StageBar rows={rows} filter={filter} onFilter={onFilter} />
      </div>
    </Card>
  )
}

function Pulse({ rows, now }: Pick<AtAGlanceProps, 'rows'> & { now: Date }) {
  const points = pulsePoints(rows, now)
  const counts = pulseCounts(rows, now)
  const noData = counts.noData ? ` · ${counts.noData} no data` : ''
  return (
    <Card className="flex min-h-64 min-w-0 flex-col">
      <PanelMetric label="Pulse" value={counts.active} unit={`active in ${STALE_DAYS} days`} line={`${counts.quiet} quiet for ${STALE_DAYS}+ days${noData}`} />
      <svg viewBox="0 0 100 50" className="mt-auto w-full overflow-visible pt-4" aria-label="Last app activity over 60 days">
        <rect x="0" y="2" width={PULSE_QUIET_X} height="38" rx="1.5" className="fill-surface-2" />
        <text x="2" y="6.5" className="fill-text-faint text-[3.2px]">Quiet</text>
        {points.some((point) => point.olderThanRange) && <text x="1" y="11" className="fill-text-muted text-[3px] font-medium">60+</text>}
        <line x1="0" y1="40" x2="100" y2="40" className="stroke-border-strong" strokeWidth="0.5" />
        {PULSE_TICKS.map((tick) => (
          <g key={tick.day}>
            <line x1={tick.x} y1="39" x2={tick.x} y2="42" className="stroke-border-strong" strokeWidth="0.5" />
            <text x={tick.x} y="47" textAnchor={tick.x === 0 ? 'start' : tick.x === 100 ? 'end' : 'middle'} className="fill-text-faint text-[3px]">{tick.label}</text>
          </g>
        ))}
        {points.map((point) => {
          const iso = new Date(point.at).toISOString()
          return (
            <a
              key={point.row.project.id}
              href={toHash({ name: 'project', projectId: point.row.project.id, view: 'app' })}
              aria-label={`${point.row.project.name}: last commit ${timeAgo(iso, now.getTime())}`}
              className="group focus:outline-none"
            >
              <circle cx={point.x} cy={15 + point.lane * 6.5} r="2.2" className={cn(point.quiet ? 'fill-warning' : 'fill-accent', 'stroke-surface stroke-[0.8] group-focus-visible:stroke-text group-focus-visible:stroke-[1.5]')} />
            </a>
          )
        })}
      </svg>
    </Card>
  )
}

export function AtAGlance({ rows, personal, filter, onFilter, now = new Date() }: AtAGlanceProps) {
  const reducedMotion = useReducedMotion()
  return (
    <section className="mb-6" aria-labelledby="at-a-glance-title">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 id="at-a-glance-title" className="text-sm font-medium text-text">At a glance</h2>
      </div>
      <motion.div {...(reducedMotion ? { initial: false } : fadeUp)} className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <HealthMap rows={rows} filter={filter} onFilter={onFilter} />
        <Ownership rows={rows} personal={personal} filter={filter} onFilter={onFilter} />
        <Pulse rows={rows} now={now} />
      </motion.div>
    </section>
  )
}
