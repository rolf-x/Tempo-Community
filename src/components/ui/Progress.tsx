import { cn } from './cn'

export interface ProgressBarProps {
  /** 0–100 */
  value: number
  /** sm = 4px (default), md = 6px */
  size?: 'sm' | 'md'
  tone?: 'accent' | 'success' | 'muted'
  className?: string
}

const BAR = { accent: 'bg-accent', success: 'bg-success', muted: 'bg-text-muted' }

export function ProgressBar({ value, size = 'sm', tone = 'accent', className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full tabular-nums overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1' : 'h-1.5', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-[260ms] ease-out', BAR[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}
