// Portfolio card for one app. Presentational: it takes a PortfolioRow, so the landing preview can render the same
// card from seed data without the store. The whole card is clickable through a stretched link on the name.
import type { MouseEvent, ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'
import { plain } from '../../ai/tools/applySync'
import { redraftFactCards } from '../../ai/redraft'
import { useRedraftState } from '../../ai/redraftState'
import { workspaceAI } from '../../ai/workspaceAI'
import { isAICardOutOfDate } from '../../lib/cardFreshness'
import { useStore } from '../../store/useStore'
import type { Activity } from '../../types'
import { DraftBadge, HealthFlags, OutOfDateChip, StageBadge, timeAgo } from '../app/AppBadges'
import { MemberPicker } from '../people/MemberPicker'
import { useUI } from '../uiState'
import { AppIcon, Avatar, Button, Card, cn } from '../ui'
import type { PortfolioRow } from './derive'
import { isAtRisk } from '../../lib/attention'
import { canEditApp } from '../../lib/permissions'
import { changeProjectOwner } from '../../data/workspace'

const KIND_LABEL: Record<Activity['kind'], string> = { commit: 'Commit', pr: 'Pull request', issue: 'Issue', sync: 'Sync' }

/** "Commit · 2 h ago" from the latest activity; else the last commit from repo signals. */
export function lastActivityText(row: PortfolioRow, now = Date.now()): string {
  const { last, project } = row
  if (last && last.kind !== 'sync') return `${KIND_LABEL[last.kind]} · ${timeAgo(last.at, now)}`
  if (project.signals?.lastCommitAt) return `Last commit · ${timeAgo(project.signals.lastCommitAt, now)}`
  return 'No activity yet'
}

export interface AppTileProps {
  row: PortfolioRow
  href: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  /** Extra line under the footer (the landing preview's sync status) */
  footer?: ReactNode
  className?: string
}

export function AppTile({ row, href, onClick, footer, className }: AppTileProps) {
  const { project: p, owner, flags } = row
  const card = p.appCard
  const reducedMotion = useReducedMotion()
  const settings = useStore((state) => state.settings)
  const writing = useRedraftState((state) => state.writingIds.has(p.id))
  const provider = workspaceAI(settings).provider
  const canDraftCard = provider !== 'none' && provider !== 'demo'
  const workspace = useStore((state) => state.workspace)
  const me = useStore((state) => state.members.find((member) => member.id === state.meId) ?? null)
  const editable = !workspace || canEditApp(me, p)
  const compactFlags = flags.filter((flag) => flag.kind !== 'no-owner' && flag.kind !== 'owner-left')
  const appAtRisk = isAtRisk(flags)
  const cardOutOfDate = isAICardOutOfDate(p)

  const draftCard = () => {
    void redraftFactCards({ projectIds: [p.id], concurrency: 1 }).then((events) => {
      if (events.some((event) => event.type === 'failed')) {
        useUI.getState().notify("Tempo couldn't write this card. Its facts are still here. Draft again.", 'danger')
      }
    })
  }

  return (
    <Card
      interactive
      bare
      className={cn(
        'group relative isolate flex h-full flex-col overflow-hidden p-4',
        'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent',
        className,
      )}
    >
      {writing && !reducedMotion && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-1/3"
          style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--t-data, light-dark(#0E7490, #22D3EE)) 24%, transparent), transparent)' }}
          initial={{ x: '-120%', opacity: 0 }}
          animate={{ x: '360%', opacity: [0, 0.8, 0.8, 0] }}
          transition={{ duration: 1.2, ease: [0.2, 0, 0, 1] }}
        />
      )}
      <div className="flex items-start gap-3">
        <AppIcon name={p.name} color={p.color} size="md" />
        <div className="min-w-0 flex-1">
          {/* Stretched link: the ::after covers the card, so one tab stop opens the app. */}
          <a
            href={href}
            onClick={onClick}
            className="block truncate text-sm font-semibold text-text outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {p.name}
          </a>
          <p className="mt-0.5 truncate font-mono text-xs text-text-muted">{p.repo?.fullName ?? 'No repo connected'}</p>
        </div>
        <StageBadge stage={card?.stage} className="shrink-0" />
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-text-muted">{plain(card?.what ?? p.description ?? '')}</p>
      <DraftBadge card={card} href="#/review" className="mt-2 self-start" />
      {cardOutOfDate && canDraftCard && editable && <OutOfDateChip writing={writing} onClick={draftCard} className="mt-2 self-start" />}
      {cardOutOfDate && provider === 'none' && <OutOfDateChip variant="no-ai" className="mt-2 self-start" />}
      {card?.source === 'fallback' && editable && (
        <div className="relative z-10 mt-2 self-start" aria-live="polite">
          {writing ? (
            reducedMotion ? <span className="text-xs font-medium text-text-muted">Writing…</span> : <span className="sr-only">Writing…</span>
          ) : canDraftCard ? (
            <Button variant="secondary" size="sm" onClick={draftCard}>Draft again</Button>
          ) : null}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
          <Avatar name={owner?.name ?? null} src={owner?.avatarUrl} size="xs" />
          {(!owner || !owner.active) && editable ? (
            <MemberPicker
              value={p.ownerId}
              emptyLabel="No owner"
              inviteOnAssign={{ projectId: p.id, appName: p.name }}
              onChange={(ownerId) => changeProjectOwner(p.id, ownerId).catch((error) => useUI.getState().notify(error instanceof Error ? error.message : 'Could not revoke the old invite.', 'danger'))}
              trigger={(
                <button
                  type="button"
                  className={cn('focus-ring relative z-10 truncate rounded-sm text-left', owner ? 'font-medium text-text' : 'text-text-muted')}
                >
                  {owner ? <>{owner.name}<span className="font-normal text-text-muted"> · left</span></> : 'No owner'}
                </button>
              )}
            />
          ) : (
            <span className="truncate font-medium text-text">{owner?.name ?? 'No owner'}</span>
          )}
          <span className="shrink-0 text-text-faint" aria-hidden>
            ·
          </span>
          <span className="min-w-0 truncate tabular-nums">{lastActivityText(row)}</span>
        </div>

        <div className="mt-3 flex items-center justify-end gap-3">
          {/* `relative` lifts the chips above the stretched link so their tooltips still show. */}
          <div className="relative flex shrink-0 items-center gap-1">
            {appAtRisk && (
              <span
                className="inline-flex h-5 items-center gap-1 rounded-full bg-warning-soft px-2 text-xs font-medium text-warning"
                title={flags.filter((flag) => flag.kind === 'secrets' || flag.kind === 'public-repo').map((flag) => flag.label).join('\n')}
              >
                <TriangleAlert className="size-3" aria-hidden />
                At risk
              </span>
            )}
            <HealthFlags flags={compactFlags} compact max={3} />
          </div>
        </div>
        {footer}
      </div>
    </Card>
  )
}
