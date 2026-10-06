// Settings patches for the AI connection card. A key only ever goes to the provider it was entered
// for, so any change of provider or preset drops the key (and the model, which is provider-specific).
import type { AISettings, Preset, Provider } from '../types'
import { PRESETS } from './presets'

export function switchProvider(ai: AISettings, next: Provider): Partial<AISettings> {
  if (next === ai.provider) return {}
  if (next === 'openai-compatible') {
    const preset = PRESETS[0]
    return { provider: next, preset: preset.id as Preset, baseUrl: preset.baseUrl, apiKey: null, model: null }
  }
  return { provider: next, preset: null, baseUrl: null, apiKey: null, model: null }
}

export function switchPreset(ai: AISettings, id: Preset): Partial<AISettings> {
  if (id === ai.preset) return {}
  const preset = PRESETS.find((p) => p.id === id)
  return { preset: id, baseUrl: preset?.baseUrl || null, apiKey: null, model: null }
}
