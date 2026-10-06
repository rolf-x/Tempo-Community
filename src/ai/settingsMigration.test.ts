import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, useStore, type StoreState } from '../store/useStore'

afterEach(() => vi.unstubAllEnvs())

describe('persisted settings', () => {
  const migrate = async (old: unknown, version: number) => await useStore.persist.getOptions().migrate!(old, version) as StoreState

  it('uses the app-only schema and persistence versions', () => {
    expect(useStore.persist.getOptions()).toMatchObject({ name: 'tempo', version: 6 })
    expect(useStore.getState().version).toBe(3)
  })

  it('discards task and today data while preserving apps', async () => {
    const current = useStore.getState()
    const result = await migrate({ ...current, tasks: [{ id: 'old' }], today: { picks: ['old'] } }, 4)
    expect(result.projects).toEqual(current.projects)
    expect(result).not.toHaveProperty('tasks')
    expect(result).not.toHaveProperty('today')
    expect(result.version).toBe(3)
  })

  it('turns the one saved AI connection into the first saved key, as the default (v6)', async () => {
    const current = useStore.getState()
    const key = { provider: 'anthropic' as const, preset: null, baseUrl: null, apiKey: 'sk-test', model: 'claude-sonnet-5-5' }
    const { aiConnections: _list, aiDefaultId: _id, ...oldSettings } = current.settings
    const result = await migrate({ ...current, settings: { ...oldSettings, ai: key } }, 5)
    expect(result.settings.aiConnections).toHaveLength(1)
    expect(result.settings.aiConnections?.[0].ai).toEqual(key)
    expect(result.settings.aiDefaultId).toBe(result.settings.aiConnections?.[0].id)
    expect(result.settings.ai).toEqual(key)
  })

  it('starts an empty list when there was no key to keep (v6)', async () => {
    const current = useStore.getState()
    const { aiConnections: _list, aiDefaultId: _id, ...oldSettings } = current.settings
    const result = await migrate({ ...current, settings: { ...oldSettings, ai: { provider: 'none', preset: null, baseUrl: null, apiKey: null, model: null } } }, 5)
    expect(result.settings.aiConnections).toEqual([])
    expect(result.settings.aiDefaultId).toBeNull()
  })

  it('fills in settings an old copy never had, without crashing (v6)', async () => {
    const current = useStore.getState()
    const result = await migrate({ ...current, settings: undefined }, 5)
    expect(result.settings.ai.provider).toBeDefined()
    expect(result.settings.aiConnections).toEqual([])
    expect(result.settings.theme).toBeDefined()
  })

  it('keeps settings.ai and the default key in step: a non-saved provider clears the default, setSettings leaves AI alone', () => {
    const store = useStore.getState()
    const key = { provider: 'anthropic' as const, preset: null, baseUrl: null, apiKey: 'sk-test', model: null }
    const { id } = store.saveAIConnection(key, { makeDefault: true })
    expect(useStore.getState().settings.aiDefaultId).toBe(id)
    useStore.getState().setSettings({ ai: { ...key, provider: 'none' } } as never)
    expect(useStore.getState().settings.ai).toEqual(key)
    useStore.getState().setAI({ provider: 'local', apiKey: null })
    expect(useStore.getState().settings.aiDefaultId).toBeNull()
    useStore.getState().setDefaultAIConnection(id)
    expect(useStore.getState().settings.ai).toEqual(key)
    useStore.getState().removeAIConnection(id)
  })

  it('uses local in development', () => {
    expect(defaultSettings().ai.provider).toBe('local')
  })

  it('uses none after a production reset', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const production = await import('../store/useStore')
    expect(production.defaultSettings().ai.provider).toBe('none')
  })
})
