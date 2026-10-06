import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  body?: ReactNode
  /** Usually one <Button variant="primary">; keep it to one or two */
  action?: ReactNode
  /** Smaller padding, for inside cards and columns */
  compact?: boolean
  className?: string
}

/** Designed empty state. Centered, calm, one call to action. */
export function EmptyState({ icon: Icon, title, body, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-20', className)}>
      {Icon && (
        <div
          className={cn(
            'relative mb-4 grid place-items-center rounded-2xl border border-border bg-bg text-text-muted shadow-xs',
            compact ? 'size-10 rounded-xl' : 'size-12',
          )}
        >
          <Icon strokeWidth={1.75} className={compact ? 'size-[18px]' : 'size-[22px]'} aria-hidden />
        </div>
      )}
      <h3 className={cn('font-semibold text-text', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {body && <p className={cn('mt-1 max-w-sm text-balance text-text-muted', compact ? 'text-xs' : 'text-sm')}>{body}</p>}
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  )
}
