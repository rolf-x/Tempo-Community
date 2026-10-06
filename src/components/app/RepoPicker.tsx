// Find app-like repos from GitHub facts, then use the existing create-and-sync flow.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleAlert, GitBranch, Lock, Search } from 'lucide-react'
import type { RepoRef } from '../../types'
import { useStore } from '../../store/useStore'
import { useSession } from '../../data/session'
import { knownAIApps, useAIApps } from '../../data/aiApps'
import { guideScope, useGuideState } from '../guide/guideState'
import { aiMode, mcpEnabled } from '../../lib/aiMode'
import { aiAppName, connectLabel } from '../../lib/mcpSetup'
import { ReconnectGitHub } from '../ReconnectGitHub'
import { GitHubAppInstallActions, GitHubOrgApproval } from '../GitHubOrgApproval'
import { GitHubError, githubResetTime, waitForGitHubReset, inferWorkspaceRepoScope, listRepos, readRepoRoot, repoCanBePreselected, setupRepoScope, type RepoListItem, type RepoReadOptions } from '../../data/github'
import { setWorkspaceGitHubOrg } from '../../data/workspace'
import { requestAutoLink } from '../../data/githubLink'
import { aiSyncApp } from '../../ai/router'
import { appNameFromRepo, classifyRepo, reposToAdd, type RepoClassification } from '../../lib/repoApps'
import { navigate } from '../../lib/router'
import { Button, EmptyState, Input, Modal, SkeletonRow, Spinner, cn } from '../ui'
import { openAIPanel, openConnectAI, useUI } from '../uiState'
import { workspaceAI } from '../../ai/workspaceAI'
import { timeAgo } from './AppBadges'
import { githubAppMode } from '../../lib/githubApp'
import { finishVisibleRefresh, listenForVisibleRefresh, markVisibleRefreshStarted, visibleRefreshState } from '../../lib/visibleRefresh'

type RowState = 'queued' | 'syncing' | 'done' | 'failed' | 'later'
type CachedRepo = { fingerprint: string; result: RepoClassification; selected: boolean }
type ScanCache = Record<string, CachedRepo>

// Keep progress across a closed tab, scoped to the signed-in account and workspace.
// Store only classifications and choices, never the token or package contents.
function readCache(key: string | null): ScanCache {
  if (!key) return {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, item]) =>
      item && typeof item.fingerprint === 'string' && typeof item.selected === 'boolean'
      && typeof item.result?.isApp === 'boolean' && typeof item.result?.reason === 'string',
    ))
  } catch { return {} }
}

function writeCache(key: string | null, cache: ScanCache) {
  if (!key) return
  try { localStorage.setItem(key, JSON.stringify(cache)) } catch { /* Reading still works without storage. */ }
}

function fingerprint(repo: RepoListItem) {
  return JSON.stringify([repo.pushedAt, repo.defaultBranch, repo.fork, repo.archived, repo.is_template, repo.size, repo.homepage])
}

function waitForTick(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 250)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** All rows already exist; a long rate limit defers their sync without treating them as failed adds. */
export async function syncAddedRepos(created: { name: string; id: string }[], options: RepoReadOptions, onProgress: (rows: Map<string, RowState>) => void) {
  const rows = new Map<string, RowState>(created.map((c) => [c.name, 'queued']))
  for (const [index, c] of created.entries()) {
    rows.set(c.name, 'syncing')
    onProgress(new Map(rows))
    try {
      const out = await aiSyncApp(c.id, options)
      useStore.getState().commitSync(c.id, { card: out.card, signals: out.signals, source: out.source })
      rows.set(c.name, 'done')
    } catch (error) {
      if (error instanceof GitHubError && error.kind === 'rate-limit') {
        for (const pending of created.slice(index)) rows.set(pending.name, 'later')
        onProgress(new Map(rows))
        return { rows, error }
      }
      rows.set(c.name, 'failed')
    }
    onProgress(new Map(rows))
  }
  return { rows, error: null }
}

