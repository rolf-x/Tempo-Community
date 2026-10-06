import type { ComponentPropsWithRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './cn'
import { FIELD_SIZE, type FieldSize } from './Input'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size'> {
  size?: FieldSize
  /** Either pass options or <option> children */
  options?: SelectOption[]
  invalid?: boolean
}

export function Select({ size = 'md', options, invalid, className, children, ...rest }: SelectProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <select
        aria-invalid={invalid || undefined}
        className={cn('field appearance-none pr-8', FIELD_SIZE[size])}
        {...rest}
      >
        {options ? options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>) : children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={2}
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint"
      />
    </div>
  )
}
