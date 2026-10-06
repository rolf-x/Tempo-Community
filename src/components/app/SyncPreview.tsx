// Review a drafted app card before it is saved.
import { ArrowRight, ExternalLink } from 'lucide-react'
import type { SyncOutcome } from '../../ai/router'
import type { AppCardEvidence, Project, RepoSignals } from '../../types'
import { useStore } from '../../store/useStore'
import { useUI } from '../uiState'
import { Button, Modal } from '../ui'
import { AIErrorNotice } from '../ai/AIErrorNotice'
import { StageBadge, timeAgo } from './AppBadges'

export interface SyncPreviewProps {
  open: boolean
  onClose: () => void
  project: Project
  outcome: SyncOutcome | null
  editable?: boolean
}

export const keepsExistingAICard = (project: Project, outcome: SyncOutcome) => outcome.source === 'fallback' && project.appCard?.source === 'ai'

export function SyncPreview({ open, onClose, project, outcome, editable }: SyncPreviewProps) {
  if (!outcome) return null
  return <Body key={outcome.signals.syncedAt} open={open} onClose={onClose} project={project} outcome={outcome} editable={editable} />
}

function Body({ open, onClose, project, outcome, editable = true }: SyncPreviewProps & { outcome: SyncOutcome }) {
  const old = project.appCard
  const keepCard = keepsExistingAICard(project, outcome)
  const statusChanged = !!old && old.status !== outcome.card.status

  const apply = () => {
    if (!editable) return
    useStore.getState().commitSync(project.id, { card: outcome.card, signals: outcome.signals, source: outcome.source }, true)
    useUI.getState().notify('Card saved', 'success')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Review sync"
      description={`What Tempo found in ${project.repo?.fullName ?? 'the repo'}.`}
      footer={
        <>
          <Button onClick={onClose}>{keepCard ? 'Close' : 'Cancel'}</Button>
          {editable && !keepCard && <Button variant="accent" onClick={apply}>Save card</Button>}
        </>
      }
    >
      <div className="space-y-5">
        <section aria-label="App card">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-muted">
            Status
            {keepCard ? (
              <StageBadge stage={old!.stage} />
            ) : old && old.stage !== outcome.card.stage ? (
              <span className="inline-flex items-center gap-1">
                <StageBadge stage={old.stage} />
                <ArrowRight className="size-3" aria-hidden />
                <StageBadge stage={outcome.card.stage} />
              </span>
            ) : (
              <StageBadge stage={outcome.card.stage} />
            )}
          </div>
          {keepCard ? (
            <>
              <p className="rounded-md bg-accent-soft px-3 py-2 text-sm leading-5 text-text">{old!.status}</p>
              <p className="mt-2 text-xs font-medium text-text-muted">Repo facts</p>
              <p className="mt-1 rounded-md bg-surface-2 px-3 py-2 text-sm leading-5 text-text-muted">{outcome.card.status}</p>
            </>
          ) : (
            <>
              {statusChanged && <p className="mb-1 rounded-md bg-surface-2 px-3 py-2 text-sm leading-5 text-text-muted line-through">{old!.status}</p>}
              <p className="rounded-md bg-accent-soft px-3 py-2 text-sm leading-5 text-text">{outcome.card.status}</p>
            </>
          )}
          {!old && <p className="mt-2 text-sm text-text-muted">{outcome.card.what}</p>}
          <CardEvidenceRows project={project} evidence={outcome.card.evidence ?? null} signals={outcome.signals} className="mt-3" />
        </section>

        {keepCard && <p className="text-sm text-text-muted">Repo facts refreshed. The AI-written card was kept.</p>}

        {outcome.error ? (
          <AIErrorNotice error={outcome.error} provider={outcome.errorProvider} className="text-text-muted" />
        ) : outcome.note ? (
          <p className="text-xs leading-5 text-text-muted">{outcome.note}</p>
        ) : null}
      </div>
    </Modal>
  )
}

/** Exact repo facts shown with a card draft. Shared by sync review and the cross-app review queue. */
export function CardEvidenceRows({ project, evidence = project.appCard?.evidence, signals = project.signals, className }: {
  project: Project
  evidence?: AppCardEvidence | null
  signals?: RepoSignals | null
  className?: string
}) {
  const rows = [
    evidence?.readme ? { label: 'README', value: `“${evidence.readme}”`, href: null } : null,
    evidence?.lastCommit ? {
      label: 'Last commit',
      value: `${evidence.lastCommit.message} · ${evidence.lastCommit.author} · ${timeAgo(evidence.lastCommit.at)}`,
      href: evidence.lastCommit.url,
    } : signals?.lastCommitAt ? { label: 'Last commit', value: timeAgo(signals.lastCommitAt), href: null } : null,
    evidence?.deployFile ? { label: 'Deploy file', value: evidence.deployFile, href: null } : null,
  ].filter((row): row is { label: string; value: string; href: string | null } => !!row)

  if (!rows.length) return <p className={className ? `${className} text-sm text-text-muted` : 'text-sm text-text-muted'}>No card evidence was saved for this draft.</p>
  return (
    <dl className={className ? `${className} divide-y divide-border rounded-lg border border-border` : 'divide-y divide-border rounded-lg border border-border'}>
      {rows.map((row) => (
        <div key={row.label} className="grid min-w-0 gap-1 px-3 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
          <dt className="font-mono text-xs text-text-muted">{row.label}</dt>
          <dd className="min-w-0 break-words text-sm text-text">
            {row.href ? (
              <a href={row.href} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-start gap-1 rounded-sm text-accent hover:underline">
                <span>{row.value}</span><ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              </a>
            ) : row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
