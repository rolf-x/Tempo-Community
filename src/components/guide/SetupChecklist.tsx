import { useId, useState } from 'react'
import { Check, ChevronDown, Circle } from 'lucide-react'
import { cn, ProgressBar } from '../ui'
import { followGuide, guideHref } from './actions'
import { useGuide } from './useGuide'

export function SetupChecklist() {
  const guide = useGuide()
  const id = useId()
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null)
  const collapsed = collapsedOverride ?? (guide.checklistCollapsed || guide.done >= 2)
  if (!guide.visible) return null
  if (guide.complete) return <p className="mb-3 px-2.5 py-2 text-xs font-medium text-text-muted">Set up ✓</p>
  return (
    <section className="mb-3 min-w-0 rounded-lg border border-border bg-surface" aria-label="Get set up">
      <button type="button" className="focus-ring w-full rounded-md px-2.5 py-2 text-left text-xs font-medium text-text"
        aria-expanded={!collapsed} aria-controls={id} onClick={() => {
          const next = !collapsed
          setCollapsedOverride(next)
          guide.setCollapsed(next)
        }}>
        <span className="flex items-center justify-between gap-2">
          <span className="tabular-nums">Get set up · {guide.done} of {guide.total}</span>
          <ChevronDown aria-hidden className={cn('size-3.5 shrink-0', collapsed && '-rotate-90')} />
        </span>
        <ProgressBar value={(guide.done / guide.total) * 100} className="mt-2" />
      </button>
      <ul id={id} hidden={collapsed} className="space-y-0.5 px-1 pb-1.5">
        {guide.checklist.map((item) => {
          const Icon = item.done ? Check : Circle
          return (
            <li key={item.id}>
              <a href={guideHref(item.action)} className="focus-ring flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-surface-2"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  followGuide(item.action)
                }}>
                <Icon className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden />
                <span className="min-w-0 break-words">
                  <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
                  <span className="text-text">{item.label}</span>
                  {item.result && <span className="mt-0.5 block text-text-muted tabular-nums [overflow-wrap:anywhere]">{item.result}</span>}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
