import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicAdapter, anthropicListModels, forcesToolUse, strictSchema } from './anthropic'
import { AIError, type AISettings } from './client'
import { toJsonSchema } from './schemas'
import { hangingFetch, jsonRes, mockFetch, rejection } from './testFetch'

const settings = (over: Partial<AISettings> = {}): AISettings => ({ provider: 'anthropic', preset: null, baseUrl: null, apiKey: 'sk-ant-test', model: null, ...over })
const call = { tool: 'sync_app' as const, system: 'SYS', user: 'USER' }
const schema = { type: 'object', properties: { card: { type: 'object' } } }
const ok = (input: unknown) => jsonRes({ content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'tu_1', name: 'sync_app', input }], stop_reason: 'tool_use' })
const noTool = (stop_reason = 'end_turn') => jsonRes({ content: [{ type: 'text', text: 'Here is the card…' }], stop_reason })
const sent = (f: ReturnType<typeof mockFetch>, i = 0) => JSON.parse(f.mock.calls[i][1].body as string)
const FORCED_MODEL = 'claude-haiku-4-5-20251001'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('forcesToolUse', () => {
  it.each(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-sonnet-5-5-20261001'])('%s rejects forced tool use', (m) => {
    expect(forcesToolUse(m)).toBe(false)
  })
  it.each(['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-3-5-haiku-latest'])('%s still accepts it', (m) => {
    expect(forcesToolUse(m)).toBe(true)
  })
})

describe('strictSchema', () => {
  it('drops the keywords strict tools reject and keeps the rest', () => {
    const out = strictSchema(toJsonSchema('sync_app')) as any
    const text = JSON.stringify(out)
    expect(text).not.toMatch(/"(minLength|maxLength|minimum|maximum|multipleOf)"/)
    expect(out.additionalProperties).toBe(false)
    expect(out.properties.card.properties.stage.enum).toEqual(['idea', 'building', 'live', 'stale'])
  })
  it('keeps a property that happens to be called "minimum"', () => {
    const out = strictSchema({ type: 'object', properties: { minimum: { type: 'integer', minimum: 0 } }, required: ['minimum'], additionalProperties: false }) as any
    expect(out.properties.minimum).toEqual({ type: 'integer' })
    expect(out.required).toEqual(['minimum'])
  })
  it('drops minItems above 1 only', () => {
    expect(strictSchema({ type: 'array', minItems: 3 })).toEqual({ type: 'array' })
    expect(strictSchema({ type: 'array', minItems: 1 })).toEqual({ type: 'array', minItems: 1 })
  })
  it('every tool schema stays within the strict limits (≤16 union-typed params, ≤24 optional params)', () => {
    for (const name of ['sync_app', 'handover'] as const) {
      let unions = 0
      let optional = 0
      const walk = (n: any) => {
        if (!n || typeof n !== 'object') return
        if (n.type === 'object' && n.properties) {
          for (const [k, p] of Object.entries<any>(n.properties)) {
            if (p.anyOf || Array.isArray(p.type)) unions++
            if (!(n.required ?? []).includes(k)) optional++
          }
        }
        Object.values(n).forEach(walk)
      }
      walk(strictSchema(toJsonSchema(name)))
      expect(unions, name).toBeLessThanOrEqual(16)
      expect(optional, name).toBeLessThanOrEqual(24)
    }
  })
})

