// Anthropic Messages API adapter: plain fetch, structured output through one tool, browser-direct access header.
// Older models get a forced tool_choice. Sonnet 5.5, Opus 5.5 and Fable 5.1 reject that with a 400, so they get
// tool_choice auto + a strict tool (schema-valid arguments), low effort, and one retry if no tool call comes back.
import { AIError, LOCAL_ONLY_MESSAGE, fetchWithTimeout, localOnly, type Adapter, type ToolCall } from './adapterTypes'
import { TOOL_DESCRIPTIONS, type ToolName } from './schemas'
import type { AISettings } from '../types'

const BASE = 'https://api.anthropic.com/v1'
export const DEFAULT_MODEL = 'claude-sonnet-5-5'
export const anthropicModel = (settings: AISettings, _tool: ToolName) => settings.model ?? DEFAULT_MODEL

/** Parse an Anthropic response into the same recovery messages used by the connection UI. */
async function readAnthropicJson(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body

  const bodyText = JSON.stringify(body).toLowerCase()
  if (res.status === 401 || res.status === 403) throw new AIError("Claude didn't accept this key. Check it was copied in full.")
  if (res.status === 402 || (res.status === 429 && /insufficient[_ -]?quota|credit|billing|balance/.test(bodyText))) {
    throw new AIError('Your Claude account is out of credit.')
  }
  if (res.status === 429) throw new AIError('Claude is busy. Try again in a minute.')
  if (res.status >= 500) throw new AIError('Claude is having trouble right now. Try again shortly.')

  const message = typeof body?.error === 'string' ? body.error : body?.error?.message
  throw new AIError(message ? String(message) : `The AI request failed (${res.status}).`)
}

/** Models that answer a forced tool_choice with a 400. A newer model missing here is caught by the 400 and retried as auto. */
const AUTO_TOOL_MODELS = /^claude-(sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)\b/
export const forcesToolUse = (model: string) => !AUTO_TOOL_MODELS.test(model)

/** These models think before answering; thinking counts toward max_tokens, so leave room for it. */
const MAX_TOKENS = 4096
const MAX_TOKENS_THINKING = 16_000
/** Tempo's tools are extraction: low effort keeps thinking short, inside the 60 s timeout. */
const EFFORT = 'low'

/** Strict tool schemas reject these keywords (400). zod still enforces them on the answer (client.ts). */
const STRICT_UNSUPPORTED = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'])

export function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (STRICT_UNSUPPORTED.has(k) || (k === 'minItems' && Number(v) > 1)) continue
    // Keys under `properties` are field names, not keywords: keep them all.
    out[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([name, s]) => [name, strictSchema(s)])) : strictSchema(v)
  }
  return out
}

function messagesBody(call: ToolCall, schema: Record<string, unknown>, model: string, forced: boolean) {
  const tool = { name: call.tool, description: TOOL_DESCRIPTIONS[call.tool] }
  return {
    model,
    max_tokens: forced ? MAX_TOKENS : MAX_TOKENS_THINKING,
    system: call.system,
    messages: [{ role: 'user', content: call.user }],
    ...(forced
      ? { tools: [{ ...tool, input_schema: schema }], tool_choice: { type: 'tool', name: call.tool } }
      : { tools: [{ ...tool, input_schema: strictSchema(schema), strict: true }], tool_choice: { type: 'auto' }, output_config: { effort: EFFORT } }),
  }
}

type MessagesResponse = { content?: { type: string; input?: unknown }[]; stop_reason?: string; stop_details?: { category?: string | null } | null }

const toolUse = (body: MessagesResponse) => body.content?.find((b) => b.type === 'tool_use')

function headers(settings: AISettings): Record<string, string> {
  if (!settings.apiKey) throw new AIError('Add your Anthropic API key in Settings first.')
  return {
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  }
}

export const anthropicAdapter: Adapter = async (call, schema, settings) => {
  if (localOnly()) throw new AIError(LOCAL_ONLY_MESSAGE)
  const h = headers(settings)
  const model = anthropicModel(settings, call.tool)
  const send = async (user: string, forced: boolean): Promise<MessagesResponse> => {
    const body = JSON.stringify(messagesBody({ ...call, user }, schema, model, forced))
    return readAnthropicJson(await fetchWithTimeout(`${BASE}/messages`, { method: 'POST', headers: h, body }, call.timeoutMs))
  }

  let forced = forcesToolUse(model)
  let body: MessagesResponse
  try {
    body = await send(call.user, forced)
  } catch (e) {
    if (!forced || !(e instanceof AIError) || !/tool_choice/.test(e.message)) throw e
    forced = false
    body = await send(call.user, forced)
  }
  // auto doesn't guarantee a tool call: ask once more, naming the tool.
  if (!forced && !toolUse(body) && body.stop_reason === 'end_turn') body = await send(`${call.user}\n\nAnswer by calling the ${call.tool} tool.`, forced)

  if (body.stop_reason === 'refusal') {
    const category = body.stop_details?.category
    throw new AIError(`The model declined this request${category ? ` (${category})` : ''}. Try again, or pick another model in Settings.`)
  }
  if (body.stop_reason === 'max_tokens') throw new AIError('The AI answer was cut off. Try again.')
  const block = toolUse(body)
  if (!block) throw new AIError("The AI didn't answer in the expected format. Try again.")
  return block.input
}

export async function anthropicListModels(settings: AISettings): Promise<string[]> {
  if (localOnly()) throw new AIError(LOCAL_ONLY_MESSAGE)
  const res = await fetchWithTimeout(`${BASE}/models?limit=100`, { method: 'GET', headers: headers(settings) })
  const body = await readAnthropicJson(res)
  return ((body.data ?? []) as { id: string }[]).map((m) => m.id)
}
