// OpenAI-compatible adapter (OpenAI, Gemini, OpenRouter, Grok through OpenRouter, Groq, Ollama, custom): function calling over /chat/completions.
import { AIError, LOCAL_ONLY_MESSAGE, fetchWithTimeout, localOnly, type Adapter } from './adapterTypes'
import { PRESETS } from './presets'
import { TOOL_DESCRIPTIONS } from './schemas'
import type { AISettings } from '../types'

const presetFor = (settings: AISettings) => PRESETS.find((preset) => preset.id === settings.preset)
const providerName = (settings: AISettings) => presetFor(settings)?.panelLabel ?? 'AI provider'
const isOllama = (settings: AISettings) => settings.preset === 'ollama'

/** Parse an OpenAI-compatible response while keeping provider errors useful and consistent. */
async function readProviderJson(res: Response, settings: AISettings): Promise<any> {
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body

  const name = providerName(settings)
  const bodyText = JSON.stringify(body).toLowerCase()
  if (res.status === 401 || res.status === 403) throw new AIError(`${name} didn't accept this key. Check it was copied in full.`)
  if (res.status === 402 || (res.status === 429 && /insufficient[_ -]?quota|credit|billing|balance/.test(bodyText))) {
    throw new AIError(`Your ${name} account is out of credit.`)
  }
  if (res.status === 429) throw new AIError(`${name} is busy. Try again in a minute.`)
  if (res.status >= 500) throw new AIError(`${name} is having trouble right now. Try again shortly.`)

  const message = typeof body?.error === 'string' ? body.error : body?.error?.message
  throw new AIError(message ? String(message) : `The AI request failed (${res.status}).`)
}

async function providerFetch(url: string, init: RequestInit, settings: AISettings, timeoutMs?: number) {
  try {
    return await fetchWithTimeout(url, init, timeoutMs)
  } catch (error) {
    if (isOllama(settings) && error instanceof AIError && /couldn't reach/i.test(error.message)) {
      throw new AIError("Can't reach Ollama on this computer. Start it, then test again.")
    }
    throw error
  }
}

// Plain http is for a model running on this computer (Ollama and friends). Anywhere else it would carry the key and the repo notes in the clear.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function resolveBaseUrl(settings: AISettings): string {
  const preset = PRESETS.find((p) => p.id === settings.preset && p.id !== 'custom')
  const url = (preset ? preset.baseUrl : settings.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!url) throw new AIError('Enter the endpoint address in Settings first.')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AIError("That endpoint address isn't a valid web address. Use the full address, like https://provider.example/v1.")
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname))) {
    throw new AIError('Use an https:// address for the endpoint. Plain http:// would send your key and repo notes unencrypted; it is allowed only for models on this computer (localhost).')
  }
  return url
}

function authHeaders(settings: AISettings, withBody: boolean): Record<string, string> {
  const preset = presetFor(settings)
  if (preset?.needsKey && !settings.apiKey) throw new AIError(`Add your ${preset.label} API key in Settings first.`)
  const h: Record<string, string> = withBody ? { 'content-type': 'application/json' } : {}
  if (settings.apiKey) h.authorization = `Bearer ${settings.apiKey}`
  return h
}

/** Pull a JSON object out of model prose: fenced block, bare object, or the whole string. */
export function extractJson(text: string): unknown {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  const whole = tryParse(text.trim())
  if (whole !== undefined) return whole
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced) {
    const v = tryParse(fenced[1].trim())
    if (v !== undefined) return v
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? tryParse(text.slice(start, end + 1)) : undefined
}

export const openaiAdapter: Adapter = async (call, schema, settings) => {
  if (localOnly()) throw new AIError(LOCAL_ONLY_MESSAGE)
  const base = resolveBaseUrl(settings)
  const headers = authHeaders(settings, true)
  if (!settings.model) throw new AIError('Pick a model in Settings first.')
  const res = await providerFetch(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: call.system },
          { role: 'user', content: call.user },
        ],
        tools: [{ type: 'function', function: { name: call.tool, description: TOOL_DESCRIPTIONS[call.tool], parameters: schema } }],
        tool_choice: { type: 'function', function: { name: call.tool } },
      }),
    },
    settings,
    call.timeoutMs,
  )
  const body = await readProviderJson(res, settings)
  const msg = body.choices?.[0]?.message
  const args = msg?.tool_calls?.[0]?.function?.arguments
  if (typeof args === 'string') {
    const v = extractJson(args)
    if (v !== undefined) return v
  } else if (args && typeof args === 'object') return args
  if (typeof msg?.content === 'string') {
    const v = extractJson(msg.content)
    if (v !== undefined) return v
  }
  throw new AIError("The AI didn't answer in the expected format. Try again, or pick a model that supports tool calling.")
}

export async function openaiListModels(settings: AISettings): Promise<string[]> {
  if (localOnly()) throw new AIError(LOCAL_ONLY_MESSAGE)
  const res = await providerFetch(`${resolveBaseUrl(settings)}/models`, { method: 'GET', headers: authHeaders(settings, false) }, settings)
  const body = await readProviderJson(res, settings)
  return ((body.data ?? []) as { id: string }[]).map((m) => m.id).sort((a, b) => a.localeCompare(b))
}
