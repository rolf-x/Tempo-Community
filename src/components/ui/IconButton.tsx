import type { ComponentPropsWithRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: LucideIcon
  /** Required: becomes the aria-label and the native tooltip (title). Add the shortcut, e.g. "Search · ⌘K". */
  label: string
  /** md = 32px (default), sm = 28px, xs = 24px */
  size?: 'xs' | 'sm' | 'md'
  variant?: 'ghost' | 'secondary'
  /** Pressed/selected look */
  active?: boolean
}

const SIZE = {
  xs: 'size-6 [&_svg]:size-3.5',
  sm: 'size-7 [&_svg]:size-4',
  md: 'size-8 [&_svg]:size-4',
}

export function IconButton({ icon: Icon, label, size = 'md', variant = 'ghost', active, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center rounded-md transition-[background-color,color,border-color] duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        variant === 'ghost' && 'text-text-muted hover:bg-surface-2 hover:text-text',
        variant === 'secondary' && 'border border-border-strong bg-surface text-text-muted hover:bg-surface-2 hover:text-text',
        active && 'bg-surface-2 text-text',
        SIZE[size],
        className,
      )}
      {...rest}
    >
      <Icon strokeWidth={2} aria-hidden />
    </button>
  )
}
