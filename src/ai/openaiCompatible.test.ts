import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractJson, openaiAdapter, openaiListModels, resolveBaseUrl } from './openaiCompatible'
import { PRESETS } from './presets'
import { AIError, type AISettings } from './client'
import { hangingFetch, jsonRes, mockFetch, rejection } from './testFetch'

const settings = (over: Partial<AISettings> = {}): AISettings => ({ provider: 'openai-compatible', preset: 'openai', baseUrl: null, apiKey: 'sk-test', model: 'gpt-x', ...over })
const call = { tool: 'sync_app' as const, system: 'SYS', user: 'USER' }
const schema = { type: 'object' }
const toolRes = (args: string) => jsonRes({ choices: [{ message: { content: null, tool_calls: [{ type: 'function', function: { name: 'sync_app', arguments: args } }] } }] })
const textRes = (content: string) => jsonRes({ choices: [{ message: { content } }] })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PRESETS', () => {
  it('has the seven panel providers with the key-guide links and notes', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['openai', 'claude', 'gemini', 'openrouter', 'grok', 'groq', 'ollama', 'custom'])
    const by = Object.fromEntries(PRESETS.map((p) => [p.id, p]))
    expect(by.openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(by.gemini.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(by.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(by.groq.baseUrl).toBe('https://api.groq.com/openai/v1')
    expect(by.ollama.baseUrl).toBe('http://localhost:11434/v1')
    expect(by.ollama.needsKey).toBe(false)
    expect(by.custom.needsKey).toBe(true)
    expect(by.openai.needsKey).toBe(true)
    expect(by.claude.keyUrl).toBe('https://platform.claude.com/settings/keys')
    expect(by.claude.billingUrl).toBe('https://platform.claude.com/settings/billing')
    expect(by.openai.keyUrl).toBe('https://platform.openai.com/api-keys')
    expect(by.openai.billingUrl).toBe('https://platform.openai.com/settings/organization/billing/overview')
    expect(by.gemini.keyUrl).toBe('https://aistudio.google.com/api-keys')
    expect(by.gemini.billingUrl).toBe('https://aistudio.google.com/projects')
    expect(by.openrouter.billingUrl).toBe('https://openrouter.ai/settings/credits')
    expect(by.groq.billingUrl).toBe('https://console.groq.com/settings/billing')
    expect(by.ollama.keyUrl).toBe('https://ollama.com/download')
    for (const p of PRESETS) expect(p.goodToKnow).toBeTruthy()
  })
})

describe('resolveBaseUrl', () => {
  it('preset wins, custom uses the user value minus trailing slashes', () => {
    expect(resolveBaseUrl(settings({ preset: 'groq' }))).toBe('https://api.groq.com/openai/v1')
    expect(resolveBaseUrl(settings({ preset: 'custom', baseUrl: 'https://x.test/v1//' }))).toBe('https://x.test/v1')
  })
  it('custom with no URL -> AIError', () => {
    expect(() => resolveBaseUrl(settings({ preset: 'custom', baseUrl: ' ' }))).toThrow(AIError)
  })
  it('no preset but a baseUrl -> treated as custom', () => expect(resolveBaseUrl(settings({ preset: null, baseUrl: 'https://y.test/v1' }))).toBe('https://y.test/v1'))
  it('accepts https anywhere and http only for this computer', () => {
    for (const baseUrl of ['https://x.test/v1', 'HTTPS://X.TEST/v1', 'http://localhost:11434/v1', 'http://127.0.0.1:8080/v1/', 'http://[::1]:1234/v1', 'https://localhost/v1']) {
      expect(() => resolveBaseUrl(settings({ preset: 'custom', baseUrl })), baseUrl).not.toThrow()
    }
  })
  it('refuses plain http to any other host with a clear message', () => {
    for (const baseUrl of ['http://x.test/v1', 'http://192.168.1.20:11434/v1', 'http://localhost.evil.test/v1', 'http://127.0.0.1.evil.test/v1', 'http://[::2]/v1']) {
      expect(() => resolveBaseUrl(settings({ preset: 'custom', baseUrl })), baseUrl).toThrow(/Use an https:\/\/ address.*localhost/)
    }
  })
  it('refuses other schemes and text that is not an address', () => {
    for (const baseUrl of ['ftp://x.test/v1', 'javascript:alert(1)', 'file:///tmp/x', 'x.test/v1', 'not a url']) {
      expect(() => resolveBaseUrl(settings({ preset: 'custom', baseUrl })), baseUrl).toThrow(AIError)
    }
    expect(() => resolveBaseUrl(settings({ preset: 'custom', baseUrl: 'x.test/v1' }))).toThrow(/valid web address/)
  })
  it('every preset still resolves', () => {
    for (const p of PRESETS.filter((x) => x.id !== 'custom' && x.provider === 'openai-compatible')) {
      expect(() => resolveBaseUrl(settings({ preset: p.id as AISettings['preset'] })), p.id).not.toThrow()
    }
  })
})

describe('extractJson', () => {
  it('fenced block', () => expect(extractJson('Here:\n```json\n{"a":1}\n```\nbye')).toEqual({ a: 1 }))
  it('bare object amid prose', () => expect(extractJson('sure {"a":{"b":[1,2]}} done')).toEqual({ a: { b: [1, 2] } }))
  it('plain JSON', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }))
  it('nothing -> undefined', () => expect(extractJson('no json here')).toBeUndefined())
})

