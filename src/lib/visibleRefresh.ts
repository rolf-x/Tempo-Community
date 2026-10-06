export const VISIBLE_REFRESH_INTERVAL_MS = 5_000

export interface VisibleRefreshState {
  inFlight: boolean
  lastStartedAt: number
  request: number
}

export const visibleRefreshState = (): VisibleRefreshState => ({ inFlight: false, lastStartedAt: -Infinity, request: 0 })

export function markVisibleRefreshStarted(state: VisibleRefreshState, now = Date.now()): number {
  state.inFlight = true
  state.lastStartedAt = now
  return ++state.request
}

export function finishVisibleRefresh(state: VisibleRefreshState, request = state.request): void {
  if (request !== state.request) return
  state.inFlight = false
}

export function listenForVisibleRefresh(
  state: VisibleRefreshState,
  refresh: () => void,
  target: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document,
  now: () => number = Date.now,
): () => void {
  const onVisibilityChange = () => {
    const at = now()
    if (target.visibilityState !== 'visible' || state.inFlight || at - state.lastStartedAt < VISIBLE_REFRESH_INTERVAL_MS) return
    markVisibleRefreshStarted(state, at)
    refresh()
  }
  target.addEventListener('visibilitychange', onVisibilityChange)
  return () => target.removeEventListener('visibilitychange', onVisibilityChange)
}
