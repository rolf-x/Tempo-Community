import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from './cn'

/* ── Page ──────────────────────────────────────────────────────────────────── */

export interface PageProps {
  /** narrow 720 · default 960 · wide 1200 · full */
  width?: 'narrow' | 'default' | 'wide' | 'full'
  className?: string
  children: ReactNode
}

const WIDTH = { narrow: 'max-w-3xl', default: 'max-w-5xl', wide: 'max-w-7xl', full: 'max-w-none' }

/** Every view's outer wrapper: page padding + max width. */
export function Page({ width = 'default', className, children }: PageProps) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-8 sm:py-8', WIDTH[width], className)}>{children}</div>
}

/* ── PageHeader ────────────────────────────────────────────────────────────── */

export interface PageHeaderProps {
  /** Small muted line above the title (date, project name) */
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Right-aligned actions; wraps under the title on phones */
  actions?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('page-header mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="mb-1 font-mono text-xs font-medium text-text-muted">{eyebrow}</div>}
        <h1 className="page-title text-xl font-medium tracking-[0.2px] text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/* ── SectionHeader ─────────────────────────────────────────────────────────── */

export interface SectionHeaderProps {
  title: ReactNode
  /** Muted count after the title */
  count?: number
  action?: ReactNode
  className?: string
}

export function SectionHeader({ title, count, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-2 flex h-7 items-center justify-between gap-3', className)}>
      <h2 className="flex items-baseline gap-1.5 text-sm font-medium text-text-muted">
        {title}
        {count !== undefined && <span className="text-xs tabular-nums text-text-muted">{count}</span>}
      </h2>
      {action}
    </div>
  )
}

/* ── Card ──────────────────────────────────────────────────────────────────── */

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** Hover lift for clickable cards */
  interactive?: boolean
  /** Remove the default p-4 */
  bare?: boolean
}

export function Card({ interactive, bare, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface',
        !bare && 'p-4',
        interactive && 'cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-sm',
        className,
      )}
      {...rest}
    />
  )
}
