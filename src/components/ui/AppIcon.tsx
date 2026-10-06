import type { Color } from '../../types'
import { cn } from './cn'
import { PROJECT_COLOR } from './colors'

export interface AppIconProps {
  name: string
  color: Color
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE = {
  sm: 'size-5 rounded-[5px] text-[10px]',
  md: 'size-8 rounded-md text-sm',
  lg: 'size-9 rounded-lg text-base',
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function appMonogram(name: string): string {
  const first = segmenter.segment(name.trim())[Symbol.iterator]().next().value?.segment
  return first ? first.toUpperCase() : '?'
}

export function AppIcon({ name, color, size = 'sm', className }: AppIconProps) {
  const c = PROJECT_COLOR[color]
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center font-semibold leading-none', SIZE[size], c.soft, c.ink, className)}
    >
      {appMonogram(name)}
    </span>
  )
}
