import { describe, expect, it, vi } from 'vitest'
import { finishVisibleRefresh, listenForVisibleRefresh, markVisibleRefreshStarted, visibleRefreshState } from './visibleRefresh'

class VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

describe('visible refresh', () => {
  it('refreshes once after a visible tab return, skips in-flight work, and throttles for five seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const target = new VisibilityTarget()
    const state = visibleRefreshState()
    const refresh = vi.fn()
    markVisibleRefreshStarted(state)
    finishVisibleRefresh(state)
    const stop = listenForVisibleRefresh(state, refresh, target as unknown as Document)

    target.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5_000)
    target.visibilityState = 'hidden'
    target.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()

    target.visibilityState = 'visible'
    target.dispatchEvent(new Event('visibilitychange'))
    target.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)

    finishVisibleRefresh(state)
    vi.advanceTimersByTime(4_999)
    target.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    target.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)

    stop()
    finishVisibleRefresh(state)
    vi.advanceTimersByTime(5_000)
    target.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not let an older request mark a newer listing as finished', () => {
    const state = visibleRefreshState()
    const first = markVisibleRefreshStarted(state, 1)
    const second = markVisibleRefreshStarted(state, 2)
    finishVisibleRefresh(state, first)
    expect(state.inFlight).toBe(true)
    finishVisibleRefresh(state, second)
    expect(state.inFlight).toBe(false)
  })
})
