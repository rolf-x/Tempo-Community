// Per-app page (#/p/<id>/app): card, owner, repo health, tasks from Claude, next steps and activity.
import { WhereItLives } from '../components/app/WhereItLives'
import { canEditApp, canManagePeople, readOnlyAppMessage } from '../lib/permissions'
import { appLink } from '../lib/directory'
import { isPersonal } from '../lib/model'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, CircleDot, FileText, ExternalLink, GitCommit, GitPullRequest, Lock, Globe, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react'
import type { ActivityKind, RepoRef } from '../types'
import { useStore } from '../store/useStore'
import { isSampleRepo, type SyncOutcome } from '../ai/router'
import { syncAppNow } from '../data/appSyncNow'
import { health, type HealthFlag } from '../ai/tools/health'
import { commitShareWindowStart, suggestOwnerByCommitShare, type CommitIdentity } from '../ai/tools/matchMember'
import { fetchRepoWork } from '../data/github'
import { useSession } from '../data/session'
import { workspaceAI } from '../ai/workspaceAI'
import { plain } from '../ai/tools/applySync'
import { redraftFactCards } from '../ai/redraft'
import { useRedraftState } from '../ai/redraftState'
import { feedRowTitle, groupRepeats } from '../lib/activityFeed'
import { isAICardOutOfDate } from '../lib/cardFreshness'
import { mcpEnabled } from '../lib/aiMode'
import { useUI } from '../components/uiState'
import { changeProjectOwner } from '../data/workspace'
import { MemberAvatar } from '../components/people/MemberAvatar'
import { MemberPicker } from '../components/people/MemberPicker'
import { shouldShowOwnerSuggestion } from '../components/people/ownerSuggestion'
import { OutOfDateChip, StageBadge, timeAgo } from '../components/app/AppBadges'
import { AppTasks } from '../components/app/AppTasks'
import { ConnectRepo } from '../components/app/ConnectRepo'
import { FlagFix } from '../components/app/FlagFix'
import { HandoverModal } from '../components/app/HandoverModal'
import { SyncPreview } from '../components/app/SyncPreview'
import { AppIcon, Button, Card, EmptyState, Page, SectionHeader, Skeleton } from '../components/ui'
import { useGitHubGate } from '../components/ConnectGitHubDialog'

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  commit: GitCommit,
  pr: GitPullRequest,
  issue: CircleDot,
  sync: RefreshCw,
}
const FEED_PAGE = 30
type RepoCommit = CommitIdentity & { message?: string; url?: string }
type WorkItem = { number: number; title: string; url: string; createdAt?: string }

export function repoWorkDependencyKey({ projectId, fullName, token }: { projectId?: string; fullName?: string; token: string | null }): string {
  return JSON.stringify([projectId ?? null, fullName ?? null, token])
}

export const newest = <T extends WorkItem>(items: T[]) => [...items].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 8)

function WorkRows({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: WorkItem[] }) {
  if (!items.length) return null
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium text-text-muted">{title}</h3>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.url}>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="focus-ring flex min-w-0 items-start gap-2 rounded-sm py-2 text-sm hover:text-accent">
              <Icon className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
              <span className="min-w-0 flex-1 text-text">{item.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-text-muted">#{item.number}{item.createdAt ? ` · ${timeAgo(item.createdAt)}` : ''}</span>
              <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function NextSteps({ repo, cardStatus, work, loading }: { repo: RepoRef | null; cardStatus: string | null; work: { issues: WorkItem[]; pulls: WorkItem[] }; loading: boolean }) {
  const empty = !work.issues.length && !work.pulls.length
  return (
    <section aria-label="Next steps">
      <SectionHeader title="Next steps" />
      <Card className="space-y-4">
        {!repo ? (
          <p className="text-sm text-text-muted">Link a repo to see next steps.</p>
        ) : (
          <>
            {cardStatus && <div><h3 className="text-xs font-medium text-text-muted">Recommendation</h3><p className="mt-1 text-sm leading-6 text-text">{plain(cardStatus)}</p></div>}
            {loading && empty ? <div aria-label="Loading next steps" className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div> : (
              <>
                <WorkRows title="Open issues" icon={CircleDot} items={work.issues} />
                <WorkRows title="Open pull requests" icon={GitPullRequest} items={work.pulls} />
                {empty && <p className="text-sm text-text-muted">No open issues or pull requests.</p>}
              </>
            )}
          </>
        )}
      </Card>
    </section>
  )
}

export const needsRepoCommits = (flags: HealthFlag[]) => flags.some((flag) => flag.kind === 'no-owner' || flag.kind === 'owner-left' || flag.kind === 'owner-leaving' || flag.kind === 'secrets')

export { shouldShowOwnerSuggestion }

function sourceLine(source: 'ai' | 'fallback' | 'demo', at: string): string {
  const label = source === 'ai' ? 'Written by AI from the repo' : source === 'fallback' ? 'Written from repo data' : 'Sample'
  return `${label} · updated ${timeAgo(at)}`
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-base leading-6 text-text">{children}</dd>
    </div>
  )
}

function FlagCount({ count }: { count: number }) {
  const reducedMotion = useReducedMotion()
  const previous = useRef(count)
  const [drop, setDrop] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    const from = previous.current
    previous.current = count
    if (count >= from || reducedMotion) {
      setDrop(null)
      return
    }
    setDrop({ from, to: count })
    const timer = window.setTimeout(() => setDrop(null), 1600)
    return () => window.clearTimeout(timer)
  }, [count, reducedMotion])

  return (
    <p className="text-sm font-medium text-text tabular-nums" aria-live="polite">
      Need a look:{' '}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={drop ? `${drop.from}-${drop.to}` : count}
          initial={reducedMotion ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
        >
          {drop ? `${drop.from} → ${drop.to}` : count}
        </motion.span>
      </AnimatePresence>
    </p>
  )
}

