// Saved API connections (Settings → API keys). Several can be saved; the default one is copied into Settings.ai, which
// every AI call reads, so nothing that calls the AI needs to know there is a list. Pure.
import { PRESETS } from './presets'
import type { AISettings, SavedAIConnection, Settings } from '../types'

type ConnectionSettings = Pick<Settings, 'ai' | 'aiConnections' | 'aiDefaultId'>

const NONE: AISettings = { provider: 'none', preset: null, baseUrl: null, apiKey: null, model: null }

/** A provider that is saved as a connection: one with an endpoint (and usually a key). Local, demo and none are not. */
export const isSavable = (ai: AISettings): boolean => ai.provider === 'anthropic' || ai.provider === 'openai-compatible'

export const savedConnections = (settings: ConnectionSettings): SavedAIConnection[] => settings.aiConnections ?? []

export const defaultConnection = (settings: ConnectionSettings): SavedAIConnection | null =>
  savedConnections(settings).find((item) => item.id === settings.aiDefaultId) ?? null

/** "Claude", "OpenAI", "Custom endpoint"…: the provider's name from its preset. */
export function connectionName(ai: AISettings): string {
  if (ai.provider === 'anthropic') return 'Claude'
  return PRESETS.find((preset) => preset.id === ai.preset)?.label ?? 'Custom endpoint'
}

/**
 * Adds a connection, or replaces the one with `id`. It becomes the default when asked, or when nothing is the default
 * yet. Editing the default keeps Settings.ai in step.
 */
export function saveConnection(settings: ConnectionSettings, ai: AISettings, options: { id?: string; makeDefault?: boolean; newId: () => string; now: string }): ConnectionSettings & { id: string } {
  const list = savedConnections(settings)
  const existing = options.id ? list.find((item) => item.id === options.id) : undefined
  const id = existing?.id ?? options.newId()
  const saved: SavedAIConnection = { id, ai, savedAt: existing?.savedAt ?? options.now }
  const aiConnections = existing ? list.map((item) => (item.id === id ? saved : item)) : [...list, saved]
  const becomesDefault = options.makeDefault || settings.aiDefaultId === id || !defaultConnection(settings)
  return becomesDefault
    ? { ai, aiConnections, aiDefaultId: id, id }
    : { ai: settings.ai, aiConnections, aiDefaultId: settings.aiDefaultId ?? null, id }
}

export function makeDefault(settings: ConnectionSettings, id: string): ConnectionSettings {
  const chosen = savedConnections(settings).find((item) => item.id === id)
  return chosen ? { ai: chosen.ai, aiConnections: savedConnections(settings), aiDefaultId: id } : settings
}

/** Removes a connection. Removing the default makes the oldest one left the default, or turns AI off. */
export function removeConnection(settings: ConnectionSettings, id: string): ConnectionSettings {
  const aiConnections = savedConnections(settings).filter((item) => item.id !== id)
  if (settings.aiDefaultId !== id) return { ai: settings.ai, aiConnections, aiDefaultId: settings.aiDefaultId ?? null }
  const next = aiConnections[0]
  return next ? { ai: next.ai, aiConnections, aiDefaultId: next.id } : { ai: NONE, aiConnections, aiDefaultId: null }
}

/** For copies saved before the list existed: the one keyed connection becomes the first saved one, as the default. */
export function migrateConnections(settings: ConnectionSettings, newId: () => string, now: string): ConnectionSettings {
  if (settings.aiConnections) return settings
  if (!isSavable(settings.ai)) return { ...settings, aiConnections: [], aiDefaultId: null }
  const id = newId()
  return { ai: settings.ai, aiConnections: [{ id, ai: settings.ai, savedAt: now }], aiDefaultId: id }
}