describe('anthropicAdapter', () => {
  it('posts to /v1/messages with the browser-direct headers and forced tool use on models that allow it', async () => {
    const f = mockFetch(ok({ subtasks: ['a'], estimateMins: null }))
    const out = await anthropicAdapter(call, schema, settings({ model: FORCED_MODEL }))
    expect(out).toEqual({ subtasks: ['a'], estimateMins: null })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      model: FORCED_MODEL,
      max_tokens: 4096,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      tool_choice: { type: 'tool', name: 'sync_app' },
    })
    expect(body.tools).toEqual([{ name: 'sync_app', description: expect.any(String), input_schema: schema }])
    expect(body.output_config).toBeUndefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('default model (Sonnet 5.5): auto tool choice, a strict tool, low effort and room for thinking', async () => {
    const f = mockFetch(ok({ subtasks: ['a'], estimateMins: null }))
    const full = toJsonSchema('sync_app')
    expect(await anthropicAdapter(call, full, settings())).toEqual({ subtasks: ['a'], estimateMins: null })
    const body = sent(f)
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 16000,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'low' },
    })
    expect(body.tools).toEqual([{ name: 'sync_app', description: expect.any(String), input_schema: strictSchema(full), strict: true }])
    expect(body.thinking).toBeUndefined()
  })
  it('auto: no tool call -> asks once more, naming the tool', async () => {
    const f = mockFetch(noTool(), ok({ subtasks: ['b'], estimateMins: 30 }))
    expect(await anthropicAdapter(call, schema, settings())).toEqual({ subtasks: ['b'], estimateMins: 30 })
    expect(f).toHaveBeenCalledTimes(2)
    expect(sent(f, 1).messages[0].content).toBe('USER\n\nAnswer by calling the sync_app tool.')
  })
  it('auto: still no tool call after the retry -> AIError', async () => {
    const f = mockFetch(noTool(), noTool())
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow(/expected format/)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('a model this list does not know yet that rejects forced tool use -> switches to auto once', async () => {
    const f = mockFetch(
      jsonRes({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }, 400),
      ok({ subtasks: ['c'], estimateMins: null }),
    )
    expect(await anthropicAdapter(call, schema, settings({ model: 'claude-sonnet-6' }))).toEqual({ subtasks: ['c'], estimateMins: null })
    expect(sent(f, 0).tool_choice).toEqual({ type: 'tool', name: 'sync_app' })
    expect(sent(f, 1).tool_choice).toEqual({ type: 'auto' })
    expect(sent(f, 1).tools[0].strict).toBe(true)
  })
  it('refusal -> AIError naming the category, even with a tool call present', async () => {
    mockFetch(jsonRes({ content: [{ type: 'tool_use', id: 'tu_1', name: 'sync_app', input: {} }], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } }))
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow(/declined.*cyber/)
  })
  it('max_tokens -> AIError, no partial tool input', async () => {
    mockFetch(jsonRes({ content: [{ type: 'tool_use', id: 'tu_1', name: 'sync_app', input: { subtasks: ['a'] } }], stop_reason: 'max_tokens' }))
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow(/cut off/)
  })
  it('reads the tool call by type when thinking blocks come first', async () => {
    mockFetch(jsonRes({ content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'tu_1', name: 'sync_app', input: { subtasks: ['a'], estimateMins: null } }], stop_reason: 'tool_use' }))
    expect(await anthropicAdapter(call, schema, settings())).toEqual({ subtasks: ['a'], estimateMins: null })
  })
  it('uses the chosen model for everything', async () => {
    const f = mockFetch(ok({}))
    await anthropicAdapter(call, schema, settings({ model: 'claude-opus-4' }))
    expect(JSON.parse(f.mock.calls[0][1].body as string).model).toBe('claude-opus-4')
  })
  it('missing key -> friendly error, no request', async () => {
    const f = mockFetch(ok({}))
    await expect(anthropicAdapter(call, schema, settings({ apiKey: null }))).rejects.toThrow(/API key/)
    expect(f).not.toHaveBeenCalled()
  })
  it.each([
    [401, "Claude didn't accept this key. Check it was copied in full."],
    [403, "Claude didn't accept this key. Check it was copied in full."],
    [429, 'Claude is busy. Try again in a minute.'],
    [500, 'Claude is having trouble right now. Try again shortly.'],
    [529, 'Claude is having trouble right now. Try again shortly.'],
  ])('maps HTTP %i to a friendly AIError', async (status, message) => {
    mockFetch(jsonRes({ error: { message: 'raw upstream text' } }, status))
    const err = await rejection(anthropicAdapter(call, schema, settings()))
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toBe(message)
  })
  it.each([
    [402, { error: { message: 'payment required' } }],
    [429, { error: { type: 'insufficient_quota' } }],
    [429, { error: { message: 'Your credit balance is too low' } }],
  ])('maps credit response %i to out of credit', async (status, body) => {
    mockFetch(jsonRes(body, status))
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow('Your Claude account is out of credit.')
  })
  it('other 4xx surfaces the provider message', async () => {
    mockFetch(jsonRes({ error: { message: 'model: not found' } }, 404))
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow(/model: not found/)
  })
  it('no tool_use block on a forced model -> AIError, no retry', async () => {
    const f = mockFetch(jsonRes({ content: [{ type: 'text', text: 'sorry' }], stop_reason: 'end_turn' }))
    await expect(anthropicAdapter(call, schema, settings({ model: FORCED_MODEL }))).rejects.toBeInstanceOf(AIError)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('network failure -> AIError', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow(/reach|connection|network/i)
  })
  it('aborts after 60 s', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const p = rejection(anthropicAdapter(call, schema, settings()))
    await vi.advanceTimersByTimeAsync(60_000)
    const err = await p
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toMatch(/too long|timed out/i)
  })
})

describe('anthropicListModels', () => {
  it('GETs /v1/models with the same headers and returns ids', async () => {
    const f = mockFetch(jsonRes({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-4-5-20251001' }] }))
    expect(await anthropicListModels(settings())).toEqual(['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'])
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/)
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' })
  })
  it('401 -> friendly error', async () => {
    mockFetch(jsonRes({}, 401))
    await expect(anthropicListModels(settings())).rejects.toThrow(/key/i)
  })
})

describe('testing lock (VITE_AI_LOCAL_ONLY=1)', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('the adapter and the model list refuse without touching the network', async () => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', '1')
    const f = mockFetch(ok({ subtasks: [] }))
    await expect(anthropicAdapter(call, schema, settings())).rejects.toThrow(/switched off/)
    await expect(anthropicListModels(settings())).rejects.toThrow(/switched off/)
    expect(f).not.toHaveBeenCalled()
  })
})
