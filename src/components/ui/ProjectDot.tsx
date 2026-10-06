import type { Color } from '../../types'
import { cn } from './cn'
import { PROJECT_COLOR } from './colors'

export interface ProjectDotProps {
  color: Color
  /** Pixel size, default 8 */
  size?: number
  className?: string
}

export function ProjectDot({ color, size = 8, className }: ProjectDotProps) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', PROJECT_COLOR[color].dot, className)}
      style={{ width: size, height: size }}
    />
  )
}
