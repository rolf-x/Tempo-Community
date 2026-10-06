// "Claude is writing the descriptions" (mcp mode). Tempo can't start Claude: the person pastes a message
// into it, and the drafts arrive later through realtime as `appCard` with `source: 'ai'`. This tracks that wait in the
// background, per tab (sessionStorage, so a reload resumes it), for the indicator, the tiles ("Writing…") and the
// Sync all button. Nothing here calls an AI or reaches the network.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { useRedraftState } from '../ai/redraftState'
import { useStore } from '../store/useStore'
import { useUI } from '../components/uiState'
import { useSession } from './session'
import type { Project } from '../types'
import { clearPendingMessage, PENDING_KEY, readPendingMessage } from './claudeHandoff'

export type ClaudeWritingPhase = 'waiting' | 'writing' | 'stalled'

export interface ClaudeWritingState {
  workspaceId: string | null
  /** Epoch ms of the moment the person copied the message or opened Claude. */
  startedAt: number | null
  /** The message to paste, kept so "Copy message again" can copy it. */
  prompt: string
  /** Ids of the apps Claude was asked to write. */
  expected: string[]
  /**
   * What each expected app's card looked like when the app was added to the wait (see `fingerprint`). A draft counts as
   * Claude's answer only if the card is now different: an app added to a running wait must not claim a card drafted
   * before it was asked for. No clocks are compared, so the browser's and the server's can disagree by any amount.
   */
  fingerprints: Record<string, string>
  /** Ids of the expected apps whose draft has arrived. */
  arrived: string[]
  /** Epoch ms when the latest draft was seen. */
  lastArrivalAt: number | null
  /** null = not waiting for anything. */
  phase: ClaudeWritingPhase | null
}

/** Nothing at all from Claude this long after the start: stalled. */
export const STALL_MS = 10 * 60_000
/** Some drafts arrived, then nothing new this long: Claude is done with what it will write. */
export const QUIET_MS = 5 * 60_000

const IDLE: ClaudeWritingState = { workspaceId: null, startedAt: null, prompt: '', expected: [], fingerprints: {}, arrived: [], lastArrivalAt: null, phase: null }

