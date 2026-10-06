import type { ComponentPropsWithRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export type FieldSize = 'sm' | 'md' | 'lg'

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** sm = 28px, md = 32px (default), lg = 40px */
  size?: FieldSize
  /** Leading icon */
  icon?: LucideIcon
  /** Red border + ring. Pair with a helper line in text-danger. */
  invalid?: boolean
}

export const FIELD_SIZE: Record<FieldSize, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5 text-sm',
  lg: 'h-10 px-3 text-base',
}

export function Input({ size = 'md', icon: Icon, invalid, className, ...rest }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn('field', FIELD_SIZE[size], Icon && (size === 'sm' ? 'pl-7' : size === 'lg' ? 'pl-10' : 'pl-8'), className)}
      {...rest}
    />
  )
  if (!Icon) return input
  return (
    <div className="relative w-full">
      <Icon
        aria-hidden
        strokeWidth={2}
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-faint',
          size === 'sm' ? 'left-2 size-3.5' : size === 'lg' ? 'left-3 size-4.5' : 'left-2.5 size-4',
        )}
      />
      {input}
    </div>
  )
}
