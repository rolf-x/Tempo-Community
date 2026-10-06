import { describe, expect, it } from 'vitest'
import { connectionName, defaultConnection, isSavable, makeDefault, migrateConnections, removeConnection, saveConnection } from './connections'
import type { AISettings, Settings } from '../types'

type S = Pick<Settings, 'ai' | 'aiConnections' | 'aiDefaultId'>
const NONE: AISettings = { provider: 'none', preset: null, baseUrl: null, apiKey: null, model: null }
const claude: AISettings = { provider: 'anthropic', preset: null, baseUrl: null, apiKey: 'sk-a', model: 'claude-sonnet-5-5' }
const openai: AISettings = { provider: 'openai-compatible', preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-o', model: 'gpt-5' }
const gemini: AISettings = { provider: 'openai-compatible', preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'g', model: null }

let n = 0
const opts = (extra: { id?: string; makeDefault?: boolean } = {}) => ({ ...extra, newId: () => `id${++n}`, now: '2026-10-05T00:00:00Z' })
const empty: S = { ai: NONE, aiConnections: [], aiDefaultId: null }
const strip = ({ id: _id, ...rest }: S & { id: string }): S => rest

describe('saved API connections', () => {
  it('makes the first key saved the default, and keeps the default when another is added', () => {
    const one = saveConnection(empty, claude, opts())
    expect(one.aiDefaultId).toBe(one.id)
    expect(one.ai).toEqual(claude)
    const two = saveConnection(strip(one), openai, opts())
    expect(two.aiConnections).toHaveLength(2)
    expect(two.aiDefaultId).toBe(one.id)
    expect(two.ai).toEqual(claude)
  })

  it('switches the default, and what Tempo calls with follows it', () => {
    const one = strip(saveConnection(empty, claude, opts()))
    const two = saveConnection(one, openai, opts())
    const switched = makeDefault(strip(two), two.id)
    expect(switched.aiDefaultId).toBe(two.id)
    expect(switched.ai).toEqual(openai)
    expect(defaultConnection(switched)?.ai).toEqual(openai)
  })

  it('can save a key as the default straight away', () => {
    const one = strip(saveConnection(empty, claude, opts()))
    const two = saveConnection(one, gemini, opts({ makeDefault: true }))
    expect(two.aiDefaultId).toBe(two.id)
    expect(two.ai).toEqual(gemini)
  })

  it('editing the default (a new model) updates what Tempo calls with; editing another leaves it alone', () => {
    const one = saveConnection(empty, claude, opts())
    const two = saveConnection(strip(one), openai, opts())
    const edited = saveConnection(strip(two), { ...claude, model: 'claude-opus-5-5' }, opts({ id: one.id }))
    expect(edited.ai.model).toBe('claude-opus-5-5')
    expect(edited.aiConnections).toHaveLength(2)
    const other = saveConnection(strip(edited), { ...openai, model: 'gpt-5-mini' }, opts({ id: two.id }))
    expect(other.ai.model).toBe('claude-opus-5-5')
    expect(other.aiConnections?.find((item) => item.id === two.id)?.ai.model).toBe('gpt-5-mini')
  })

  it('removing the default hands it to the next key, and removing the last turns AI off', () => {
    const one = saveConnection(empty, claude, opts())
    const two = saveConnection(strip(one), openai, opts())
    const left = removeConnection(strip(two), one.id)
    expect(left.aiDefaultId).toBe(two.id)
    expect(left.ai).toEqual(openai)
    const none = removeConnection(left, two.id)
    expect(none).toEqual({ ai: NONE, aiConnections: [], aiDefaultId: null })
  })

  it('removing a key that is not the default keeps the default', () => {
    const one = saveConnection(empty, claude, opts())
    const two = saveConnection(strip(one), openai, opts())
    const left = removeConnection(strip(two), two.id)
    expect(left.aiDefaultId).toBe(one.id)
    expect(left.ai).toEqual(claude)
  })

  it('names the provider', () => {
    expect(connectionName(claude)).toBe('Claude')
    expect(connectionName(openai)).toBe('OpenAI')
    expect(connectionName({ ...openai, preset: 'custom' })).toBe('Custom endpoint')
  })

  it('saves only providers with an endpoint, and moves an old single connection into the list', () => {
    expect(isSavable(claude)).toBe(true)
    expect(isSavable({ ...NONE, provider: 'local' })).toBe(false)
    const migrated = migrateConnections({ ai: claude }, () => 'old', 'now')
    expect(migrated).toEqual({ ai: claude, aiConnections: [{ id: 'old', ai: claude, savedAt: 'now' }], aiDefaultId: 'old' })
    expect(migrateConnections({ ai: { ...NONE, provider: 'local' } }, () => 'x', 'now')).toEqual({ ai: { ...NONE, provider: 'local' }, aiConnections: [], aiDefaultId: null })
    expect(migrateConnections(migrated, () => 'again', 'now')).toBe(migrated)
  })
})
