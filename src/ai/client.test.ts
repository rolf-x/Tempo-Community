import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIError, aiErrorKind, callTool, listModels, testConnection, PRESETS, type AISettings } from './client'
import { hangingFetch, jsonRes, mockFetch, rejection } from './testFetch'

const base: AISettings = { provider: 'anthropic', preset: null, baseUrl: null, apiKey: 'k', model: null }
const use = (input: unknown) => jsonRes({ content: [{ type: 'tool_use', name: 'sync_app', input }] })
const good = { card: { what: 'Connection check', who: 'The team', stage: 'live', status: 'Ready' } }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('no AI connected', () => {
  it.each(['0', '1'])('never calls a provider or local bridge (testing lock %s)', async (lock) => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', lock)
    const fetch = mockFetch(jsonRes({ data: good }))
    const settings: AISettings = { ...base, provider: 'none' }
    await expect(callTool({ tool: 'sync_app', system: 's', user: 'u' }, settings)).rejects.toThrow('No AI connected')
    expect(await listModels(settings)).toEqual([])
    expect(await testConnection(settings)).toEqual({ ok: false, error: 'No AI connected. Pick your AI in Settings.' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('client re-exports', () => {
  it('exposes every key-guide provider', () => expect(PRESETS.length).toBe(8))
  it.each([
    ["OpenAI didn't accept this key. Check it was copied in full.", 'key-rejected'],
    ['Your Claude account is out of credit.', 'out-of-credit'],
    ['Groq is busy. Try again in a minute.', 'rate-limited'],
    ["Can't reach Ollama on this computer. Start it, then test again.", 'ollama-unreachable'],
    ["Couldn't load models.", 'other'],
  ] as const)('classifies %s', (message, kind) => expect(aiErrorKind(message)).toBe(kind))
})

describe('callTool', () => {
  it('validates, retrying once with the zod error appended', async () => {
    const f = mockFetch(use({ nope: true }), use(good))
    const out = await callTool({ tool: 'sync_app', system: 's', user: 'u' }, base)
    expect(out).toEqual(good)
    expect(f).toHaveBeenCalledTimes(2)
    expect(JSON.parse(f.mock.calls[1][1].body as string).messages[0].content).toMatch(/Your last answer was invalid/)
  })
  it('two bad answers -> friendly AIError', async () => {
    mockFetch(use({ nope: true }))
    await expect(callTool({ tool: 'sync_app', system: 's', user: 'u' }, base)).rejects.toBeInstanceOf(AIError)
  })
  it('routes openai-compatible', async () => {
    const f = mockFetch(jsonRes({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(good) } }] } }] }))
    await callTool({ tool: 'sync_app', system: 's', user: 'u' }, { ...base, provider: 'openai-compatible', preset: 'groq', model: 'm' })
    expect(f.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions')
  })
  it('local adapter posts to /api/claude and honours the 60 s timeout', async () => {
    const f = mockFetch(jsonRes({ data: good }))
    expect(await callTool({ tool: 'sync_app', system: 's', user: 'u' }, { ...base, provider: 'local' })).toEqual(good)
    expect(f.mock.calls[0][0]).toBe('/api/claude')
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    vi.useFakeTimers()
    hangingFetch()
    const p = rejection(callTool({ tool: 'sync_app', system: 's', user: 'u' }, { ...base, provider: 'local' }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await p).toBeInstanceOf(AIError)
  })
  it('demo provider never calls the network', async () => {
    const f = mockFetch(jsonRes({}))
    await expect(callTool({ tool: 'sync_app', system: 's', user: 'u' }, { ...base, provider: 'demo' })).rejects.toBeInstanceOf(AIError)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('listModels', () => {
  it('local -> fixed aliases, demo -> empty, no network', async () => {
    const f = mockFetch(jsonRes({}))
    expect(await listModels({ ...base, provider: 'local' })).toEqual(['sonnet', 'haiku', 'opus'])
    expect(await listModels({ ...base, provider: 'demo' })).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
  it('anthropic and openai-compatible delegate', async () => {
    mockFetch(jsonRes({ data: [{ id: 'claude-x' }] }))
    expect(await listModels(base)).toEqual(['claude-x'])
    mockFetch(jsonRes({ data: [{ id: 'z' }, { id: 'a' }] }))
    expect(await listModels({ ...base, provider: 'openai-compatible', preset: 'openai' })).toEqual(['a', 'z'])
  })
})

describe('testConnection', () => {
  it('ok with latency and model', async () => {
    mockFetch(use(good))
    const r = await testConnection({ ...base, model: 'claude-sonnet-5-5' })
    expect(r).toMatchObject({ ok: true, model: 'claude-sonnet-5-5' })
    expect(r.ok && r.ms).toBeGreaterThanOrEqual(0)
  })
  it('reports the default model when none is chosen', async () => {
    mockFetch(use(good))
    expect(await testConnection(base)).toMatchObject({ ok: true, model: 'claude-sonnet-5-5' })
  })
  it('bad key -> ok:false with the friendly message', async () => {
    mockFetch(jsonRes({}, 401))
    const r = await testConnection(base)
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.error).toMatch(/key/i)
  })
  it('a reply that fails validation -> ok:false', async () => {
    mockFetch(use({ junk: 1 }))
    expect((await testConnection(base)).ok).toBe(false)
  })
  it('keeps a local bridge network diagnostic for the Details disclosure', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    const result = await testConnection({ ...base, provider: 'local' })
    expect(result).toMatchObject({ ok: false, details: 'Failed to fetch' })
  })
  it('demo is always ok', async () => {
    expect(await testConnection({ ...base, provider: 'demo' })).toMatchObject({ ok: true, model: 'demo' })
  })
})

describe('testing lock (VITE_AI_LOCAL_ONLY=1)', () => {
  afterEach(() => vi.unstubAllEnvs())
  const openai: AISettings = { provider: 'openai-compatible', preset: 'openai', baseUrl: null, apiKey: 'sk-test', model: 'gpt-x' }
  it('routes Claude and OpenAI-compatible calls to the local bridge only', async () => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', '1')
    const f = mockFetch(jsonRes({ data: good }))
    expect(await callTool({ tool: 'sync_app', system: 'S', user: 'U' }, openai)).toEqual(good)
    expect(await callTool({ tool: 'sync_app', system: 'S', user: 'U' }, base)).toEqual(good)
    expect(f.mock.calls.map(([url]) => url)).toEqual(['/api/claude', '/api/claude'])
  })
  it('lists the local models without calling /models, and reports the bridge model', async () => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', '1')
    const f = mockFetch(jsonRes({ data: good }))
    expect(await listModels(openai)).toEqual(['sonnet', 'haiku', 'opus'])
    expect(await listModels(base)).toEqual(['sonnet', 'haiku', 'opus'])
    expect(f).not.toHaveBeenCalled()
    expect(await testConnection(openai)).toMatchObject({ ok: true, model: 'sonnet' })
    expect(f.mock.calls.every(([url]) => url === '/api/claude')).toBe(true)
  })
  it('demo stays offline', async () => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', '1')
    expect(await listModels({ ...openai, provider: 'demo' })).toEqual([])
  })
})
