import { describe, expect, it } from 'vitest'
import { PANEL_PRESETS, modelsFor, providerIdFor, recommendedModel, settingsForProvider } from './providerSettings'

describe('AI panel provider settings', () => {
  it('uses the key-guide order', () => {
    expect(PANEL_PRESETS.map((preset) => preset.id)).toEqual(['claude', 'openai', 'gemini', 'grok', 'openrouter', 'ollama', 'custom'])
  })

  it('maps Claude and compatible providers to stored settings', () => {
    expect(settingsForProvider('claude')).toMatchObject({ provider: 'anthropic', preset: null })
    expect(settingsForProvider('gemini')).toMatchObject({
      provider: 'openai-compatible',
      preset: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    })
    expect(providerIdFor(settingsForProvider('openrouter'))).toBe('openrouter')
  })

  it('picks a recommended account model and falls back to the first', () => {
    expect(recommendedModel('openai', ['gpt-4o-mini', 'gpt-5.2', 'gpt-4.1'])).toBe('gpt-5.2')
    expect(recommendedModel('claude', ['claude-haiku-4-5', 'claude-sonnet-5-5'])).toBe('claude-sonnet-5-5')
    expect(recommendedModel('ollama', ['qwen3', 'llama3.1'])).toBe('qwen3')
    expect(recommendedModel('custom', [])).toBeNull()
  })

  it('runs Grok through OpenRouter and lists only xAI models', () => {
    expect(settingsForProvider('grok')).toMatchObject({ provider: 'openai-compatible', preset: 'grok', baseUrl: 'https://openrouter.ai/api/v1' })
    const catalogue = ['anthropic/claude-sonnet-5-5', 'x-ai/grok-4-fast', 'x-ai/grok-4.7', 'openai/gpt-5.2']
    expect(modelsFor('grok', catalogue)).toEqual(['x-ai/grok-4-fast', 'x-ai/grok-4.7'])
    expect(modelsFor('openrouter', catalogue)).toEqual(catalogue)
    expect(recommendedModel('grok', modelsFor('grok', catalogue))).toBe('x-ai/grok-4.7')
  })

  it('shows a saved preset that left the picker (Groq) as Custom, settings untouched', () => {
    const groq = { provider: 'openai-compatible' as const, preset: 'groq' as const, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'm' }
    expect(providerIdFor(groq)).toBe('custom')
  })
})
