import { afterEach, describe, expect, it, vi } from 'vitest'
import { canWriteCards, workspaceAI } from '../ai/workspaceAI'
import type { Settings } from '../types'
import { aiMode, mcpEnabled, parseAIMode } from './aiMode'

const settings = (provider: Settings['ai']['provider'], demo = false): Pick<Settings, 'ai' | 'demo'> => ({
  ai: { provider, preset: null, baseUrl: null, apiKey: 'key', model: null },
  demo,
})

afterEach(() => vi.unstubAllEnvs())

describe('parseAIMode', () => {
  it('knows the three modes', () => {
    expect(parseAIMode('legacy')).toBe('legacy')
    expect(parseAIMode('both')).toBe('both')
    expect(parseAIMode('mcp')).toBe('mcp')
  })

  it('forgives case and stray whitespace from a pasted env value', () => {
    expect(parseAIMode(' MCP\n')).toBe('mcp')
  })

  it('treats anything unknown as legacy, so a typo never turns the AI key off', () => {
    for (const value of [undefined, null, '', 'on', 'mcp-only', 'true', 1, {}]) expect(parseAIMode(value)).toBe('legacy')
  })
})

describe('aiMode', () => {
  it('reads VITE_AI_MODE', () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    expect(aiMode()).toBe('both')
    vi.stubEnv('VITE_AI_MODE', 'nonsense')
    expect(aiMode()).toBe('legacy')
  })
})

describe('mcpEnabled', () => {
  it('is on in both and mcp, off in legacy and for anything unknown', () => {
    const by = (value: string | undefined) => {
      if (value === undefined) vi.stubEnv('VITE_AI_MODE', '')
      else vi.stubEnv('VITE_AI_MODE', value)
      return mcpEnabled()
    }
    expect(by('mcp')).toBe(true)
    expect(by('both')).toBe(true)
    expect(by('legacy')).toBe(false)
    expect(by('nonsense')).toBe(false)
    expect(by(undefined)).toBe(false)
  })

  it('differs from "no browser AI at all", which is mcp alone', () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    expect(mcpEnabled()).toBe(true)
    expect(aiMode() === 'mcp').toBe(false)
  })
})

describe('canWriteCards', () => {
  it('is true for a saved key in legacy and both modes', () => {
    for (const mode of ['legacy', 'both']) {
      vi.stubEnv('VITE_AI_MODE', mode)
      expect(canWriteCards(settings('anthropic'))).toBe(true)
      expect(canWriteCards(settings('openai-compatible'))).toBe(true)
    }
  })

  it('is false with no key, with sample text for a real app, and in mcp mode', () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    expect(canWriteCards(settings('none'))).toBe(false)
    expect(canWriteCards(settings('demo'))).toBe(false)
    expect(canWriteCards(settings('demo', true))).toBe(false)
    vi.stubEnv('VITE_AI_MODE', 'mcp')
    expect(canWriteCards(settings('anthropic'))).toBe(false)
  })
})

describe('workspaceAI by mode', () => {
  it('keeps the connection in legacy and both modes', () => {
    for (const mode of ['legacy', 'both']) {
      vi.stubEnv('VITE_AI_MODE', mode)
      expect(workspaceAI(settings('anthropic')).provider).toBe('anthropic')
    }
  })

  it('still turns off sample text for a real app outside demo mode', () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    expect(workspaceAI(settings('demo')).provider).toBe('none')
  })

  it('returns provider none in mcp mode, so Sync and Handover run the facts-only path', () => {
    vi.stubEnv('VITE_AI_MODE', 'mcp')
    for (const provider of ['anthropic', 'openai-compatible', 'local', 'demo', 'none'] as const) {
      expect(workspaceAI(settings(provider, true)).provider).toBe('none')
    }
  })
})