export default function AppView({ projectId }: { projectId: string }) {
  const hydrated = useStore((s) => s.hydrated)
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const members = useStore((s) => s.members)
  const allActivity = useStore((s) => s.activity)
  const updateProject = useStore((s) => s.updateProject)
  const settings = useStore((s) => s.settings)
  const githubToken = useSession((s) => s.githubToken)
  const writingCard = useRedraftState((s) => s.writingIds.has(projectId))
  const { requireGitHub } = useGitHubGate()

  const [syncing, setSyncing] = useState(false)
  const [addingTasks, setAddingTasks] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [shown, setShown] = useState(FEED_PAGE)
  const [repoCommits, setRepoCommits] = useState<RepoCommit[]>([])
  const [repoWork, setRepoWork] = useState<{ issues: WorkItem[]; pulls: WorkItem[] }>({ issues: [], pulls: [] })
  const [workLoading, setWorkLoading] = useState(false)
  const ownerPickerTrigger = useRef<HTMLButtonElement>(null)

  const feed = useMemo(
    () => allActivity.filter((a) => a.projectId === projectId).sort((a, b) => b.at.localeCompare(a.at)),
    [allActivity, projectId],
  )
  const feedRows = useMemo(() => groupRepeats(feed), [feed])
  const personal = useStore((s) => isPersonal(s.workspace))
  const workspace = useStore((s) => s.workspace)
  const me = useStore((s) => s.members.find((m) => m.id === s.meId) ?? null)
  const flags = useMemo(() => (project ? health(project, members, undefined, { personal, keptAt: project.keptAt }) : []), [project, members, personal])
  const flagKinds = useMemo(() => new Set(flags.map((flag) => flag.kind)), [flags])
  const needsOwner = flags.some((flag) => flag.kind === 'no-owner' || flag.kind === 'owner-left')
  const owner = useMemo(() => members.find((m) => m.id === project?.ownerId) ?? null, [members, project?.ownerId])
  const canEdit = !workspace || !!project && canEditApp(me, project)
  const canManage = !workspace || canManagePeople(me)
  const needsCommits = needsRepoCommits(flags) || !!owner && !owner.userId || canManage
  const ownerNeedsPick = !owner?.active || needsOwner
  const commitActivity = useMemo(() => feed.filter((item) => item.kind === 'commit').map((item) => ({ author: item.actor, date: item.at })), [feed])
  const commitEvidence = useMemo(
    () => needsCommits && repoCommits.some((commit) => commit.message)
      ? repoCommits.map((commit) => ({ title: commit.message ?? '', url: commit.url ?? null }))
      : feed.filter((item) => item.kind === 'commit').map((item) => ({ title: item.title, url: item.url })),
    [needsCommits, repoCommits, feed],
  )
  const suggestionStart = useMemo(() => commitShareWindowStart(new Date()), [])
  const ownerSuggestion = useMemo(
    () => suggestOwnerByCommitShare(needsCommits && repoCommits.length ? repoCommits : commitActivity, members, suggestionStart),
    [needsCommits, repoCommits, commitActivity, members, suggestionStart],
  )
  const shownOwnerSuggestion = canManage && shouldShowOwnerSuggestion(owner, ownerSuggestion, members) ? ownerSuggestion : null
  const provider = workspaceAI(settings).provider
  // With Claude (MCP) on, a card Claude drafted is AI text the README suggestion can use, even with no key.
  const aiConnected = provider !== 'none' || mcpEnabled()
  const canDraftCard = provider !== 'none' && provider !== 'demo'
  const cardOutOfDate = project ? isAICardOutOfDate(project) : false
  const sample = !!project && isSampleRepo(project)
  const sampleWork = useMemo(() => {
    const work = feed.filter((item) => item.url && (item.kind === 'issue' || item.kind === 'pr'))
    return {
      issues: newest(work.filter((item) => item.kind === 'issue').map((item) => ({ number: Number(item.url!.split('/').pop()), title: item.title, url: item.url!, createdAt: item.at }))),
      pulls: newest(work.filter((item) => item.kind === 'pr').map((item) => ({ number: Number(item.url!.split('/').pop()), title: item.title, url: item.url!, createdAt: item.at }))),
    }
  }, [feed])
  const repoWorkKey = repoWorkDependencyKey({ projectId: project?.id, fullName: project?.repo?.fullName, token: githubToken })
  useEffect(() => {
    setRepoCommits([])
    setRepoWork({ issues: [], pulls: [] })
  }, [project?.id, project?.repo?.fullName])
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    setWorkLoading(false)
    if (!project?.repo || sample || !githubToken) return
    setWorkLoading(true)
    void fetchRepoWork(githubToken, project.repo.fullName, { signal: controller.signal })
      .then((work) => {
        if (!current) return
        setRepoCommits(work.commits)
        setRepoWork({ issues: newest(work.issues), pulls: newest(work.pulls) })
      })
      .catch(() => { /* The picker still works without a suggestion. Sync surfaces GitHub errors. */ })
      .finally(() => { if (current) setWorkLoading(false) })
    return () => { current = false; controller.abort() }
  }, [repoWorkKey])

  const sync = useCallback(async () => {
    if (!canEdit) return
    setSyncing(true)
    setSyncError(null)
    try {
      await syncAppNow(projectId, {
        run: requireGitHub,
        onFacts: (out) => {
          setRepoWork({ issues: newest(out.facts.issues), pulls: newest(out.facts.pulls) })
          setRepoCommits(out.facts.commits)
        },
        onReview: (out) => {
          setOutcome(out)
          setPreviewOpen(true)
        },
        onAddingTasks: setAddingTasks,
      })
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Couldn't sync this app.")
    } finally {
      setSyncing(false)
    }
  }, [canEdit, projectId, requireGitHub])

  const draftCard = useCallback(() => {
    if (!canEdit) return
    void redraftFactCards({ projectIds: [projectId], concurrency: 1 }).then((events) => {
      if (events.some((event) => event.type === 'failed')) {
        useUI.getState().notify("Tempo couldn't write this card. Its facts are still here. Draft again.", 'danger')
      }
    })
  }, [canDraftCard, canEdit, projectId])

  const openOwnerPicker = useCallback(() => {
    ownerPickerTrigger.current?.focus()
    ownerPickerTrigger.current?.click()
  }, [])

  // Remove = mark removed (the database stamps the time and keeps it, so Claude doesn't add the same task again), which
  // Undo can take back at any time. Read the list when the button is pressed, so a task an agent added meanwhile stays.
  const setTaskRemoved = useCallback((taskId: string, removed: boolean) => {
    const tasks = useStore.getState().projects.find((p) => p.id === projectId)?.tasks
    if (!tasks?.some((task) => task.id === taskId)) return
    useStore.getState().updateProject(projectId, {
      tasks: tasks.map((task) => (task.id === taskId ? { ...task, removedAt: removed ? task.removedAt ?? new Date().toISOString() : null } : task)),
    })
  }, [projectId])
  const removeTask = useCallback((taskId: string) => {
    if (!canEdit) return
    const removed = useStore.getState().projects.find((p) => p.id === projectId)?.tasks?.find((task) => task.id === taskId)
    if (!removed) return
    setTaskRemoved(taskId, true)
    useStore.getState().setUndo({ label: `Removed task “${plain(removed.title)}”`, restore: () => setTaskRemoved(taskId, false) })
  }, [canEdit, projectId, setTaskRemoved])

  const changeOwner = useCallback(async (ownerId: string | null) => {
    await changeProjectOwner(projectId, ownerId).catch((error) => {
      useUI.getState().notify(error instanceof Error ? error.message : 'The owner changed, but Tempo could not revoke the old invite.', 'danger')
    })
  }, [projectId])

  if (!hydrated) return <Page width="wide"><Skeleton className="h-48 w-full" /></Page>
  if (!project) return <Page width="wide"><EmptyState icon={Sparkles} title="App not found" body="It may have been deleted." /></Page>

  const { repo, signals, appCard } = project
  // Without a repo the top panel already asks for one, so Health leaves out the no-repo flag.
  const railFlags = repo ? flags : flags.filter((flag) => flag.kind !== 'no-repo')
  const link = appLink(project)
  const renderHealth = (ariaLabel: string, className: string) => railFlags.length > 0 && (
    <section aria-label={ariaLabel} className={className}>
      <SectionHeader title="Health" />
      <Card className="space-y-3">
        <FlagCount count={railFlags.length} />
        <ul className="space-y-2">
          {railFlags.map((flag) => (
            <FlagFix
              key={flag.kind}
              flag={flag}
              project={project}
              suggestion={shownOwnerSuggestion}
              editable={canEdit}
              canAssignSuggestion={canManage}
              commits={commitEvidence}
              aiConnected={aiConnected}
              syncing={syncing}
              onSync={() => void sync()}
              onOwnerChange={changeOwner}
              onPickOwner={openOwnerPicker}
              onHandover={() => setHandoverOpen(true)}
            />
          ))}
        </ul>
        <p className="text-xs text-text-muted">Signals from repo data, not a security audit.</p>
      </Card>
    </section>
  )
  return (
    <Page width="wide">
      {!canEdit && (
        <p className="mb-4 text-sm text-text-muted">
          {readOnlyAppMessage(owner)}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {!repo ? (
            <Card>
              <EmptyState
                compact
                icon={Sparkles}
                title="Connect a repo and Tempo writes this card"
                action={canEdit ? <Button variant="secondary" onClick={() => setConnectOpen(true)}>Connect repo</Button> : undefined}
              />
            </Card>
          ) : <Card>
            {appCard ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <AppIcon name={project.name} color={project.color} size="lg" />
                  <h2 className="text-lg font-semibold text-text">{project.name}</h2>
                  <StageBadge stage={appCard.stage} />
                </div>
                <dl className="mt-4 space-y-3">
                  <Field label="What it is">{plain(appCard.what)}</Field>
                  <Field label="Who it's for">{appCard.who}</Field>
                  <Field label="Status">{appCard.status}</Field>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="text-xs text-text-muted">{sourceLine(appCard.source, appCard.updatedAt)}</p>
                  {cardOutOfDate && canDraftCard && canEdit && <OutOfDateChip writing={writingCard} onClick={draftCard} />}
                  {cardOutOfDate && provider === 'none' && <OutOfDateChip variant="no-ai" />}
                  {appCard.source === 'fallback' && canDraftCard && canEdit && (
                    <Button variant="secondary" size="sm" loading={writingCard} onClick={draftCard}>
                      {writingCard ? 'Writing…' : 'Draft again'}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <AppIcon name={project.name} color={project.color} size="lg" />
                  <h2 className="text-lg font-semibold text-text">{project.name}</h2>
                </div>
                <EmptyState
                  compact
                  icon={Sparkles}
                  title="No app card yet"
                  body="Sync to read the repo and write what this app is, who it is for and where it stands."
                  action={canEdit ? <Button variant="secondary" icon={RefreshCw} loading={syncing} onClick={sync}>Sync now</Button> : undefined}
                />
              </>
            )}
          </Card>}

          {renderHealth('Health', 'lg:hidden')}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
                >
                  Open app <ArrowUpRight className="size-4" aria-hidden />
                </a>
              )}
              {repo && <Button icon={FileText} onClick={() => setHandoverOpen(true)}>Handover pack</Button>}
            </div>
          </div>

          <AppTasks tasks={project.tasks} flagKinds={flagKinds} canEdit={canEdit} onRemove={removeTask} />

          <NextSteps repo={repo} cardStatus={appCard?.source === 'ai' ? appCard.status : null} work={sample ? sampleWork : repoWork} loading={workLoading} />

          <section aria-label="Activity">
            <SectionHeader title="Activity" count={feedRows.length} />
            {feed.length === 0 ? (
              <Card bare><EmptyState compact icon={RefreshCw} title="No activity yet" body="Commits, pull requests and issues show up here after a sync." /></Card>
            ) : (
              <>
                <ul className="space-y-1">
                  {feedRows.slice(0, shown).map((row) => {
                    const a = row.item
                    const title = feedRowTitle(row)
                    const Icon = KIND_ICON[a.kind]
                    return (
                      <li key={a.id} className="flex min-h-10 items-start gap-3 rounded-md px-3 py-2 hover:bg-surface-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text">{title}</p>
                          <p className="text-xs text-text-muted">
                            {a.actor} · {timeAgo(a.at)}
                          </p>
                        </div>
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`Open: ${title}`} className="focus-ring mt-0.5 shrink-0 rounded-sm text-text-muted hover:text-text">
                            <ExternalLink className="size-3.5" aria-hidden />
                          </a>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {feedRows.length > shown && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShown((n) => n + FEED_PAGE)}>
                    Show more
                  </Button>
                )}
              </>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6" aria-label="App details">
          {renderHealth('Health details', 'hidden lg:block')}

          <section aria-label="Owner">
            <SectionHeader title="Owner" />
            <Card className={ownerNeedsPick ? 'flex items-center gap-2' : 'p-2'}>
              {ownerNeedsPick && (
                <>
                  <MemberAvatar id={project.ownerId} showEmpty size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{owner ? `${owner.name} · left` : 'No owner'}</span>
                </>
              )}
              {canEdit ? <MemberPicker
                value={project.ownerId}
                emptyLabel="No owner"
                align={ownerNeedsPick ? 'end' : 'start'}
                suggestion={shownOwnerSuggestion}
                canAssignSuggestion={canManage}
                inviteOnAssign={{ projectId, appName: project.name }}
                onChange={changeOwner}
                trigger={ownerNeedsPick ? (
                  <Button ref={ownerPickerTrigger} size="sm">Pick owner</Button>
                ) : (
                  <button ref={ownerPickerTrigger} type="button" className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-surface-2">
                    <MemberAvatar id={project.ownerId} showEmpty size="sm" />
                    <span className="min-w-0 flex-1 truncate">{owner?.name}</span>
                  </button>
                )}
              /> : !ownerNeedsPick ? (
                <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text">
                  <MemberAvatar id={project.ownerId} showEmpty size="sm" />
                  <span className="min-w-0 flex-1 truncate">{owner?.name}</span>
                </div>
              ) : null}
            </Card>
          </section>

          {repo && <section aria-label="Repo">
            <SectionHeader title="Repo" />
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <a href={repo.url} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex min-w-0 items-center gap-1 rounded-sm text-sm font-medium text-accent hover:underline">
                  <span className="truncate">{repo.fullName}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
                <span className="inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-2 text-xs font-medium text-text-muted">
                  {repo.private ? <Lock className="size-3" aria-hidden /> : <Globe className="size-3" aria-hidden />}
                  {repo.private ? 'Private' : 'Public'}
                </span>
              </div>
              {signals ? (
                <p className="text-xs leading-5 text-text-muted tabular-nums">
                  {signals.openPrs} open PR{signals.openPrs === 1 ? '' : 's'} · {signals.openIssues} open issue{signals.openIssues === 1 ? '' : 's'}
                  <br />
                  Last commit {timeAgo(signals.lastCommitAt)}
                </p>
              ) : (
                <p className="text-xs text-text-muted">Not synced yet.</p>
              )}
            </Card>
          </section>}

          {repo && canEdit && <section aria-label="Sync">
            <SectionHeader title="Sync" />
            <Card className="space-y-3">
              <Button variant="primary" block icon={RefreshCw} loading={syncing} onClick={sync}>
                {syncing ? (addingTasks ? 'Adding tasks…' : 'Syncing…') : 'Sync now'}
              </Button>
              {syncError && (
                <div className="space-y-1.5" role="alert">
                  <p className="text-sm text-danger">{syncError}</p>
                  <Button size="sm" onClick={sync}>Try again</Button>
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={project.autoApply}
                  onChange={(e) => updateProject(projectId, { autoApply: e.target.checked })}
                  className="focus-ring mt-0.5 size-4 accent-[var(--color-accent)]"
                />
                <span>
                  Auto-apply updates
                  <span className="block text-xs text-text-muted">Skip the review and save each refreshed card.</span>
                </span>
              </label>
            </Card>
          </section>}

          <WhereItLives project={project} editable={canEdit} />
        </aside>
      </div>

      <HandoverModal open={handoverOpen} onClose={() => setHandoverOpen(false)} projectId={projectId} appName={project.name} />
      <SyncPreview open={previewOpen} onClose={() => setPreviewOpen(false)} project={project} outcome={outcome} editable={canEdit} />
      {canEdit && <ConnectRepo open={connectOpen} onClose={() => setConnectOpen(false)} projectId={projectId} onConnected={() => void sync()} />}
    </Page>
  )
}
