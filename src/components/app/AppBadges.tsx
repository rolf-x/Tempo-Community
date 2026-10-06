// Shared app badges: stage (idea/building/live/stale) and health flags. Used by Portfolio and the app page.
import { CalendarClock, CircleDashed, FileWarning, Globe, Hammer, KeyRound, Moon, Radio, Sparkles, UserX, Unplug, type LucideIcon } from 'lucide-react'
import { isUncheckedAICard, type AppCard, type Stage } from '../../types'
import { flagTone, type FlagTone, type HealthFlag, type HealthKind } from '../../ai/tools/health'
import { cn } from '../ui'
import { clientName } from '../../ai/tools/mcpDrafts'
import { mcpEnabled } from '../../lib/aiMode'
import { aiAppName } from '../../lib/mcpSetup'
import { openClaudeWindow } from '../uiState'

const STAGE: Record<Stage, { label: string; icon: LucideIcon; cls: string }> = {
  idea: { label: 'Idea', icon: CircleDashed, cls: 'bg-surface-2 text-text-muted' },
  building: { label: 'Building', icon: Hammer, cls: 'bg-accent-soft text-accent' },
  live: { label: 'Live', icon: Radio, cls: 'bg-success-soft text-success' },
  stale: { label: 'Stale', icon: Moon, cls: 'bg-warning-soft text-warning' },
}

export function StageBadge({ stage, className }: { stage: Stage | null | undefined; className?: string }) {
  if (!stage) return null
  const s = STAGE[stage]
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium', s.cls, className)}>
      <s.icon className="size-3" aria-hidden />
      {s.label}
    </span>
  )
}

export function DraftBadge({ card, className, href }: { card: AppCard | null | undefined; className?: string; href?: string }) {
  if (!card || !isUncheckedAICard(card)) return null
  const sources = [card.evidence?.readme && 'README', card.evidence?.lastCommit && 'last commit', card.evidence?.deployFile && card.evidence.deployFile].filter(Boolean)
  // An agent's draft over MCP names its client; Tempo's own drafts keep "Drafted by Tempo".
  const author = card.draftedBy ? clientName(card.draftedBy.client) : 'Tempo'
  const title = card.draftedBy ? `Written by ${author} over MCP. Check it in Review.`
    : sources.length ? `Written from ${sources.join(', ')}` : 'Check this AI-written card'
  const content = <><Sparkles className="size-3 shrink-0" aria-hidden /><span className="truncate">Drafted by {author}</span></>
  const classes = cn('inline-flex h-5 items-center gap-1 rounded-full bg-warning-soft px-2 text-xs font-medium text-warning', className)
  return href ? (
    <a href={href} className={cn('focus-ring relative z-10', classes)} title={title}>
      {content}
    </a>
  ) : (
    <span className={classes} title={title}>
      {content}
    </span>
  )
}

type OutOfDateChipProps = { className?: string } & (
  | { variant?: 'draft'; writing: boolean; onClick: () => void }
  | { variant: 'no-ai'; writing?: never; onClick?: never }
)

export function OutOfDateChip(props: OutOfDateChipProps) {
  const classes = cn('focus-ring relative z-10 inline-flex h-6 items-center rounded-full bg-warning-soft px-2.5 text-xs font-medium text-warning', props.className)
  if (props.variant === 'no-ai') {
    return (
      <a
        href="#/settings"
        title={mcpEnabled() ? `Ask ${aiAppName()} to draft this card again` : 'Pick your AI to draft this card again'}
        // mcp and both modes (shown only while no key is saved): the Claude window, with the message that asks Claude for this card. A modified click still opens plain Settings in a new tab.
        onClick={(event) => {
          if (!mcpEnabled() || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          openClaudeWindow('sync')
        }}
        className={classes}
      >
        Out of date
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.writing}
      className={cn(classes, 'disabled:opacity-60')}
    >
      {props.writing ? 'Writing…' : 'Out of date · Draft again'}
    </button>
  )
}

const FLAG_ICON: Record<HealthKind, LucideIcon> = {
  'no-owner': UserX,
  'owner-leaving': CalendarClock,
  'owner-left': UserX,
  secrets: KeyRound,
  'public-repo': Globe,
  stale: Moon,
  'no-readme': FileWarning,
  'no-repo': Unplug,
}
const FLAG_TONE: Record<FlagTone, string> = {
  risk: 'bg-danger-soft text-danger',
  warn: 'bg-warning-soft text-warning',
  quiet: 'bg-surface-2 text-text-muted',
}

/** One chip per flag. `compact` shows icons only (label in the tooltip) for dense cards. */
export function HealthFlags({ flags, compact, max = 4, className }: { flags: HealthFlag[]; compact?: boolean; max?: number; className?: string }) {
  if (flags.length === 0) return null
  const shown = flags.slice(0, max)
  return (
    <ul className={cn('flex flex-wrap items-center gap-1', className)} aria-label="Health signals">
      {shown.map((f) => {
        const Icon = FLAG_ICON[f.kind]
        return (
          <li
            key={f.kind}
            title={compact ? f.label : undefined}
            className={cn('inline-flex h-5 items-center gap-1 rounded-full text-xs font-medium', compact ? 'w-5 justify-center' : 'px-2', FLAG_TONE[flagTone(f)])}
          >
            <Icon className="size-3 shrink-0" aria-hidden />
            {compact ? <span className="sr-only">{f.label}</span> : <span className="truncate">{f.label}</span>}
          </li>
        )
      })}
      {flags.length > max && <li className="text-xs text-text-muted">+{flags.length - max}</li>}
    </ul>
  )
}

/** Short relative time: "2 h ago", "3 d ago". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d < 60 ? `${d} d ago` : `${Math.round(d / 30)} mo ago`
}
