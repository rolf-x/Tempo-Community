import type { ReactNode } from 'react'
import { Card } from '../ui'

/** id: an anchor other cards can scroll to; it also makes the card focusable from code. */
export function Section({ title, description, id, children }: { title: string; description?: string; id?: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-4 p-5 outline-none" id={id} tabIndex={id ? -1 : undefined}>
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-text-muted">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-text-muted">{hint}</p>}
    </div>
  )
}