// Per tab. Storage can be missing (server, tests) or throw (private windows, quota): then it just lives in memory.
const tabStorage: StateStorage = {
  getItem: (name) => { try { return sessionStorage.getItem(name) } catch { return null } },
  setItem: (name, value) => { try { sessionStorage.setItem(name, value) } catch { /* In memory only. */ } },
  removeItem: (name) => { try { sessionStorage.removeItem(name) } catch { /* In memory only. */ } },
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const time = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

/** Whatever sessionStorage holds, this is a valid state or idle. */
function clean(saved: unknown): ClaudeWritingState {
  if (!saved || typeof saved !== 'object') return IDLE
  const s = saved as Record<string, unknown>
  const phase = s.phase === 'waiting' || s.phase === 'writing' || s.phase === 'stalled' ? s.phase : null
  const startedAt = time(s.startedAt)
  const expected = strings(s.expected)
  if (!phase || startedAt === null || !expected.length) return IDLE
  // A state saved without a card fingerprint for an app (an older version, or junk) gets a fresh one: the first look at
  // the store after the reload records the card as it is then (see `check`).
  const savedPrints = s.fingerprints && typeof s.fingerprints === 'object' && !Array.isArray(s.fingerprints) ? s.fingerprints as Record<string, unknown> : {}
  const fingerprints = Object.fromEntries(expected.flatMap((id) => typeof savedPrints[id] === 'string' ? [[id, savedPrints[id] as string]] : []))
  return {
    workspaceId: typeof s.workspaceId === 'string' ? s.workspaceId : null,
    startedAt,
    prompt: typeof s.prompt === 'string' ? s.prompt : '',
    expected,
    fingerprints,
    arrived: strings(s.arrived).filter((id) => expected.includes(id)),
    lastArrivalAt: time(s.lastArrivalAt),
    phase,
  }
}

export const useClaudeWriting = create<ClaudeWritingState>()(persist(() => IDLE, {
  name: 'tempo.claudeWriting',
  version: 1,
  storage: createJSONStorage(() => tabStorage),
  merge: (saved, current) => ({ ...current, ...clean(saved) }),
}))

const marks = () => useRedraftState.getState()
const remaining = (s: ClaudeWritingState) => s.expected.filter((id) => !s.arrived.includes(id))

let timer: ReturnType<typeof setTimeout> | undefined

/** One timer, for the next moment something can change without a draft arriving: the stall or the quiet period. */
function schedule() {
  clearTimeout(timer)
  timer = undefined
  const s = useClaudeWriting.getState()
  const at = s.phase === 'waiting' && s.startedAt !== null ? s.startedAt + STALL_MS
    : s.phase === 'writing' && s.lastArrivalAt !== null ? s.lastArrivalAt + QUIET_MS
      : null
  if (at !== null) timer = setTimeout(check, Math.max(0, at - Date.now()))
}

/** Back to idle, and the tiles stop saying "Writing…" for the apps still waiting. */
function reset() {
  remaining(useClaudeWriting.getState()).forEach((id) => marks().finishWriting(id))
  clearTimeout(timer)
  timer = undefined
  useClaudeWriting.setState(IDLE)
}

/**
 * A card as the wait sees it: its source and the stamp it carries (the server's time for an agent's draft). It is only
 * ever compared with itself, never with the browser's clock, so any difference between the two clocks is harmless.
 */
const fingerprint = (project: Project | undefined): string => {
  const card = project?.appCard
  return card ? `${card.source}|${card.draftedBy?.at ?? card.updatedAt ?? ''}` : ''
}

/** Claude's answer: a card an agent drafted (`draftedBy`) that is not the card the app had when it joined the wait. */
const wroteSince = (project: Project | undefined, before: string): boolean => {
  const card = project?.appCard
  return card?.source === 'ai' && !!card.draftedBy && fingerprint(project) !== before
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** Looks at the store and moves the wait along: arrivals, the finish, a stall, or a reset when the context changed. */
function check() {
  const s = useClaudeWriting.getState()
  if (!s.phase || s.startedAt === null) return
  const status = useSession.getState().status
  if (status === 'signed-out') return reset()
  const app = useStore.getState()
  // On a reload the workspace and apps aren't in yet: wait for them instead of concluding anything.
  if (status === 'loading' || !app.hydrated) return
  if ((app.workspace?.id ?? null) !== s.workspaceId) return reset()

  const now = Date.now()
  const byId = new Map(app.projects.map((project) => [project.id, project]))
  // An app deleted while waiting can't arrive: stop expecting it.
  s.expected.filter((id) => !byId.has(id)).forEach((id) => marks().finishWriting(id))
  const expected = s.expected.filter((id) => byId.has(id))
  const arrived = s.arrived.filter((id) => expected.includes(id))
  // An app without a fingerprint (a wait saved before them) takes the card it has now as its starting point.
  const fingerprints = { ...s.fingerprints }
  let backfilled = false
  for (const id of expected) {
    if (typeof fingerprints[id] !== 'string') {
      fingerprints[id] = fingerprint(byId.get(id))
      backfilled = true
    }
  }
  const fresh = expected.filter((id) => !arrived.includes(id) && wroteSince(byId.get(id), fingerprints[id]))
  fresh.forEach((id) => marks().finishWriting(id))
  arrived.push(...fresh)

  const { notify } = useUI.getState()
  if (!expected.length) return reset()
  if (arrived.length >= expected.length) {
    reset()
    notify(`Claude wrote ${arrived.length} ${arrived.length === 1 ? 'description' : 'descriptions'}. Check them in Review.`, 'success')
    return
  }

  let phase: ClaudeWritingPhase = s.phase
  let lastArrivalAt = s.lastArrivalAt
  if (fresh.length) {
    phase = 'writing'
    lastArrivalAt = now
  } else if (phase === 'waiting' && now - s.startedAt >= STALL_MS) {
    phase = 'stalled'
  } else if (phase === 'writing' && lastArrivalAt !== null && now - lastArrivalAt >= QUIET_MS) {
    useClaudeWriting.setState({ expected, arrived })
    reset()
    notify(`Claude wrote ${arrived.length} of ${expected.length} descriptions. Check them in Review.`, 'success')
    return
  }

  // The tiles show "Writing…" only while Claude may still be at it; a late draft brings the rest back.
  const left = expected.filter((id) => !arrived.includes(id))
  if (phase === 'stalled' && s.phase !== 'stalled') left.forEach((id) => marks().finishWriting(id))
  if (phase !== 'stalled' && s.phase === 'stalled') marks().startWriting(left)

  if (backfilled || !same(expected, s.expected) || !same(arrived, s.arrived) || phase !== s.phase || lastArrivalAt !== s.lastArrivalAt) {
    useClaudeWriting.setState({ expected, arrived, phase, lastArrivalAt, fingerprints })
  }
  schedule()
}

/**
 * The person copied the message or opened Claude: wait for these apps' drafts. No apps = nothing to wait for.
 * Starting again in the same workspace adds to the wait (a stalled one starts over); another workspace replaces it.
 */
export function startClaudeWriting({ workspaceId, projectIds, prompt }: { workspaceId: string | null; projectIds: string[]; prompt: string }) {
  const ids = [...new Set(projectIds)]
  if (!ids.length) return
  const now = Date.now()
  if (useClaudeWriting.getState().phase && useClaudeWriting.getState().workspaceId !== workspaceId) reset()
  const current = useClaudeWriting.getState()
  const running = current.phase !== null && current.phase !== 'stalled'
  const expected = [...new Set([...current.expected, ...ids])]
  // Each app is judged against the card it had when it was added; one already in the wait keeps its own.
  const byId = new Map(useStore.getState().projects.map((project) => [project.id, project]))
  const fingerprints = { ...current.fingerprints }
  ids.forEach((id) => { if (!current.expected.includes(id)) fingerprints[id] = fingerprint(byId.get(id)) })
  useClaudeWriting.setState({
    workspaceId,
    prompt,
    expected,
    fingerprints,
    arrived: current.arrived,
    startedAt: running ? current.startedAt : now,
    lastArrivalAt: running && current.lastArrivalAt !== null ? now : null,
    phase: running ? current.phase : 'waiting',
  })
  marks().startWriting(remaining(useClaudeWriting.getState()))
  check()
  schedule()
}

/** "Stop waiting", or anything else that ends the wait without Claude finishing. */
export function stopClaudeWriting() {
  reset()
}

// Watch the apps and the sign-in. Cheap when nothing is being waited for.
useStore.subscribe(() => { if (useClaudeWriting.getState().phase) check() })
useSession.subscribe(() => { if (useClaudeWriting.getState().phase) check() })

// A reload in the same tab picks the wait up again.
const resumed = useClaudeWriting.getState()
if (resumed.phase) {
  if (resumed.phase !== 'stalled') marks().startWriting(remaining(resumed))
  check()
  schedule()
}

// Tempo's Allow page copied the message for Claude (claudeHandoff.ts): start waiting in this tab, as if the person had
// copied it here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== PENDING_KEY || !event.newValue) return
    const pending = readPendingMessage()
    if (!pending?.copiedAt) return
    clearPendingMessage()
    startClaudeWriting({ workspaceId: pending.workspaceId, projectIds: pending.projectIds, prompt: pending.prompt })
  })
}
