import type { ComponentPropsWithRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface ChipProps extends ComponentPropsWithRef<'button'> {
  /** Pressed look; also sets aria-pressed */
  selected?: boolean
  /** Muted count after the label */
  count?: number
  icon?: LucideIcon
}

/** Toggle chip for a filter row (Portfolio). One row per view; the first chip is usually "All". */
export function Chip({ selected = false, count, icon: Icon, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'focus-ring inline-flex h-7 shrink-0 select-none items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-150',
        selected ? 'border-transparent bg-accent-soft text-text' : 'border-border-strong bg-surface text-text-muted hover:border-text-muted hover:text-text',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />}
      {children}
      {count !== undefined && <span className="tabular-nums text-text-muted">{count}</span>}
    </button>
  )
}
