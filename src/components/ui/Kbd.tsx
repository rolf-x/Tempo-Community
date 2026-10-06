import type { ReactNode } from 'react'
import { cn } from './cn'

export interface KbdProps {
  children: ReactNode
  className?: string
}

/** Keyboard key hint: <Kbd>⌘K</Kbd>, <Kbd>N</Kbd> */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border-strong bg-surface-2 px-1 font-sans text-[11px] font-medium text-text-muted',
        'shadow-[inset_0_-1px_0_var(--t-border-strong)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** Detects the modifier label for the platform: ⌘ on Mac, Ctrl elsewhere. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
