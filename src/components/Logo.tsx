import { cn } from './ui/cn'

export interface MarkProps {
  /** Pixel size, default 22 */
  size?: number
  /** Draw the beat once on mount. Toggle false → true to draw it again. */
  tick?: boolean
  /** Change this value (e.g. a sync counter) to replay the draw. */
  tickKey?: string | number
  /** Draw, hold and fade in a loop while loading; takes precedence over tick. */
  loading?: boolean
  className?: string
}

/** One beat on a 24 grid; the small cut keeps the beat from going thin at 20px and below. */
const BEAT = { d: 'M5 12H8.6L10.6 6.4L13.4 17.6L15.3 12H19', stroke: 2.2 }
const BEAT_SMALL = { d: 'M5.5 12H8.8L10.7 6.6L13.3 17.4L15.2 12H18.5', stroke: 2.6 }

/** The Tempo mark: one heartbeat on a rounded tile. Colour follows `currentColor` (defaults to the mark token). */
export function Mark({ size = 22, tick = true, tickKey, loading = false, className }: MarkProps) {
  const beat = size <= 20 ? BEAT_SMALL : BEAT
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn('shrink-0 text-mark', loading ? 'tempo-mark-loading' : tick && 'tempo-mark-tick', className)}
    >
      <rect width="24" height="24" rx="7" fill="currentColor" />
      <path
        key={tickKey}
        className="mark-beat"
        d={beat.d}
        pathLength={100}
        stroke="var(--t-mark-ink, var(--t-accent-ink))"
        strokeWidth={beat.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark({ className, ...markProps }: MarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Mark {...markProps} />
      <span className="text-[16px] font-semibold tracking-[0.2px] text-text">Tempo</span>
    </span>
  )
}