/**
 * What the end of the scan says about AI (mcp and both modes: Claude is on; `keyed`: a key writes the cards itself).
 * `aiApps`: how many AI apps are connected, or null while the list is still being read.
 *  - aiConnected   an AI is already at work (or about to be), so no "Cards show facts only" line.
 *  - claudeNext    first visit: the scan's button reads "Next" and opens "Let Claude write your cards", once. Never with a
 *                  key (the cards are already written; Claude is optional, for the tasks) and never in the sample.
 *  - claudeCanDraft  Claude is connected, no key wrote the cards: "Ask Claude to draft them".
 */
export function scanAI(input: { mcp: boolean; keyed: boolean; sample: boolean; signedIn: boolean; aiApps: number | null; claudeStepShown: boolean }) {
  const { mcp, keyed, sample, signedIn, aiApps, claudeStepShown } = input
  const aiConnected = sample || keyed || (mcp && (aiApps === null || aiApps > 0))
  const claudeNext = mcp && !keyed && !sample && signedIn && !claudeStepShown
  const claudeCanDraft = mcp && !keyed && !sample && !claudeNext && !!aiApps
  return { aiConnected, claudeNext, claudeCanDraft }
}

export function RepoPicker() {
  const open = useUI((s) => s.repoPickerOpen)
  const setOpen = useUI((s) => s.setRepoPickerOpen)
  const token = useSession((s) => s.githubToken)
  const userId = useSession((s) => s.user?.id)
  const projects = useStore((s) => s.projects)
  const workspaceId = useStore((s) => s.workspace?.id)
  const cacheKey = userId ? `tempo:repo-scan:v1:${userId}:${workspaceId ?? 'personal'}` : null
  const cache = useRef<ScanCache>({})
  const checkRest = useRef<() => void>(() => {})
  const stopReading = useRef<() => void>(() => {})
  const adding = useRef(false)
  const repoRefresh = useRef(visibleRefreshState())

  const [repos, setRepos] = useState<RepoListItem[] | null>(null)
  const [results, setResults] = useState<Map<string, RepoClassification>>(new Map())
  const [readErrors, setReadErrors] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Map<string, RowState> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [listing, setListing] = useState(false)
  const [reading, setReading] = useState(false)
  const [allRequested, setAllRequested] = useState(false)
  const [notAppsOpen, setNotAppsOpen] = useState<boolean | null>(null)
  const [pauseUntil, setPauseUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [deferredReason, setDeferredReason] = useState<string | null>(null)
  const [resumed, setResumed] = useState(0)

  useEffect(() => {
    if (!open) return
    setProgress(null)
    setDeferredReason(null)
    adding.current = false
    setQ('')
  }, [open])

  useEffect(() => {
    if (!open || !token) return
    const request = markVisibleRefreshStarted(repoRefresh.current)
    const controller = new AbortController()
    const { signal } = controller
    stopReading.current = () => controller.abort()
    cache.current = readCache(cacheKey)
    setRepos(null)
    setResults(new Map())
    setReadErrors(new Map())
    setPicked(new Set())
    setError(null)
    setAuthError(false)
    setListing(true)
    setReading(false)
    setAllRequested(false)
    setNotAppsOpen(null)
    setPauseUntil(0)
    setResumed(0)
    const { workspace, members, meId } = useStore.getState()
    const scope = setupRepoScope()
    const me = members.find((member) => member.id === meId)
    const pickerScope = scope ?? inferWorkspaceRepoScope(useStore.getState().projects.map((project) => project.repo), me?.githubLogin)
    if (workspace?.kind === 'org' && !workspace.githubOrg && scope?.kind === 'org' && (me?.role === 'owner' || me?.isAdmin)) {
      void setWorkspaceGitHubOrg(scope.login).catch((e: unknown) => {
        if (!signal.aborted) setError(e instanceof Error ? e.message : "Tempo couldn't share this workspace's GitHub organisation.")
      })
    }
    let available: RepoListItem[] = []
    let limit = 30
    let active = 0
    let blockedUntil = 0
    const scheduled = new Set<string>()
    const gate = async () => {
      while (Date.now() < blockedUntil) await waitForTick(signal)
      signal.throwIfAborted()
      setPauseUntil(0)
    }
    const options: RepoReadOptions = {
      signal,
      beforeRequest: gate,
      onRateLimit: async (e) => {
        blockedUntil = Math.max(blockedUntil, e.resetAt ?? Date.now() + 60_000)
        setNow(Date.now())
        setPauseUntil(blockedUntil)
        await gate()
      },
    }
    const record = (repo: RepoListItem, result: RepoClassification, selected: boolean) => {
      cache.current[repo.fullName] = { fingerprint: fingerprint(repo), result, selected }
      writeCache(cacheKey, cache.current)
      setResults((prev) => new Map(prev).set(repo.fullName, result))
      // Suggestions stay inside the workspace org. Old workspaces may infer it from already-tracked repos.
      const { workspace, projects } = useStore.getState()
      if (selected && repoCanBePreselected(repo.fullName, workspace?.kind, pickerScope)
        && !projects.some((p) => p.repo?.fullName.toLowerCase() === repo.fullName.toLowerCase())) {
        setPicked((prev) => new Set(prev).add(repo.fullName))
      }
    }
    const pump = () => {
      if (signal.aborted) return
      for (const repo of available.slice(0, limit)) {
        if (scheduled.has(repo.fullName)) continue
        if (active >= 6) break
        scheduled.add(repo.fullName)
        const saved = cache.current[repo.fullName]
        if (saved?.fingerprint === fingerprint(repo)) {
          record(repo, saved.result, saved.selected)
          setResumed((n) => n + 1)
          continue
        }
        const initial = classifyRepo(repo)
        if (initial.reason !== 'No deploy file or start script') {
          record(repo, initial, initial.isApp)
          continue
        }
        active++
        void readRepoRoot(token, repo.fullName, options).then((root) => {
          if (signal.aborted) return
          const result = classifyRepo(repo, root)
          record(repo, result, result.isApp)
        }).catch((e: unknown) => {
          if (signal.aborted) return
          setReadErrors((prev) => new Map(prev).set(repo.fullName, e instanceof Error ? e.message : "Couldn't read this repo."))
          if (e instanceof GitHubError && e.kind === 'auth') {
            setAuthError(true)
            controller.abort()
            setListing(false)
            setReading(false)
          }
        }).finally(() => {
          active--
          if (!signal.aborted) pump()
        })
      }
      setReading(active > 0)
    }
    checkRest.current = () => {
      limit = Infinity
      setAllRequested(true)
      pump()
    }
    void listRepos(token, {
      ...options,
      ...(pickerScope ? { scope: pickerScope } : {}),
      onPage: (page) => {
        if (signal.aborted) return
        available = page
        setRepos(page)
        pump()
      },
    }).catch((e: unknown) => {
      if (signal.aborted) return
      setError(e instanceof Error ? e.message : "Couldn't load your repos.")
      if (e instanceof GitHubError && e.kind === 'auth') {
        setAuthError(true)
        controller.abort()
        setReading(false)
        setListing(false)
      }
    }).finally(() => {
      finishVisibleRefresh(repoRefresh.current, request)
      if (!signal.aborted) setListing(false)
    })
    return () => { controller.abort(); finishVisibleRefresh(repoRefresh.current, request); checkRest.current = () => {} }
  }, [open, token, attempt, cacheKey])

  useEffect(() => {
    if (!open || !githubAppMode()) return
    return listenForVisibleRefresh(repoRefresh.current, () => setAttempt((value) => value + 1))
  }, [open])

  const refreshRepos = () => {
    markVisibleRefreshStarted(repoRefresh.current)
    setAttempt((value) => value + 1)
  }

  useEffect(() => {
    if (!open || !pauseUntil) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [open, pauseUntil])

  const linked = useMemo(() => new Set(projects.filter((p) => p.repo).map((p) => p.repo!.fullName.toLowerCase())), [projects])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (repos ?? []).filter((r) => !needle || r.fullName.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(needle))
  }, [repos, q])
  const apps = shown.filter((r) => results.get(r.fullName)?.isApp)
  const notApps = shown.filter((r) => results.get(r.fullName)?.isApp === false)
  const unread = shown.filter((r) => !results.has(r.fullName))
  const foundApps = [...results.values()].filter((r) => r.isApp).length
  const expanded = notAppsOpen ?? (!listing && !reading && foundApps === 0)
  const count = reposToAdd([...picked], projects).length
  const seconds = Math.max(0, Math.ceil((pauseUntil - now) / 1000))

  const toggle = (name: string) => {
    const selected = !picked.has(name)
    setPicked((prev) => { const next = new Set(prev); if (selected) next.add(name); else next.delete(name); return next })
    if (cache.current[name]) cache.current[name].selected = selected
    writeCache(cacheKey, cache.current)
  }
  const promote = (name: string) => {
    const result = { isApp: true, reason: 'Marked as app' }
    setResults((prev) => new Map(prev).set(name, result))
    setPicked((prev) => new Set(prev).add(name))
    if (cache.current[name]) cache.current[name] = { ...cache.current[name], result, selected: true }
    writeCache(cacheKey, cache.current)
  }

  const track = async () => {
    if (adding.current) return
    const store = useStore.getState()
    const names = reposToAdd([...picked], store.projects)
    if (!names.length) return
    adding.current = true
    stopReading.current()
    setPauseUntil(0)
    const byName = new Map((repos ?? []).map((r) => [r.fullName, r]))
    const rows = new Map<string, RowState>(names.map((n) => [n, 'queued']))
    setProgress(new Map(rows))
    const created = names.map((n) => {
      const r = byName.get(n)!
      const repo: RepoRef = { fullName: r.fullName, url: r.url, private: r.private, defaultBranch: r.defaultBranch }
      return { name: n, id: store.createProject({ name: appNameFromRepo(n), repo, ownerId: store.meId ?? null }).id }
    })
    const controller = new AbortController()
    let blockedUntil = 0
    let stopped: GitHubError | null = null
    const gate = async () => {
      if (stopped) throw stopped
      while (Date.now() < blockedUntil) await waitForTick(controller.signal)
      controller.signal.throwIfAborted()
      setPauseUntil(0)
    }
    const options: RepoReadOptions = {
      signal: controller.signal,
      beforeRequest: gate,
      onRateLimit: async (error) => {
        controller.signal.throwIfAborted()
        const resetAt = error.resetAt ?? Date.now() + 60_000
        if (resetAt - Date.now() > 300_000) {
          stopped = error
          throw error
        }
        blockedUntil = Math.max(blockedUntil, resetAt)
        setNow(Date.now())
        setPauseUntil(blockedUntil)
        await waitForGitHubReset(error, 300_000, controller.signal)
        await gate()
      },
    }
    const result = await syncAddedRepos(created, options, setProgress)
    controller.abort()
    setPauseUntil(0)
    // New apps may live under another GitHub App installation: link the workspace again once the picker closes.
    requestAutoLink(useStore.getState().workspace?.id)
    if (result.error) {
      setDeferredReason(result.error.message)
      const later = [...result.rows.values()].filter((v) => v === 'later').length
      useUI.getState().notify(`${created.length} apps added. GitHub's limit is used up until ${githubResetTime(result.error.resetAt ?? Date.now() + 60_000)}. Sync the other ${later} after that.`, 'neutral')
      return
    }
    const ok = [...result.rows.values()].filter((v) => v === 'done').length
    useUI.getState().notify(`${ok} of ${created.length} ${created.length === 1 ? 'app' : 'apps'} ready`, ok === created.length ? 'success' : 'neutral')
  }

  const aiProvider = useStore((st) => workspaceAI(st.settings).provider)
  const sample = useStore((st) => st.settings.demo)
  // mcp and both modes: Claude drafts the cards once connected. With a key (both mode) the scan writes them itself,
  // because aiSyncApp uses the saved key; in mcp mode there is none, so the scan writes facts only (see scanAI).
  const mcp = mcpEnabled()
  const both = aiMode() === 'both' // Claude and the API key side by side: Settings → Connect your AI shows both
  const keyed = aiProvider !== 'none' && aiProvider !== 'demo'
  const aiApps = useAIApps((st) => knownAIApps(st, userId ?? null))
  const guideKey = guideScope(workspaceId ?? null, userId ?? null, sample)
  const claudeStepShown = useGuideState((st) => st.workspaces[guideKey]?.claudeStepShown ?? false)
  const { aiConnected, claudeNext, claudeCanDraft } = scanAI({ mcp, keyed, sample, signedIn: !!userId, aiApps: aiApps ? aiApps.length : null, claudeStepShown })
  const seeApps = () => {
    setOpen(false)
    navigate({ name: 'portfolio' })
    if (claudeNext) useUI.getState().setClaudeWindow('first') // it marks itself shown once open
  }
  const running = progress !== null && [...progress.values()].some((v) => v === 'queued' || v === 'syncing')
  const finished = progress !== null && !running
  const close = () => !running && setOpen(false)
  const repoDetails = (r: RepoListItem, reason: string) => (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2">
        <span className="break-all text-sm font-medium text-text">{r.fullName}</span>
        {linked.has(r.fullName.toLowerCase()) && <span className="text-xs text-text-muted">Tracked</span>}
        {r.private && <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock className="size-3" aria-hidden /> Private</span>}
      </span>
      <span className="mt-0.5 block text-xs text-text-muted">{reason}</span>
      <span className="mt-0.5 block text-xs text-text-muted">{r.language ? `${r.language} · ` : ''}Pushed {timeAgo(r.pushedAt)}</span>
    </span>
  )

  return (
    <Modal open={open} onClose={close} size="lg" title={progress ? 'Setting up your apps' : 'Find your apps'}
      description={progress ? 'Tempo reads each repo and syncs its app card.' : 'Tempo finds apps from deploy files, start scripts and live URLs. Review what it finds.'}>
      {!token ? (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">Adding apps from repos needs a GitHub sign-in.</p>
          <ReconnectGitHub variant="primary" icon={GitBranch} label="Sign in with GitHub" />
        </div>
      ) : progress ? (
        <div>
          {pauseUntil > 0 && <p role="status" className="mb-3 tabular-nums">GitHub asked us to slow down. Resuming in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}.</p>}
          {deferredReason && <p role="status" className="mb-3 text-sm text-text-muted">{deferredReason}</p>}
          <ul className="space-y-1" aria-live="polite">
            {[...progress.entries()].map(([name, st]) => (
              <li key={name} className="flex items-center gap-3 rounded-md px-3 py-2">
                <span className="grid size-5 place-items-center">
                  {st === 'syncing' ? <Spinner size={14} className="motion-reduce:animate-none" /> : st === 'done' ? <Check className="size-4 text-success" aria-hidden /> : st === 'failed' ? <CircleAlert className="size-4 text-warning" aria-hidden /> : <span className="size-1.5 rounded-full bg-border-strong" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{appNameFromRepo(name)}</span>
                <span className="text-xs text-text-muted">{st === 'syncing' ? 'Reading the repo…' : st === 'done' ? 'Card ready' : st === 'failed' ? 'Sync failed, retry from the app' : st === 'later' ? 'Sync later · GitHub limit reached' : 'Waiting'}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            {/* Picking an AI happens during the scan and never blocks it. */}
            {!aiConnected && !claudeNext && (
              <p className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
                Cards show facts only until you {both ? `connect ${aiAppName()} or add an API key` : mcp ? `connect ${aiAppName()}` : 'pick an AI'}.
                <Button size="sm" variant="secondary" onClick={() => { setOpen(false); if (both) navigate({ name: 'settings' }); else if (mcp) openConnectAI(); else openAIPanel() }}>{both ? 'Connect your AI' : mcp ? connectLabel() : 'Pick your AI'}</Button>
              </p>
            )}
            {claudeCanDraft && (
              <p className="mr-auto text-sm text-text-muted">Cards show repo facts. Ask {aiAppName()} to draft them.</p>
            )}
            <Button variant="primary" disabled={!finished} onClick={seeApps}>
              {!finished ? 'Working…' : claudeNext ? 'Next' : 'See your apps'}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Input icon={Search} size="sm" autoFocus placeholder="Search repos…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search repos" />
          <div className="mt-3 space-y-2 text-sm text-text-muted">
            <p role="status" className="tabular-nums">{repos ? `Reading ${repos.length}${listing ? '+' : ''} repos · ${results.size} checked` : 'Finding your repos…'}</p>
            <GitHubOrgApproval className="text-xs" />
            {resumed > 0 && <p className="text-xs tabular-nums">Picking up where we stopped: {resumed} checked.</p>}
            {(repos?.length ?? 0) > 30 && <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs">{allRequested ? 'Reading the rest of your repos.' : 'Reading the 30 most recently pushed repos first.'}</p>
              {!allRequested && <Button size="sm" variant="ghost" onClick={() => checkRest.current()}>Check the rest</Button>}
            </div>}
            {pauseUntil > 0 && <p role="status" className="tabular-nums">GitHub asked us to slow down. Resuming in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}.</p>}
            {(error || authError || readErrors.size > 0) && <div className="space-y-2">
              <p className="text-danger" role="alert">{authError ? 'GitHub access expired. Reconnect GitHub.' : error ?? `${readErrors.size} repos could not be read.`}</p>
              {authError ? <ReconnectGitHub size="sm" /> : <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>}
            </div>}
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {repos === null && listing ? <div aria-busy="true" className="motion-reduce:[&_*]:animate-none"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div> : repos !== null && shown.length === 0 ? (
              <div>
                <EmptyState compact icon={GitBranch} title={q ? 'No repos match' : 'No repos found'} body={q ? 'Try a different name.' : 'This GitHub account has no repos Tempo can read.'} />
                {!q && <GitHubAppInstallActions onRefresh={refreshRepos} className="mt-3 flex flex-wrap items-center justify-center gap-3" />}
              </div>
            ) : <>
              {apps.length > 0 && <section aria-label="Apps">
                <h3 className="px-3 py-2 text-sm font-medium tabular-nums">Apps ({apps.length})</h3>
                <ul className="space-y-0.5">{apps.map((r) => {
                  const taken = linked.has(r.fullName.toLowerCase())
                  const on = picked.has(r.fullName) || taken
                  return <li key={r.fullName}>
                    <label className={cn('flex items-start gap-3 rounded-md px-3 py-2 hover:bg-surface-2', taken ? 'opacity-60' : 'cursor-pointer')}>
                      <input type="checkbox" checked={on} disabled={taken} onChange={() => toggle(r.fullName)} aria-label={`Add ${r.fullName}`} className="focus-ring mt-1 size-4 shrink-0 accent-accent-strong" />
                      {repoDetails(r, results.get(r.fullName)!.reason)}
                    </label>
                  </li>
                })}</ul>
              </section>}
              {!reading && !listing && repos && repos.length > 0 && foundApps === 0 && <p className="px-3 py-2 text-sm text-text-muted">{readErrors.size ? 'No apps found in the repos checked so far.' : 'No repos look like apps yet. Review the list below.'}</p>}
              {notApps.length > 0 && <section>
                <button type="button" className="focus-ring w-full rounded-md px-3 py-2 text-left text-sm text-text-muted hover:text-text" aria-expanded={expanded} aria-controls="repo-picker-not-apps" onClick={() => setNotAppsOpen(!expanded)}>
                  Not apps ({notApps.length}) <span aria-hidden>{expanded ? '−' : '+'}</span>
                </button>
                <ul id="repo-picker-not-apps" hidden={!expanded} className="space-y-0.5">{notApps.map((r) => <li key={r.fullName} className="flex flex-wrap items-center gap-3 rounded-md px-3 py-2">
                  {repoDetails(r, results.get(r.fullName)!.reason)}
                  {!linked.has(r.fullName.toLowerCase()) && <Button size="sm" variant="ghost" aria-label={`This is an app: ${r.fullName}`} onClick={() => promote(r.fullName)}>This is an app</Button>}
                </li>)}</ul>
              </section>}
              {unread.length > 0 && <section aria-label="Repos to check">
                <h3 className="px-3 py-2 text-sm text-text-muted tabular-nums">To check ({unread.length})</h3>
                <ul>{unread.map((r) => <li key={r.fullName} className="flex gap-3 rounded-md px-3 py-2">{repoDetails(r, readErrors.get(r.fullName) ?? 'Not checked yet')}</li>)}</ul>
              </section>}
            </>}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            <Button variant="primary" disabled={count === 0 || pauseUntil > 0 || authError} onClick={() => void track()}>Add {count} {count === 1 ? 'app' : 'apps'}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
