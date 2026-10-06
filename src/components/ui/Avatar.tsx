import { User } from 'lucide-react'
import { cn } from './cn'
import { PROJECT_COLOR, colorForName } from './colors'

export interface AvatarProps {
  /** Free-text name. null → empty "unassigned" avatar */
  name: string | null
  /** xs = 18px, sm = 22px (default), md = 28px */
  size?: 'xs' | 'sm' | 'md'
  /** Photo (e.g. from Google or GitHub). Falls back to initials. */
  src?: string | null
  className?: string
}

const SIZE = { xs: 'size-[18px] text-[9px]', sm: 'size-[22px] text-[10px]', md: 'size-7 text-xs' }

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length === 0 ? '?' : (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ name, size = 'sm', className, src }: AvatarProps) {
  if (!name) {
    return (
      <span
        title="Unassigned"
        className={cn(
          'grid shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-text-muted',
          SIZE[size],
          className,
        )}
      >
        <User className="size-[55%]" aria-hidden />
      </span>
    )
  }
  if (src) {
    return <img src={src} alt={name} title={name} referrerPolicy="no-referrer" className={cn('shrink-0 rounded-full object-cover', SIZE[size], className)} />
  }
  const c = PROJECT_COLOR[colorForName(name)]
  return (
    <span
      title={name}
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--t-p-${colorForName(name)}) 55%, transparent)` }}
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold leading-none', SIZE[size], c.soft, c.text, className)}
    >
      {initials(name)}
    </span>
  )
}
