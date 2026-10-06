// Link a GitHub repo to this app. Needs a GitHub token; lists the user's repos and runs a sync once one is picked.
import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Lock, Search } from 'lucide-react'
import type { RepoRef } from '../../types'
import { useStore } from '../../store/useStore'
import { useSession } from '../../data/session'
import { GitHubError, listRepos, type RepoListItem } from '../../data/github'
import { Button, EmptyState, Input, Modal, SkeletonRow, cn } from '../ui'
import { timeAgo } from './AppBadges'
import { ReconnectGitHub } from '../ReconnectGitHub'

export interface ConnectRepoProps {
  open: boolean
  onClose: () => void
  projectId: string
  /** Called after the repo is linked, so the page can run the first sync. */
  onConnected: () => void
}

export function ConnectRepo({ open, onClose, projectId, onConnected }: ConnectRepoProps) {
  const token = useSession((s) => s.githubToken)
  const status = useSession((s) => s.status)
  const sessionError = useSession((s) => s.error)
  const projects = useStore((s) => s.projects)
  const updateProject = useStore((s) => s.updateProject)

  const [repos, setRepos] = useState<RepoListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || !token) return
    let live = true
    setRepos(null)
    setError(null)
    listRepos(token).then(
      (r) => live && setRepos(r),
      (e) => live && setError(e instanceof GitHubError || e instanceof Error ? e.message : "Couldn't load your repos."),
    )
    return () => {
      live = false
    }
  }, [open, token, attempt])

  const linked = useMemo(() => new Set(projects.filter((p) => p.id !== projectId && p.repo).map((p) => p.repo!.fullName)), [projects, projectId])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (repos ?? []).filter((r) => !needle || r.fullName.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(needle))
  }, [repos, q])

  const pick = (r: RepoListItem) => {
    const repo: RepoRef = { fullName: r.fullName, url: r.url, private: r.private, defaultBranch: r.defaultBranch }
    updateProject(projectId, { repo })
    onClose()
    onConnected()
  }

  return (
    <Modal open={open} onClose={onClose} size="md" title="Connect a repo" description="Tempo reads the repo to write the app card and find health signals. It never writes to GitHub.">
      {!token ? (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">Connecting a repo needs a GitHub sign-in.</p>
          {(status === 'off' || sessionError) && sessionError && <p className="text-sm text-danger" role="alert">{sessionError}</p>}
          {status === 'off' && !sessionError && <p className="text-sm text-text-muted">Sign-in is not set up on this deployment.</p>}
          <ReconnectGitHub variant="primary" icon={GitBranch} label="Sign in with GitHub" />
        </div>
      ) : (
        <div>
          <Input icon={Search} size="sm" autoFocus placeholder="Search repos…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search repos" />
          <div className="mt-2 max-h-80 overflow-y-auto">
            {error ? (
              <div className="space-y-2 py-4">
                <p className="text-sm text-danger" role="alert">{error}</p>
                <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
              </div>
            ) : repos === null ? (
              <div aria-busy="true">
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : shown.length === 0 ? (
              <EmptyState compact icon={GitBranch} title={q ? 'No repos match' : 'No repos found'} body={q ? 'Try a different name.' : 'This GitHub account has no repos Tempo can read.'} />
            ) : (
              <ul className="space-y-1">
                {shown.map((r) => {
                  const taken = linked.has(r.fullName)
                  return (
                    <li key={r.fullName}>
                      <button
                        type="button"
                        disabled={taken}
                        onClick={() => pick(r)}
                        className={cn('focus-ring w-full rounded-md px-3 py-2 text-left hover:bg-surface-2', taken && 'cursor-not-allowed opacity-50 hover:bg-transparent')}
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{r.fullName}</span>
                          {taken && <span className="text-xs text-text-muted">Already linked</span>}
                          {r.private && (
                            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-2 text-xs font-medium text-text-muted">
                              <Lock className="size-3" aria-hidden /> Private
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                          <span className="min-w-0 flex-1 truncate">{r.description ?? 'No description'}</span>
                          <span className="shrink-0">Pushed {timeAgo(r.pushedAt)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
