// Test-only fetch mocking helpers.
import { vi } from 'vitest'

export const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function mockFetch(...responses: (Response | Error | ((url: string, init: RequestInit) => Promise<Response>))[]) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const next = responses.length > 1 ? responses.shift()! : responses[0]
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(url, init)
    return next.clone()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** fetch that never answers but rejects with AbortError when the signal fires. */
export const hangingFetch = () =>
  mockFetch((_url, init) => new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))))

/** Awaits a promise that must reject and returns the error. */
export async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (e) {
    return e as Error
  }
  throw new Error('expected the promise to reject')
}
