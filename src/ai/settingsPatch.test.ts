import { describe, expect, it } from 'vitest'
import { switchPreset, switchProvider } from './settingsPatch'
import type { AISettings } from '../types'

const anthropic: AISettings = { provider: 'anthropic', preset: null, baseUrl: null, apiKey: 'sk-ant-secret', model: 'claude-sonnet-5-5' }

describe('AI settings patches (a key only ever goes to the provider it was entered for)', () => {
  it('switching provider drops the key and the model', () => {
    const p = switchProvider(anthropic, 'openai-compatible')
    expect(p.apiKey).toBeNull()
    expect(p.model).toBeNull()
    expect(p.preset).toBe('openai')
    expect(p.baseUrl).toBe('https://api.openai.com/v1')
  })
  it('re-selecting the same provider keeps the key', () => {
    expect(switchProvider(anthropic, 'anthropic')).toEqual({})
  })
  it('switching preset drops the key and sets the preset base URL', () => {
    const openai: AISettings = { provider: 'openai-compatible', preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-proj-x', model: 'gpt-x' }
    const p = switchPreset(openai, 'groq')
    expect(p.apiKey).toBeNull()
    expect(p.model).toBeNull()
    expect(p.baseUrl).toBe('https://api.groq.com/openai/v1')
    expect(switchPreset(openai, 'openai')).toEqual({})
  })
})
