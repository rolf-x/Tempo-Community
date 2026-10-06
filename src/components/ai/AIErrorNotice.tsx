import { explainAIError } from '../../ai/errors'
import type { Provider } from '../../types'
import { cn } from '../ui'

export function AIErrorNotice({ error, provider, className }: { error: unknown; provider?: Provider; className?: string }) {
  const copy = explainAIError(error, provider)
  return (
    <div role="alert" className={cn('text-sm', className)}>
      <p>{copy.message}</p>
      <details className="mt-1 text-xs">
        <summary className="focus-ring w-fit cursor-pointer rounded-sm text-text-muted hover:text-text">Details</summary>
        <code className="mt-1 block whitespace-pre-wrap break-words rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-4 text-text-muted">{copy.details}</code>
      </details>
    </div>
  )
}
