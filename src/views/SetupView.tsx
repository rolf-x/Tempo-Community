import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'
import { useSession, signOutToHome } from '../data/session'
import { GitHubError, listGitHubAccounts, setSetupRepoScope, type GitHubAccount } from '../data/github'
import { setupWorkspace } from '../data/workspace'
import { navigate } from '../lib/router'
import { githubAppMode } from '../lib/githubApp'
import { finishVisibleRefresh, listenForVisibleRefresh, markVisibleRefreshStarted, visibleRefreshState } from '../lib/visibleRefresh'
import { Wordmark } from '../components/Logo'
import { ReconnectGitHub } from '../components/ReconnectGitHub'
import { GITHUB_ORG_APPROVAL_URL, GitHubAppInstallActions, GitHubOrgApproval } from '../components/GitHubOrgApproval'
import { Avatar, Button, SkeletonRow, cn, fadeUp } from '../components/ui'
import { useUI } from '../components/uiState'

export default function SetupView() {
  const user = useSession((state) => state.user)
  const token = useSession((state) => state.githubToken)
  const [accounts, setAccounts] = useState<GitHubAccount[] | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loadError, setLoadError] = useState<{ message: string; reconnect: boolean } | null>(null)
  const [busyLogin, setBusyLogin] = useState<string | null>(null)
  const [failedChoice, setFailedChoice] = useState<GitHubAccount | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [restricted, setRestricted] = useState<GitHubAccount | null>(null)
  const autoStarted = useRef(false)
  const accountRefresh = useRef(visibleRefreshState())

  const fallbackPersonal: GitHubAccount = {
    kind: 'personal',
    login: user?.githubLogin || user?.name || 'me',
    name: user?.name || user?.githubLogin || 'My',
    avatarUrl: user?.avatarUrl || '',
    repoCount: null,
    approvalRequired: false,
  }
  const personal = accounts?.find((account) => account.kind === 'personal') ?? fallbackPersonal

  const choose = useCallback(async (account: GitHubAccount) => {
    if (account.approvalRequired) {
      setRestricted(account)
      setSetupError(null)
      return
    }
    setRestricted(null)
    setSetupError(null)
    setFailedChoice(null)
    setBusyLogin(account.login)
    try {
      const name = account.kind === 'org' ? account.name : `${account.login}'s apps`
      await setupWorkspace(account.kind, name, account.kind === 'org' ? account.login : undefined)
      setSetupRepoScope(account)
      navigate({ name: 'portfolio' })
      useUI.getState().setRepoPickerOpen(true)
    } catch (error) {
      setFailedChoice(account)
      setSetupError(error instanceof Error ? `${error.message} Try again.` : "Tempo couldn't create the workspace. Try again.")
      setBusyLogin(null)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      finishVisibleRefresh(accountRefresh.current)
      setAccounts(null)
      setLoadError({ message: "GitHub isn't connected. Reconnect GitHub, or use your own account for now.", reconnect: true })
      return
    }
    let live = true
    const request = markVisibleRefreshStarted(accountRefresh.current)
    setAccounts(null)
    setLoadError(null)
    void listGitHubAccounts(token).then(
      (next) => { if (live) setAccounts(next) },
      (error: unknown) => {
        if (!live) return
        const reconnect = error instanceof GitHubError && error.kind === 'auth'
        setLoadError({
          reconnect,
          message: reconnect
            ? 'GitHub access expired. Reconnect GitHub, or use your own account for now.'
            : error instanceof GitHubError && error.kind === 'network'
              ? "Couldn't reach GitHub. Check your connection, then try again."
              : "GitHub couldn't load your accounts. Try again.",
        })
      },
    ).finally(() => finishVisibleRefresh(accountRefresh.current, request))
    return () => { live = false }
  }, [attempt, token])

  useEffect(() => {
    if (!githubAppMode()) return
    return listenForVisibleRefresh(accountRefresh.current, () => setAttempt((value) => value + 1))
  }, [])

  const refreshAccounts = () => {
    markVisibleRefreshStarted(accountRefresh.current)
    setAttempt((value) => value + 1)
  }

  useEffect(() => {
    if (githubAppMode() || !accounts || accounts.some((account) => account.kind === 'org') || autoStarted.current) return
    const own = accounts.find((account) => account.kind === 'personal')
    if (!own) return
    autoStarted.current = true
    void choose(own)
  }, [accounts, choose])

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-8">
        <Wordmark />
        <button type="button" onClick={() => void signOutToHome()} className="focus-ring rounded-sm text-sm text-text-muted hover:text-text">
          Sign out
        </button>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <motion.div {...fadeUp} className="w-full min-w-0 max-w-xl">
          <h1 className="text-center text-2xl font-semibold tracking-tight text-text sm:text-3xl">Where do your apps live?</h1>
          <p className="mt-2 text-center text-sm text-text-muted">Pick one account. You can change the workspace name later in Settings.</p>

          <div className="mt-7">
            {!accounts && !loadError && (
              <div aria-busy="true" aria-label="Loading GitHub accounts" className="space-y-2 motion-reduce:[&_*]:animate-none">
                <SkeletonRow /><SkeletonRow /><SkeletonRow />
              </div>
            )}

            {loadError && (
              <div className="rounded-xl border border-border bg-surface p-4 text-center shadow-xs">
                <p role="alert" className="text-sm text-text">{loadError.message}</p>
                <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                  {loadError.reconnect ? (
                    <ReconnectGitHub variant="primary" size="lg" />
                  ) : (
                    <Button variant="primary" size="lg" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
                  )}
                  <Button size="lg" onClick={() => void choose(personal)} loading={busyLogin === personal.login}>Use my own account</Button>
                </div>
              </div>
            )}

            {accounts && (githubAppMode() || accounts.some((account) => account.kind === 'org')) && accounts.length > 0 && (
              <ul className="space-y-2" aria-label="GitHub accounts">
                {accounts.map((account) => {
                  const selected = restricted?.login === account.login
                  return (
                    <li key={`${account.kind}:${account.login}`}>
                      <button
                        type="button"
                        disabled={busyLogin !== null}
                        aria-busy={busyLogin === account.login || undefined}
                        onClick={() => void choose(account)}
                        className={cn(
                          'focus-ring flex w-full min-w-0 items-center gap-3 rounded-xl border bg-surface p-4 text-left shadow-xs transition-[border-color,background-color,box-shadow] duration-150 disabled:opacity-60',
                          selected ? 'border-accent-strong ring-2 ring-accent/25' : 'border-border hover:border-border-strong hover:bg-surface-2',
                        )}
                      >
                        <Avatar name={account.name} src={account.avatarUrl} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text">{account.kind === 'personal' ? 'Just me' : account.name}</span>
                          <span className="block truncate font-mono text-xs text-text-muted">github.com/{account.login}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs tabular-nums text-text-muted">
                          {account.repositorySelection === 'all' ? 'All repos' : account.repositorySelection === 'selected' ? 'Selected repos' : account.repoCount === null ? 'Repos hidden' : `${account.repoCount} ${account.repoCount === 1 ? 'repo' : 'repos'}`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {accounts && (!githubAppMode() || accounts.length === 0) && !accounts.some((account) => account.kind === 'org') && !setupError && (
              accounts.length > 0 && !githubAppMode()
                ? <p role="status" className="text-center text-sm text-text-muted">No organisations found. Setting up your own account…</p>
                : <div className="rounded-xl border border-border bg-surface p-4 text-center shadow-xs">
                    <p role="status" className="text-sm text-text-muted">Tempo isn't installed on any GitHub accounts yet.</p>
                    <GitHubAppInstallActions onRefresh={refreshAccounts} className="mt-4 flex flex-wrap items-center justify-center gap-3" />
                  </div>
            )}

            {accounts && <GitHubOrgApproval className="mt-4 text-center text-sm text-text-muted" />}

            {restricted && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4">
                <p role="alert" className="text-sm font-medium text-text">{restricted.name} hasn't approved Tempo yet.</p>
                <p className="mt-1 text-sm text-text-muted">Ask the organisation to approve Tempo on GitHub, or keep going with your own account.</p>
                <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <a href={GITHUB_ORG_APPROVAL_URL} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm text-sm font-medium text-accent underline underline-offset-4">
                    Request approval <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                  <Button variant="primary" onClick={() => void choose(personal)} loading={busyLogin === personal.login}>Use my own account for now</Button>
                </div>
              </div>
            )}

            {setupError && (
              <div className="mt-4 text-center">
                <p role="alert" className="text-sm text-danger">{setupError}</p>
                {failedChoice && <Button variant="primary" className="mt-3" onClick={() => void choose(failedChoice)}>Try again</Button>}
              </div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  )
}
