import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { spring } from './motion'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  /** e.g. a colour for a status icon */
  iconClassName?: string
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  /** md = 32px (default), sm = 28px */
  disabled?: boolean
  size?: 'sm' | 'md'
  /** Show icons only below this breakpoint ('sm') or never hide labels */
  collapseLabels?: 'sm' | 'never'
  'aria-label'?: string
  className?: string
}

/** iOS/Linear-style segmented switch with a sliding indicator. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  disabled = false,
  collapseLabels = 'sm',
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const reducedMotion = useReducedMotion()
  const id = useId()
  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      className={cn('inline-flex shrink-0 items-center rounded-md border border-border bg-surface-2 p-0.5', className)}
      onKeyDown={(e) => {
        if (disabled || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
        // Arrows move the selection and the focus together (the unselected tabs are out of the tab order).
        e.preventDefault()
        const i = options.findIndex((o) => o.value === value)
        const next = e.key === 'ArrowRight' ? (i + 1) % options.length : (i - 1 + options.length) % options.length
        onChange(options[next].value)
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
      }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring disabled:pointer-events-none disabled:opacity-50 relative inline-flex items-center gap-1.5 rounded-md font-medium transition-colors duration-150',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-xs',
              active ? 'text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={reducedMotion ? { duration: 0 } : spring}
                className="absolute inset-0 rounded-sm border border-border-strong bg-surface-3"
                aria-hidden
              />
            )}
            {o.icon && <o.icon className={cn('relative size-3.5', o.iconClassName)} strokeWidth={2} aria-hidden />}
            <span className={cn('relative', collapseLabels === 'sm' && o.icon && 'hidden sm:inline')}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
