import { useEffect, useRef, type ComponentPropsWithRef } from 'react'
import { cn } from './cn'

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  invalid?: boolean
  /** Grow with content (no manual resize handle) */
  autoGrow?: boolean
  /** Plain text look with no border or shadow. */
  bare?: boolean
}

function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function Textarea({ invalid, autoGrow, bare, className, onInput, value, rows = 3, ref, ...rest }: TextareaProps) {
  const inner = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (autoGrow && inner.current) grow(inner.current)
  }, [autoGrow, value])

  return (
    <textarea
      ref={(node) => {
        inner.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      rows={rows}
      value={value}
      aria-invalid={invalid || undefined}
      onInput={(e) => {
        if (autoGrow) grow(e.currentTarget)
        onInput?.(e)
      }}
      className={cn(
        bare ? 'focus-ring w-full bg-transparent text-text placeholder:text-text-faint' : 'field px-2.5 py-1.5 text-sm leading-5',
        'resize-none',
        className,
      )}
      {...rest}
    />
  )
}
