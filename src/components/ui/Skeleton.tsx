import { cn } from './cn'

export interface SkeletonProps {
  /** Size it with className, e.g. 'h-4 w-40' */
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn('skeleton', className)} />
}

/** A few lines of placeholder text */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

/** Placeholder for a compact list row. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-11 items-center gap-3 px-3', className)} aria-hidden>
      <Skeleton className="size-[18px] rounded-full" />
      <Skeleton className="h-3.5 flex-1 max-w-[60%]" />
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-5 w-12 rounded-full" />
    </div>
  )
}
