import { useMemo, useState } from 'react'
import { Archive, CalendarClock, CircleAlert, Copy, ExternalLink, FileText, GitCommit, Globe, KeyRound, Moon, RefreshCw, UserRound } from 'lucide-react'
import type { OwnerSuggestion } from '../../ai/tools/matchMember'
import { flagFixHeading, githubSettingsUrl, noRepoFixText, ownerFixText, publicRepoFixText, readmeDraft, repoFileUrl, secretCommitUrl, secretFixText, staleFixText, type CommitEvidence } from '../../ai/tools/flagFix'
import { flagTone, type FlagTone, type HealthFlag } from '../../ai/tools/health'
import type { Project } from '../../types'
import { useStore } from '../../store/useStore'
import { Button, cn } from '../ui'
import { useUI } from '../uiState'
import { MemberPicker } from '../people/MemberPicker'

interface FlagFixProps {
  flag: HealthFlag
  project: Project
  suggestion?: OwnerSuggestion | null
  commits?: CommitEvidence[]
  aiConnected: boolean
  syncing: boolean
  editable?: boolean
  canAssignSuggestion?: boolean
  onSync: () => void
  onOwnerChange: (memberId: string | null) => void
  onPickOwner: () => void
  onHandover: () => void
}

const ICON = {
  'no-owner': UserRound,
  'owner-leaving': CalendarClock,
  'owner-left': UserRound,
  secrets: KeyRound,
  'public-repo': Globe,
  stale: Moon,
  'no-readme': FileText,
  'no-repo': CircleAlert,
} as const

const TONE: Record<FlagTone, string> = {
  risk: 'border-danger/25 bg-danger-soft/40',
  warn: 'border-warning/25 bg-warning-soft/40',
  quiet: 'border-border bg-surface-2',
}

export const readmeDescription = (project: Project): string => project.description || project.appCard?.what || ''

export function FlagFix({ flag, project, suggestion, commits = [], aiConnected, syncing, editable = true, canAssignSuggestion = true, onSync, onOwnerChange, onPickOwner, onHandover }: FlagFixProps) {
  const Icon = ICON[flag.kind]
  const owner = useStore((state) => state.members.find((member) => member.id === project.ownerId) ?? null)
  const updateProject = useStore((state) => state.updateProject)
  const setUndo = useStore((state) => state.setUndo)
  const [showReadme, setShowReadme] = useState(false)
  const tone = flagTone(flag)
  const draft = useMemo(() => project.repo && project.signals ? readmeDraft({
    projectName: project.name,
    description: readmeDescription(project),
    repoFullName: project.repo.fullName,
    repoUrl: project.repo.url,
    signals: project.signals,
    appCard: project.appCard,
    aiConnected,
  }) : null, [project, aiConnected])

  const copyReadme = async () => {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft.markdown)
      useUI.getState().notify('README draft copied', 'success')
    } catch {
      useUI.getState().notify("Couldn't copy the README draft. Select the text instead.", 'danger')
    }
  }

  const archive = () => {
    updateProject(project.id, { archived: true })
    setUndo({
      label: `Archived “${project.name}”`,
      restore: () => {
        useStore.getState().updateProject(project.id, { archived: false })
        useStore.getState().setUndo(null)
      },
    })
  }

  return (
    <li className={cn('min-w-0 rounded-lg border p-3', TONE[tone])}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'risk' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-text-muted')} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">{flag.label}</p>
          <p className="mt-0.5 text-xs text-text-muted">{flagFixHeading(flag.kind)}</p>
        </div>
      </div>

      {(flag.kind === 'no-owner' || flag.kind === 'owner-left') && (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-text-muted">{ownerFixText(flag.kind)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {editable && <button type="button" className="focus-ring rounded-sm text-xs font-medium text-accent hover:underline" onClick={onPickOwner}>Pick owner</button>}
            {flag.kind === 'owner-left' && project.repo && <Button size="sm" variant="ghost" icon={FileText} onClick={onHandover}>Handover pack</Button>}
          </div>
        </div>
      )}

      {flag.kind === 'owner-leaving' && (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-text-muted">Write the handover pack while they are still here, then pick the next owner.</p>
          <div className="flex flex-wrap gap-2">
            {editable && <MemberPicker
              value={project.ownerId}
              emptyLabel="No owner"
              suggestion={suggestion}
              canAssignSuggestion={canAssignSuggestion}
              inviteOnAssign={{ projectId: project.id, appName: project.name }}
              onChange={onOwnerChange}
              trigger={<Button size="sm" variant="secondary">{owner ? 'Change owner' : 'Pick owner'}</Button>}
            />}
            {project.repo && <Button size="sm" variant="ghost" icon={FileText} onClick={onHandover}>Handover pack</Button>}
          </div>
        </div>
      )}

      {flag.kind === 'secrets' && project.signals && project.repo && (
        <div className="mt-3 space-y-2">
          <ul className="space-y-1 font-mono text-xs text-text">
            {project.signals.secretFiles.map((file) => {
              const href = repoFileUrl(project.repo!.url, project.repo!.defaultBranch, file)
              return <li key={file} className="break-all">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring rounded-sm text-accent hover:underline">{file}</a> : file}</li>
            })}
          </ul>
          {secretCommitUrl(project.signals.secretFiles, commits) && (
            <a href={secretCommitUrl(project.signals.secretFiles, commits)!} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-accent hover:underline">
              <GitCommit className="size-3.5" aria-hidden /> Open commit <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          <p className="text-xs leading-5 text-text-muted">{secretFixText(project.signals.secretFiles)}</p>
          {editable && <Button size="sm" variant="secondary" icon={RefreshCw} loading={syncing} onClick={onSync}>Sync now</Button>}
        </div>
      )}

      {flag.kind === 'public-repo' && project.repo && (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-text-muted">{publicRepoFixText()}</p>
          <div className="flex flex-wrap items-center gap-2">
            {githubSettingsUrl(project.repo.fullName) && (
              <a href={githubSettingsUrl(project.repo.fullName)!} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-accent hover:underline">
                Open GitHub settings <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
            {editable && <Button size="sm" variant="secondary" icon={RefreshCw} loading={syncing} onClick={onSync}>Sync now</Button>}
          </div>
        </div>
      )}

      {flag.kind === 'stale' && (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-text-muted">{staleFixText()}</p>
          {editable && <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => updateProject(project.id, { keptAt: new Date().toISOString() })}>Keep</Button>
            <Button size="sm" variant="danger" icon={Archive} onClick={archive}>Archive</Button>
          </div>}
        </div>
      )}

      {flag.kind === 'no-readme' && draft && (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-text-muted">{draft.source === 'ai' ? 'Suggestion from the app card and repo facts. Check it before adding it.' : 'Facts-only outline from the repo. Fill in anything the repo does not say.'}</p>
          {!showReadme ? (
            <Button size="sm" variant="secondary" onClick={() => setShowReadme(true)}>Draft a README</Button>
          ) : (
            <>
              <pre className="focus-ring max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 font-mono text-xs leading-5 text-text" tabIndex={0}>{draft.markdown}</pre>
              <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copyReadme()}>Copy draft</Button>
            </>
          )}
        </div>
      )}

      {flag.kind === 'no-repo' && (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-text-muted">{noRepoFixText()}</p>
        </div>
      )}
    </li>
  )
}
