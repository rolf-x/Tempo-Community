import { aiMode } from '../lib/aiMode'
import type { AISettings, Settings } from '../types'

/**
 * The AI connection every screen should use.
 * In `mcp` mode the browser makes no AI calls, so Sync and Handover run the facts-only path.
 * Old imports and workspace switches must never enable sample text for a real app.
 */
export function workspaceAI(settings: Pick<Settings, 'ai' | 'demo'>): AISettings {
  if (aiMode() === 'mcp') return { ...settings.ai, provider: 'none' }
  return settings.ai.provider === 'demo' && !settings.demo
    ? { ...settings.ai, provider: 'none' }
    : settings.ai
}

/**
 * Does Tempo itself write the descriptions? True when the browser may call an AI (not `mcp` mode) and a real
 * connection is the default: an API key, or the dev-only local bridge. Sample mode's canned results don't count.
 */
export function canWriteCards(settings: Pick<Settings, 'ai' | 'demo'>): boolean {
  const provider = workspaceAI(settings).provider
  return provider !== 'none' && provider !== 'demo'
}