describe('openaiAdapter', () => {
  it('posts to {baseUrl}/chat/completions with forced function tool and bearer key', async () => {
    const f = mockFetch(toolRes('{"title":"x"}'))
    const out = await openaiAdapter(call, schema, settings())
    expect(out).toEqual({ title: 'x' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test', 'content-type': 'application/json' })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-x')
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }])
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'sync_app', description: expect.any(String), parameters: schema } }])
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'sync_app' } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('falls back to JSON in message.content (fenced)', async () => {
    mockFetch(textRes('```json\n{"title":"y"}\n```'))
    expect(await openaiAdapter(call, schema, settings())).toEqual({ title: 'y' })
  })
  it('falls back to bare JSON in content when arguments are broken', async () => {
    mockFetch(jsonRes({ choices: [{ message: { content: 'ok {"title":"z"}', tool_calls: [{ function: { name: 'sync_app', arguments: '{oops' } }] } }] }))
    expect(await openaiAdapter(call, schema, settings())).toEqual({ title: 'z' })
  })
  it('nothing usable -> AIError', async () => {
    mockFetch(textRes('I cannot do that'))
    await expect(openaiAdapter(call, schema, settings())).rejects.toBeInstanceOf(AIError)
  })
  it('ollama works without a key and sends no Authorization header', async () => {
    const f = mockFetch(toolRes('{}'))
    await openaiAdapter(call, schema, settings({ preset: 'ollama', apiKey: null, model: 'llama3.1' }))
    expect(f.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
    expect(f.mock.calls[0][1].headers).not.toHaveProperty('authorization')
  })
  it('presets that need a key refuse to run without one', async () => {
    const f = mockFetch(toolRes('{}'))
    await expect(openaiAdapter(call, schema, settings({ apiKey: null }))).rejects.toThrow(/API key/)
    expect(f).not.toHaveBeenCalled()
  })
  it('custom endpoint needs and sends its key', async () => {
    const f = mockFetch(toolRes('{}'))
    await expect(openaiAdapter(call, schema, settings({ preset: 'custom', baseUrl: 'https://x.test/v1', apiKey: null }))).rejects.toThrow(/API key/)
    await openaiAdapter(call, schema, settings({ preset: 'custom', baseUrl: 'https://x.test/v1', apiKey: 'custom-key' }))
    expect(f.mock.calls[0][0]).toBe('https://x.test/v1/chat/completions')
    expect(f.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer custom-key' })
  })
  it('an insecure custom endpoint never reaches the network, with or without a key', async () => {
    const f = mockFetch(toolRes('{}'))
    await expect(openaiAdapter(call, schema, settings({ preset: 'custom', baseUrl: 'http://x.test/v1', apiKey: 'custom-key' }))).rejects.toThrow(/https:\/\//)
    await expect(openaiListModels(settings({ preset: 'custom', baseUrl: 'http://x.test/v1', apiKey: 'custom-key' }))).rejects.toThrow(/https:\/\//)
    expect(f).not.toHaveBeenCalled()
  })
  it('no model chosen -> friendly error', async () => {
    mockFetch(toolRes('{}'))
    await expect(openaiAdapter(call, schema, settings({ model: null }))).rejects.toThrow(/model/i)
  })
  it.each([
    [401, "OpenAI didn't accept this key. Check it was copied in full."],
    [403, "OpenAI didn't accept this key. Check it was copied in full."],
    [429, 'OpenAI is busy. Try again in a minute.'],
    [503, 'OpenAI is having trouble right now. Try again shortly.'],
  ])('maps %i to the provider recovery message', async (status, message) => {
    mockFetch(jsonRes({ error: { message: 'raw' } }, status))
    const err = await rejection(openaiAdapter(call, schema, settings()))
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toBe(message)
  })
  it.each([
    [402, { error: { message: 'payment required' } }],
    [429, { error: { code: 'insufficient_quota', message: 'quota exceeded' } }],
    [429, { error: { message: 'Add credit to continue' } }],
  ])('maps credit response %i to out of credit', async (status, body) => {
    mockFetch(jsonRes(body, status))
    await expect(openaiAdapter(call, schema, settings())).rejects.toThrow('Your OpenAI account is out of credit.')
  })
  it('names the selected provider in key errors', async () => {
    mockFetch(jsonRes({}, 401))
    await expect(openaiAdapter(call, schema, settings({ preset: 'groq' }))).rejects.toThrow("Groq didn't accept this key. Check it was copied in full.")
  })
  it('maps an unreachable local Ollama to its start instruction', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(openaiAdapter(call, schema, settings({ preset: 'ollama', apiKey: null, model: 'llama3.1' }))).rejects.toThrow("Can't reach Ollama on this computer. Start it, then test again.")
  })
  it('aborts after 60 s', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const p = rejection(openaiAdapter(call, schema, settings()))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await p).toBeInstanceOf(AIError)
  })
  it('honours a shorter per-call timeout', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const p = rejection(openaiAdapter({ ...call, timeoutMs: 4000 }, schema, settings()))
    await vi.advanceTimersByTimeAsync(4000)
    expect(await p).toBeInstanceOf(AIError)
  })
})

describe('openaiListModels', () => {
  it('GETs {baseUrl}/models and returns sorted ids', async () => {
    const f = mockFetch(jsonRes({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'c' }] }))
    expect(await openaiListModels(settings())).toEqual(['a-model', 'b-model', 'c'])
    expect(f.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
    expect(f.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer sk-test' })
  })
  it('401 -> friendly error', async () => {
    mockFetch(jsonRes({}, 401))
    await expect(openaiListModels(settings())).rejects.toThrow(/key/i)
  })
})

describe('testing lock (VITE_AI_LOCAL_ONLY=1)', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('the adapter and the model list refuse without touching the network', async () => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', '1')
    const f = mockFetch(toolRes('{}'))
    await expect(openaiAdapter(call, schema, settings())).rejects.toThrow(/switched off/)
    await expect(openaiListModels(settings())).rejects.toThrow(/switched off/)
    expect(f).not.toHaveBeenCalled()
  })
})
