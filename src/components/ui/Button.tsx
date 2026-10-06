import type { ComponentPropsWithRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Default 'secondary'. One primary per view. */
  variant?: ButtonVariant
  /** md = 32px (default), sm = 28px, lg = 40px */
  size?: ButtonSize
  /** Icon drawn left of the label */
  icon?: LucideIcon
  /** Shows a spinner in place of the icon and disables the button */
  loading?: boolean
  /** Full width */
  block?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'rounded-full bg-pill-bg text-pill-ink',
  accent: 'bg-accent-strong text-accent-ink hover:opacity-90',
  secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-2',
  ghost: 'text-text-muted hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-danger-ink hover:opacity-[0.88]',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 [&_svg]:size-3.5',
  md: 'h-8 px-3.5 text-[14px] gap-2 [&_svg]:size-4',
  lg: 'h-10 px-4.5 text-[15px] gap-2 [&_svg]:size-4',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      className={cn(
        'focus-ring inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium tracking-[0.2px]',
        'transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.985]',
        'disabled:pointer-events-none disabled:opacity-50',
        variant !== 'primary' && 'rounded-md',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : Icon ? <Icon strokeWidth={2} aria-hidden /> : null}
      {children}
    </button>
  )
}
