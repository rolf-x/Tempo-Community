import { PANEL_PRESETS, type AIProviderId, type ProviderPreset } from '../../ai/presets'
import type { AISettings, Preset } from '../../types'

export { PANEL_PRESETS, type AIProviderId, type ProviderPreset }

export function providerIdFor(settings: AISettings): AIProviderId | null {
  if (settings.provider === 'anthropic') return 'claude'
  if (settings.provider === 'openai-compatible' && settings.preset) {
    // A preset that left the picker (Groq) shows as Custom, with its saved base URL and key intact.
    return PANEL_PRESETS.some((item) => item.id === settings.preset) ? settings.preset : 'custom'
  }
  return null
}

export function settingsForProvider(id: AIProviderId): AISettings {
  const preset = PANEL_PRESETS.find((item) => item.id === id)!
  if (id === 'claude') return { provider: 'anthropic', preset: null, baseUrl: null, apiKey: null, model: null }
  return {
    provider: 'openai-compatible',
    preset: id as Preset,
    baseUrl: preset.baseUrl || null,
    apiKey: null,
    model: null,
  }
}

const PREFERRED: Partial<Record<AIProviderId, RegExp[]>> = {
  claude: [/sonnet-5-5/i, /sonnet/i],
  openai: [/^gpt-5(?:$|[.-])/i, /^gpt-4\.1(?:$|[.-])/i, /gpt.*mini/i],
  gemini: [/gemini.*pro/i, /gemini/i],
  openrouter: [/claude.*sonnet/i, /gpt-5/i, /gemini.*pro/i],
  grok: [/x-ai\/grok-4(?!.*(?:mini|fast))/i, /x-ai\/grok-4/i, /x-ai\/grok/i],
  groq: [/70b.*versatile/i, /llama.*70b/i, /mixtral/i],
}

/** The Grok tile reads OpenRouter's catalogue, so it lists only xAI's models. */
export function modelsFor(id: AIProviderId, models: string[]): string[] {
  if (id !== 'grok') return models
  const grok = models.filter((model) => /^x-ai\//i.test(model))
  return grok.length ? grok : models
}

/** Pick a useful account model without assuming every provider exposes the same names. */
export function recommendedModel(id: AIProviderId, models: string[]): string | null {
  for (const pattern of PREFERRED[id] ?? []) {
    const match = models.find((model) => pattern.test(model))
    if (match) return match
  }
  return models[0] ?? null
}
