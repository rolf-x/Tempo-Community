// Shared adapter plumbing (kept out of client.ts so adapters can import it without a cycle).
import type { ToolName } from './schemas'
import type { AISettings } from '../types'

export class AIError extends Error {
  constructor(message: string, readonly details = message) {
    super(message)
    this.name = 'AIError'
  }
}

export interface ToolCall<T extends ToolName = ToolName> {
  tool: T
  system: string
  user: string
  /** Per-call override of the 60 s adapter timeout. */
  timeoutMs?: number
}

/** Each adapter returns the raw tool input (unvalidated). */
export type Adapter = (call: ToolCall, schema: Record<string, unknown>, settings: AISettings) => Promise<unknown>

export const DEFAULT_TIMEOUT_MS = 60_000

/** Testing lock: VITE_AI_LOCAL_ONLY=1 (in .env.development.local) keeps every AI call on the local claude -p
 *  bridge (the local Claude login), so no paid API is called. Read per call so tests can stub it. */
export const localOnly = () => import.meta.env.VITE_AI_LOCAL_ONLY === '1'
export const LOCAL_ONLY_MESSAGE = 'Paid AI providers are switched off while testing. Calls run on the local Claude login.'

/** fetch with an AbortController timeout; timeouts and network failures become friendly AIErrors. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e)
    if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw new AIError('The AI took too long to answer. Try again.', details)
    throw new AIError("Couldn't reach the AI provider. Check your connection and the endpoint address.", details)
  } finally {
    clearTimeout(timer)
  }
}

/** Throws a friendly AIError for a non-2xx response; returns the parsed JSON body otherwise. */
export async function readJson(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body
  if (res.status === 401 || res.status === 403) throw new AIError('That API key was rejected. Check it in Settings.')
  if (res.status === 429) throw new AIError('The provider is rate-limiting you. Wait a moment and try again.')
  if (res.status >= 500) throw new AIError('The AI provider is having trouble right now. Try again shortly.')
  const msg = typeof body?.error === 'string' ? body.error : body?.error?.message
  throw new AIError(msg ? String(msg) : `The AI request failed (${res.status}).`)
}
