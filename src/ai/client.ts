// AI client: one entry point for every provider. Every result is zod-validated;
// a failed validation is retried once with the error, then surfaces as an AIError.
import { TOOLS, toJsonSchema, type ToolName, type ToolOutput } from './schemas'
import { AIError, DEFAULT_TIMEOUT_MS, fetchWithTimeout, localOnly, type Adapter, type ToolCall } from './adapterTypes'
import { anthropicAdapter, anthropicListModels, anthropicModel } from './anthropic'
import { openaiAdapter, openaiListModels } from './openaiCompatible'
import { syncAppSystem, syncAppUser } from './prompts'
import { explainAIError } from './errors'
import type { AISettings, Provider } from '../types'
import { todayISO } from '../lib/dates'

export { AIError, type ToolCall, type AISettings, type Provider }
export { PRESETS, type ProviderPreset } from './presets'

export type AIErrorKind = 'key-rejected' | 'out-of-credit' | 'rate-limited' | 'ollama-unreachable' | 'other'

/** Turns the adapter's plain message into a UI recovery path without exposing provider response bodies. */
export function aiErrorKind(message: string): AIErrorKind {
  if (/didn't accept this key/i.test(message)) return 'key-rejected'
  if (/out of credit/i.test(message)) return 'out-of-credit'
  if (/busy\. Try again in a minute/i.test(message)) return 'rate-limited'
  if (/can't reach Ollama/i.test(message)) return 'ollama-unreachable'
  return 'other'
}

const localAdapter: Adapter = async (call, schema, settings) => {
  const res = await fetchWithTimeout(
    '/api/claude',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: call.system, user: call.user, schema, model: settings.model ?? undefined }),
    },
    call.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; error?: string }
  if (!res.ok) throw new AIError(body.error ?? `Local bridge error ${res.status}`)
  return body.data
}

const noNetwork: Adapter = async () => {
  throw new AIError('No AI connected. Pick your AI in Settings.') // sample results come from demo.ts via the router
}

const ADAPTERS: Record<Provider, Adapter> = {
  none: noNetwork,
  local: localAdapter,
  anthropic: anthropicAdapter,
  'openai-compatible': openaiAdapter,
  demo: noNetwork,
}

// Only real providers use the testing bridge; disconnected and sample modes stay offline.
const lockedToLocal = (settings: AISettings) => localOnly() && settings.provider !== 'demo' && settings.provider !== 'none'

export async function callTool<T extends ToolName>(call: ToolCall<T>, settings: AISettings): Promise<ToolOutput<T>> {
  const schema = toJsonSchema(call.tool)
  const adapter = lockedToLocal(settings) ? localAdapter : ADAPTERS[settings.provider]
  let user = call.user
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await adapter({ ...call, user }, schema, settings)
    const parsed = TOOLS[call.tool].safeParse(raw)
    if (parsed.success) return parsed.data as ToolOutput<T>
    lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    user = `${call.user}\n\nYour last answer was invalid: ${lastError}. Answer again, following the schema exactly.`
  }
  throw new AIError(`The AI answer didn't match the expected shape (${lastError}).`)
}

const LOCAL_MODELS = ['sonnet', 'haiku', 'opus']

export async function listModels(settings: AISettings): Promise<string[]> {
  if (lockedToLocal(settings)) return [...LOCAL_MODELS] // no /models call to a paid provider
  switch (settings.provider) {
    case 'anthropic':
      return anthropicListModels(settings)
    case 'openai-compatible':
      return openaiListModels(settings)
    case 'local':
      return [...LOCAL_MODELS]
    default:
      return []
  }
}

export type ConnectionResult = { ok: true; ms: number; model: string } | { ok: false; error: string; details?: string }

/** Runs a tiny card-writing call and validates the answer. Never throws. */
export async function testConnection(settings: AISettings): Promise<ConnectionResult> {
  if (settings.provider === 'none') return { ok: false, error: 'No AI connected. Pick your AI in Settings.' }
  if (settings.provider === 'demo') return { ok: true, ms: 0, model: 'demo' }
  const started = Date.now()
  const today = todayISO()
  try {
    await callTool({
      tool: 'sync_app',
      system: syncAppSystem({ today }),
      user: syncAppUser({ project: { name: 'Test app' }, repo: { description: 'Connection check' } }),
    }, settings)
    const model = lockedToLocal(settings)
      ? (LOCAL_MODELS.includes(settings.model ?? '') ? settings.model! : 'sonnet')
      : settings.provider === 'anthropic' ? anthropicModel(settings, 'sync_app') : (settings.model ?? (settings.provider === 'local' ? 'sonnet' : ''))
    return { ok: true, ms: Date.now() - started, model }
  } catch (e) {
    const copy = explainAIError(e, settings.provider)
    return { ok: false, error: e instanceof Error ? e.message : 'Connection failed.', details: copy.details }
  }
}
