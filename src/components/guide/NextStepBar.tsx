import { AlertTriangle } from 'lucide-react'
import { Button, cn } from '../ui'
import { followGuide } from './actions'
import { useGuide } from './useGuide'

export function NextStepBar({ projectIds }: { projectIds?: ReadonlySet<string> }) {
  const guide = useGuide(projectIds)
  const step = guide.next
  if (!guide.visible || !step) return null
  return (
    <section aria-label="Next step" className={cn('mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5', step.health ? 'border-danger/30' : 'border-border')}>
      <div className="min-w-0 flex-1 text-sm">
        {step.health && <span className="mr-2 inline-flex items-center gap-1 text-xs font-medium text-danger">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />{step.health.label}
        </span>}
        <span className="text-text [overflow-wrap:anywhere]">{step.text}</span>
      </div>
      <Button size="sm" variant="secondary" className="motion-reduce:transform-none motion-reduce:transition-none" onClick={() => followGuide(step.action)}>{step.button}</Button>
    </section>
  )
}
