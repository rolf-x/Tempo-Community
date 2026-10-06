// The message the Claude window gives, kept for Tempo's Allow page while the person connects Claude in another tab.
// Clicking Allow copies it, so they paste it in Claude straight away instead of coming back to Tempo for it. The Tempo
// tab hears that through the storage event and starts waiting for the drafts. It lives in this browser only
// (localStorage) and expires.

export const PENDING_KEY = 'tempo.claude.pendingMessage'
/** Older than this, it belongs to another visit: Allow copies nothing. */
export const PENDING_FOR_MS = 30 * 60_000

export interface PendingMessage {
  prompt: string
  workspaceId: string
  projectIds: string[]
  savedAt: number
  /** Set by the Allow page once it copied the message. */
  copiedAt?: number
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function parse(raw: string | null, now: number): PendingMessage | null {
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    const ids = Array.isArray(m.projectIds) ? m.projectIds.filter(isText) : []
    if (!isText(m.prompt) || m.prompt.length > 4000 || !isText(m.workspaceId) || !ids.length) return null
    if (typeof m.savedAt !== 'number' || !(now - m.savedAt >= 0 && now - m.savedAt < PENDING_FOR_MS)) return null
    return { prompt: m.prompt, workspaceId: m.workspaceId, projectIds: ids, savedAt: m.savedAt, ...(typeof m.copiedAt === 'number' ? { copiedAt: m.copiedAt } : {}) }
  } catch {
    return null
  }
}

/** The message waiting for an Allow, or null (none, expired, unreadable, or storage blocked). */
export function readPendingMessage(now = Date.now()): PendingMessage | null {
  try {
    return parse(localStorage.getItem(PENDING_KEY), now)
  } catch {
    return null
  }
}

export function savePendingMessage(message: Pick<PendingMessage, 'prompt' | 'workspaceId' | 'projectIds'>, now = Date.now()) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...message, savedAt: now }))
  } catch { /* Storage blocked: Allow just won't copy. */ }
}

/** The Allow page copied it: tell the Tempo tab, which starts waiting and clears it. */
export function markPendingCopied(message: PendingMessage, now = Date.now()) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...message, copiedAt: now }))
  } catch { /* The Tempo tab then simply doesn't start waiting by itself. */ }
}

export function clearPendingMessage() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch { /* Nothing to clear. */ }
}
