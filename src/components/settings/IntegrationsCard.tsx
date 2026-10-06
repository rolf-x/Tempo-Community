// Settings → Integrations: the GitHub connection.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { useSession } from '../../data/session'
import { listRepos } from '../../data/github'
import { LINK_ERROR_MESSAGE, linkWorkspace, useInstallationLinks, type LinkEntry } from '../../data/githubLink'
import { useStore } from '../../store/useStore'
import { Button } from '../ui'
import { useUI } from '../uiState'
import { Section } from './Section'
import { githubAppInstallUrl, githubAppMode } from '../../lib/githubApp'
import { canManagePeople } from '../../lib/permissions'
import { finishVisibleRefresh, listenForVisibleRefresh, markVisibleRefreshStarted, visibleRefreshState } from '../../lib/visibleRefresh'
import { ReconnectGitHub } from '../ReconnectGitHub'

export function IntegrationsCard() {
  const status = useSession((s) => s.status)
  const githubToken = useSession((s) => s.githubToken)
  const [repoCount, setRepoCount] = useState<number | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const repoRefresh = useRef(visibleRefreshState())
  const demo = useStore((s) => s.settings.demo)
  const workspaceId = useStore((s) => s.workspace?.id ?? null)
  const canManage = useStore((s) => canManagePeople(s.members.find((m) => m.id === s.meId)))
  const links = useInstallationLinks(workspaceId)
  const [turningOn, setTurningOn] = useState(false)

  useEffect(() => {
    if (!githubAppMode() || !githubToken) {
      finishVisibleRefresh(repoRefresh.current)
      setRepoCount(null)
      if (!githubToken) setConfirmDisconnect(false)
      return
    }
    let controller: AbortController | null = null
    const refresh = () => {
      const request = repoRefresh.current.request
      controller = new AbortController()
      void listRepos(githubToken, { signal: controller.signal }).then(
        (repos) => setRepoCount(repos.length),
        () => {},
      ).finally(() => finishVisibleRefresh(repoRefresh.current, request))
    }
    markVisibleRefreshStarted(repoRefresh.current)
    refresh()
    const stop = listenForVisibleRefresh(repoRefresh.current, refresh)
    return () => {
      controller?.abort()
      finishVisibleRefresh(repoRefresh.current)
      stop()
    }
  }, [githubToken])

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      const { revoked } = await (await import('../../data/cloud')).disconnectGitHub()
      useUI.getState().notify(githubDisconnectToast(revoked), 'success')
    } finally {
      setDisconnecting(false)
      setConfirmDisconnect(false)
    }
  }

  const turnOn = async () => {
    if (!workspaceId) return
    setTurningOn(true)
    try {
      await linkWorkspace(workspaceId)
    } finally {
      setTurningOn(false)
    }
  }

  return (
    <Section title="Integrations" description="Where Tempo learns what changed, so nobody has to type status updates.">
      <GitHubConnectionRow
        connected={!!githubToken}
        appMode={githubAppMode()}
        repoCount={repoCount}
        statusOff={status === 'off'}
        confirmDisconnect={confirmDisconnect}
        disconnecting={disconnecting}
        connectAction={<ReconnectGitHub label="Connect GitHub" size="sm" disabled={status === 'off'} />}
        onRequestDisconnect={() => setConfirmDisconnect(true)}
        onCancel={() => setConfirmDisconnect(false)}
        onDisconnect={() => void disconnect()}
      />
      {githubAppMode() && status === 'signed-in' && !demo && workspaceId && (
        <PushUpdatesRow
          entry={links}
          canManage={canManage}
          githubConnected={!!githubToken}
          turningOn={turningOn}
          onTurnOn={() => void turnOn()}
        />
      )}
    </Section>
  )
}

export const githubDisconnectToast = (revoked: boolean): string => revoked
  ? "GitHub disconnected. Tempo's access was revoked."
  : 'GitHub disconnected in this browser.'

interface GitHubConnectionRowProps {
  connected: boolean
  appMode: boolean
  repoCount: number | null
  statusOff: boolean
  confirmDisconnect: boolean
  disconnecting: boolean
  connectAction?: ReactNode
  onConnect?: () => void
  onRequestDisconnect: () => void
  onCancel: () => void
  onDisconnect: () => void
}

