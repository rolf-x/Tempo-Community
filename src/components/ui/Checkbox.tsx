import { motion, useReducedMotion } from 'framer-motion'
import { cn } from './cn'
import { EASE } from './motion'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** md = 18px (default), sm = 16px */
  size?: 'sm' | 'md'
  disabled?: boolean
  /** Visible label to the right. Without it, pass aria-label. */
  label?: string
  'aria-label'?: string
  className?: string
}

/** Round checkbox. Click toggles; Space/Enter work via the native button. */
export function Checkbox({ checked, onChange, size = 'md', disabled, label, className, ...aria }: CheckboxProps) {
  const reducedMotion = useReducedMotion()
  const box = (
    <motion.span
      aria-hidden
      whileTap={disabled || reducedMotion ? undefined : { scale: 0.88 }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color] duration-150',
        size === 'sm' ? 'size-4' : 'size-[18px]',
        checked ? 'border-accent-strong bg-accent-strong' : 'border-border-strong bg-surface group-hover:border-accent',
      )}
    >
      <svg viewBox="0 0 12 12" fill="none" className={size === 'sm' ? 'size-2.5' : 'size-3'}>
        <motion.path
          d="M2.5 6.2 5 8.6 9.6 3.6"
          stroke="var(--t-accent-ink)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18, ease: EASE }}
        />
      </svg>
    </motion.span>
  )

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'focus-ring group inline-flex items-center gap-2.5 rounded-full text-left disabled:opacity-50',
        label && 'rounded-md',
        className,
      )}
    >
      {box}
      {label && <span className={cn('text-sm', checked ? 'text-text-muted line-through' : 'text-text')}>{label}</span>}
    </button>
  )
}
