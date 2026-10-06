/** Run `fn` when the browser is idle (falls back to a short delay where requestIdleCallback is missing). Returns a cancel. */
export function whenIdle(fn: () => void, fallbackMs = 1500): () => void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: 4000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(fn, fallbackMs)
  return () => clearTimeout(id)
}
