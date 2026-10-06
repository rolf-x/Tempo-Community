import { useCallback, useRef, useState } from 'react'
import { create } from 'zustand'
import { GITHUB_CONNECTED_KEY, GitHubError } from '../data/github'
import { useSession } from '../data/session'
import { openGitHubPopup } from '../data/githubPopup'
import { Button, Modal } from './ui'
import { useUI } from './uiState'

type Phase = 'ready' | 'waiting' | 'blocked' | 'cancelled' | 'failed'
type DialogState = { open: boolean; request: number; show: () => void; hide: () => void }

const useGitHubDialog = create<DialogState>()((set) => ({
  open: false,
  request: 0,
  show: () => set((state) => ({ open: true, request: state.request + 1 })),
  hide: () => set({ open: false }),
}))

let waiters = new Set<(connected: boolean) => void>()

function settle(connected: boolean) {
  const current = waiters
  waiters = new Set()
  current.forEach((resolve) => resolve(connected))
}

export function requestGitHubConnection(): Promise<boolean> {
  useGitHubDialog.getState().show()
  return new Promise((resolve) => waiters.add(resolve))
}

export async function runGitHubGated<T>(action: () => T | Promise<T>, connect = requestGitHubConnection): Promise<T | undefined> {
  const session = useSession.getState()
  if (session.status === 'signed-in' && !session.githubToken && !await connect()) return undefined
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof GitHubError) || error.kind !== 'auth') throw error
    if (useSession.getState().status !== 'signed-in') throw error
    try { localStorage.removeItem(GITHUB_CONNECTED_KEY) } catch { /* The in-memory state still gates this tab. */ }
    useSession.setState({ githubToken: null })
    if (!await connect()) return undefined
    return await action()
  }
}

export function useGitHubGate() {
  const requireGitHub = useCallback(<T,>(action: () => T | Promise<T>) => runGitHubGated(action), [])
  return { requireGitHub }
}

export interface ConnectGitHubDialogProps {
  open: boolean
  onClose: () => void
  onConnected: () => void
}

export function ConnectGitHubDialog({ open, onClose, onConnected }: ConnectGitHubDialogProps) {
  const [phase, setPhase] = useState<Phase>('ready')
  const controller = useRef<AbortController | null>(null)

  const close = () => {
    controller.current?.abort()
    controller.current = null
    setPhase('ready')
    onClose()
  }
  const connect = async () => {
    const next = new AbortController()
    controller.current = next
    const pending = openGitHubPopup(next.signal)
    setPhase('waiting')
    const result = await pending.catch(() => ({ status: 'failed' as const }))
    if (controller.current !== next) return
    controller.current = null
    if (result.status === 'connected') {
      setPhase('ready')
      onConnected()
    } else {
      setPhase(result.status)
    }
  }
  const redirect = async () => {
    setPhase('waiting')
    await useSession.getState().signIn('github')
  }

  const message = phase === 'blocked'
    ? 'Your browser blocked the GitHub window.'
    : phase === 'cancelled'
      ? 'The GitHub window was closed.'
      : phase === 'failed'
        ? "GitHub couldn't connect. Try again."
        : 'Tempo needs read-only access to GitHub to sync this app. GitHub opens in a small window; you stay here.'

  return (
    <Modal open={open} onClose={close} size="sm" title="Connect GitHub">
      <p className="text-sm text-text-muted" role={phase === 'failed' || phase === 'blocked' ? 'alert' : undefined}>{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        {phase === 'waiting' ? (
          <>
            <span className="mr-auto self-center text-sm text-text-muted">Waiting for GitHub…</span>
            <Button variant="secondary" onClick={close}>Cancel</Button>
          </>
        ) : (
          <>
            {phase === 'blocked' && <Button variant="secondary" onClick={() => void redirect()}>Open GitHub here instead</Button>}
            <Button variant="primary" onClick={() => void connect()}>Connect GitHub</Button>
          </>
        )}
      </div>
    </Modal>
  )
}

export function ConnectGitHubDialogHost() {
  const open = useGitHubDialog((state) => state.open)
  const request = useGitHubDialog((state) => state.request)
  return (
    <ConnectGitHubDialog
      key={request}
      open={open}
      onClose={() => {
        useGitHubDialog.getState().hide()
        settle(false)
      }}
      onConnected={() => {
        useGitHubDialog.getState().hide()
        useUI.getState().notify('GitHub connected', 'success')
        settle(true)
      }}
    />
  )
}
