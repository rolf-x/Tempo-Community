// The AI apps connected to Tempo (Supabase OAuth grants). Settings → Connect your AI reads and revokes them; the setup
// guide reads the same list to tick "Connect Claude".
import { useEffect } from 'react'
import { create } from 'zustand'
import { ALLOWED_KEY, brandClients, connectedClients, type ConnectedClient } from '../lib/mcpSetup'

export async function fetchGrants(): Promise<ConnectedClient[]> {
  const { client } = await import('./cloud')
  const { data, error } = await client().auth.oauth.listGrants()
  if (error || !data) throw error ?? new Error('No grants')
  return connectedClients(data)
}

export interface AIAppsState {
  /** The last list read for `userId`: null until one is read. */
  clients: ConnectedClient[] | null
  userId: string | null
  /** The last read failed (the list above, if any, is older). */
  failed: boolean
  /** Bumped by every list Settings publishes, so an older read still on its way can't bring a revoked app back. */
  version: number
}

export const useAIApps = create<AIAppsState>(() => ({ clients: null, userId: null, failed: false, version: 0 }))

/** Settings → Connect your AI shares every list it reads (after a revoke too). */
export function publishAIApps(userId: string, clients: ConnectedClient[]) {
  useAIApps.setState((now) => ({ clients, userId, failed: false, version: now.version + 1 }))
}

let inFlight: { userId: string; request: Promise<void> } | null = null

/**
 * What the app should go by: the list, or [] when it couldn't be read at all (offer "Connect Claude" rather than wait
 * forever), or null while the first read is on its way.
 */
export const knownAIApps = (state: AIAppsState, userId: string | null): ConnectedClient[] | null =>
  state.userId !== userId ? null : state.clients ?? (state.failed ? NONE : null)

/**
 * Whether Claude is connected, by the last list actually read for this user: null until one comes back, so a failed or
 * pending read never claims "Claude isn't connected".
 */
export function claudeConnected(state: AIAppsState, userId: string | null): boolean | null {
  if (!userId || state.userId !== userId || state.clients === null) return null
  return brandClients('claude', state.clients).length > 0
}

/** One empty list, so a store selector returns the same value each time (a new [] would re-render forever). */
const NONE: ConnectedClient[] = []

/** Reads the list for this user into useAIApps. Calls made while a read for the same user is on its way share it. */
export function loadAIApps(userId: string): Promise<void> {
  if (useAIApps.getState().userId !== userId) useAIApps.setState((now) => ({ clients: null, userId, failed: false, version: now.version + 1 }))
  if (inFlight?.userId === userId) return inFlight.request
  const version = useAIApps.getState().version
  const request = fetchGrants()
    .then((clients) => {
      const now = useAIApps.getState()
      if (now.userId === userId && now.version === version) useAIApps.setState({ clients, failed: false })
    }, () => {
      if (useAIApps.getState().userId === userId) useAIApps.setState({ failed: true })
    })
    .finally(() => { if (inFlight?.request === request) inFlight = null })
  inFlight = { userId, request }
  return request
}

/** Keeps the list current while `enabled`: read now, again on coming back to the tab or an Allow in another Tempo tab. */
export function useWatchAIApps(userId: string | null, enabled: boolean) {
  const on = enabled && !!userId
  useEffect(() => {
    if (!on || !userId) return
    const load = () => void loadAIApps(userId)
    const onReturn = () => { if (document.visibilityState === 'visible') load() }
    const onAllowed = (event: StorageEvent) => { if (event.key === ALLOWED_KEY) load() }
    load()
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('storage', onAllowed)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('storage', onAllowed)
    }
  }, [on, userId])
}