export function GitHubConnectionRow({ connected, appMode, repoCount, statusOff, confirmDisconnect, disconnecting, connectAction, onConnect, onRequestDisconnect, onCancel, onDisconnect }: GitHubConnectionRowProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">GitHub</p>
          <p className="text-xs text-text-muted">
            {connected
              ? appMode
                ? `Connected. Tempo's GitHub access is read-only, enforced by GitHub, and limited to accounts and repos where Tempo is installed.${repoCount === null ? '' : ` ${repoCount} ${repoCount === 1 ? 'repo' : 'repos'} available.`}`
                : 'Connected. Tempo only reads: repo info, README, agent notes, commits, PRs, issues. (GitHub\'s permission for private repos also allows writes; Tempo never uses that.)'
              : appMode
                ? 'Connect for read-only access to accounts and repos where Tempo is installed.'
                : 'Connect to link repos to apps and sync them.'}
          </p>
        </div>
        {connected ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <Check className="size-3.5" aria-hidden /> Connected
            </span>
            <Button size="sm" variant="secondary" onClick={onRequestDisconnect}>Disconnect</Button>
          </div>
        ) : (
          connectAction ?? <Button size="sm" onClick={onConnect} disabled={statusOff}>Connect GitHub</Button>
        )}
      </div>

      {connected && appMode && (
        <p className="mt-2 text-xs text-text-muted">
          <a href="https://github.com/settings/installations" target="_blank" rel="noreferrer" className="focus-ring rounded-sm text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
            Manage where Tempo is installed on GitHub
          </a>
          . An organisation owner can remove Tempo there.
        </p>
      )}

      {connected && confirmDisconnect && (
        <div className="mt-3 rounded-lg border border-danger/25 bg-danger-soft/40 p-3">
          <p className="text-sm text-text">Disconnect GitHub? Your apps stay in Tempo, but syncing stops until you connect again.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" loading={disconnecting} onClick={onDisconnect}>Disconnect</Button>
            <Button size="sm" variant="secondary" disabled={disconnecting} onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export type PushUpdatesState = 'on' | 'checking' | 'not-configured' | 'member' | 'no-install' | 'off'

/** Which "Updates on every push" row to show. Turning it on is for owners and admins; everyone else only reads it. */
export function pushUpdatesState(entry: Pick<LinkEntry, 'links' | 'status' | 'error' | 'noInstall'>, canManage: boolean, turningOn = false): PushUpdatesState {
  if (entry.links.length > 0) return 'on'
  if (entry.error === 'not_configured') return 'not-configured'
  // Reading the links, or the automatic attempt: nothing to press yet. After "Turn on" the button stays, with its spinner.
  if (entry.status === 'idle' || (entry.status === 'loading' && !(canManage && turningOn))) return 'checking'
  if (!canManage) return 'member'
  return entry.noInstall ? 'no-install' : 'off'
}

const joinLogins = (logins: string[]) => logins.join(', ')

interface PushUpdatesRowProps {
  entry: LinkEntry
  canManage: boolean
  githubConnected: boolean
  turningOn: boolean
  onTurnOn: () => void
}

export function PushUpdatesRow({ entry, canManage, githubConnected, turningOn, onTurnOn }: PushUpdatesRowProps) {
  const state = pushUpdatesState(entry, canManage, turningOn)
  const logins = [...new Set(entry.links.map((link) => link.login))]
  const failed = state === 'off' && entry.error && entry.error !== 'load_failed' ? LINK_ERROR_MESSAGE[entry.error] : null
  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">Updates on every push</p>
          <p className="text-xs text-text-muted">
            {state === 'on' && `On for ${joinLogins(logins)}. Tempo re-checks an app as soon as someone pushes to it.`}
            {state === 'checking' && 'Checking…'}
            {state === 'not-configured' && LINK_ERROR_MESSAGE.not_configured}
            {state === 'member' && 'Ask an owner or admin to turn this on.'}
            {state === 'no-install' && "Tempo's GitHub App isn't installed on the account that owns your repos."}
            {state === 'off' && (githubConnected
              ? 'Off. Tempo only re-checks an app when someone presses Sync.'
              : 'Off. Connect GitHub first, then turn this on.')}
          </p>
        </div>
        {state === 'on' && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
            <Check className="size-3.5" aria-hidden /> On
          </span>
        )}
        {(state === 'off' || state === 'no-install') && (
          <Button size="sm" variant={state === 'off' ? 'primary' : 'secondary'} loading={turningOn} disabled={!githubConnected} onClick={onTurnOn} className="shrink-0">
            {state === 'off' ? 'Turn on' : 'Try again'}
          </Button>
        )}
      </div>
      {state === 'no-install' && githubAppMode() && (
        <p className="mt-2 text-xs text-text-muted">
          <a href={githubAppInstallUrl()} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
            Install it on GitHub <ExternalLink className="size-3" aria-hidden />
          </a>
          . An organisation owner has to approve the install.
        </p>
      )}
      {failed && <p role="alert" className="mt-2 text-xs text-danger">{failed}</p>}
    </div>
  )
}
