// Literal class maps so Tailwind can see every class name at build time.
import type { Color } from '../../types'

export interface ColorClasses {
  /** Solid dot / bar fill */
  dot: string
  /** Soft tint background */
  soft: string
  /** Readable label text (project hues are markers, not text colours). */
  text: string
  /** Coloured border */
  border: string
}

export interface ProjectColorClasses extends ColorClasses {
  /** Project hue as readable ink on its soft tint */
  ink: string
}

export const PROJECT_COLOR: Record<Color, ProjectColorClasses> = {
  slate: { dot: 'bg-p-slate', soft: 'bg-p-slate-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-slate)_70%,var(--t-text))]', border: 'border-p-slate' },
  violet: { dot: 'bg-p-violet', soft: 'bg-p-violet-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-violet)_70%,var(--t-text))]', border: 'border-p-violet' },
  blue: { dot: 'bg-p-blue', soft: 'bg-p-blue-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-blue)_70%,var(--t-text))]', border: 'border-p-blue' },
  teal: { dot: 'bg-p-teal', soft: 'bg-p-teal-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-teal)_70%,var(--t-text))]', border: 'border-p-teal' },
  green: { dot: 'bg-p-green', soft: 'bg-p-green-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-green)_70%,var(--t-text))]', border: 'border-p-green' },
  amber: { dot: 'bg-p-amber', soft: 'bg-p-amber-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-amber)_70%,var(--t-text))]', border: 'border-p-amber' },
  rose: { dot: 'bg-p-rose', soft: 'bg-p-rose-soft', text: 'text-text', ink: 'text-[color-mix(in_srgb,var(--t-p-rose)_70%,var(--t-text))]', border: 'border-p-rose' },
}

/** Stable project colour for a free-text name (avatars). */
export function colorForName(name: string): Color {
  const pool: Color[] = ['violet', 'blue', 'teal', 'green', 'amber', 'rose']
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return pool[h % pool.length]
}
