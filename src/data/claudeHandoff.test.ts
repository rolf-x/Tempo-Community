import { beforeEach, describe, expect, it } from 'vitest'
import { clearPendingMessage, markPendingCopied, PENDING_FOR_MS, PENDING_KEY, readPendingMessage, savePendingMessage } from './claudeHandoff'

const items = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) },
})

const message = { prompt: 'Use Tempo to draft the app cards for "Billing".', workspaceId: 'ws1', projectIds: ['p1', 'p2'] }

describe('the message kept for the Allow page', () => {
  beforeEach(() => items.clear())

  it('keeps the message until it expires', () => {
    savePendingMessage(message, 1_000)
    expect(readPendingMessage(1_000 + PENDING_FOR_MS - 1)).toEqual({ ...message, savedAt: 1_000 })
    expect(readPendingMessage(1_000 + PENDING_FOR_MS)).toBeNull()
    expect(readPendingMessage(999)).toBeNull() // saved "in the future": a clock that jumped
  })

  it('marks it copied for the Tempo tab, and clears it', () => {
    savePendingMessage(message, 1_000)
    markPendingCopied(readPendingMessage(2_000)!, 3_000)
    expect(readPendingMessage(4_000)).toEqual({ ...message, savedAt: 1_000, copiedAt: 3_000 })
    clearPendingMessage()
    expect(items.has(PENDING_KEY)).toBe(false)
  })

  it('ignores anything that is not a whole message', () => {
    for (const raw of ['not json', '{}', JSON.stringify({ ...message, prompt: '' }), JSON.stringify({ ...message, projectIds: [] }),
      JSON.stringify({ ...message, prompt: 'x'.repeat(4001), savedAt: 1 }), JSON.stringify({ ...message, workspaceId: 7, savedAt: 1 })]) {
      items.set(PENDING_KEY, raw)
      expect(readPendingMessage(2), raw).toBeNull()
    }
  })

  it('gives up quietly when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    const saved = globalThis.localStorage
    Object.assign(globalThis, { localStorage: blocked })
    try {
      expect(() => savePendingMessage(message)).not.toThrow()
      expect(readPendingMessage()).toBeNull()
      expect(() => clearPendingMessage()).not.toThrow()
    } finally {
      Object.assign(globalThis, { localStorage: saved })
    }
  })
})
