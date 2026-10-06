import { beforeEach, describe, expect, it } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'
import { EMPTY_GUIDE, guideScope, useGuideState } from './guideState'

const saved = new Map<string, string>()
const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) }, removeItem: (key: string) => { saved.delete(key) } }

beforeEach(() => {
  saved.clear()
  useGuideState.persist.setOptions({ storage: createJSONStorage(() => storage) })
  useGuideState.setState({ workspaces: {} })
})

describe('saved guide progress', () => {
  it('persists collapsed state under tempo-guide and restores it', async () => {
    const key = guideScope('team', 'user')
    useGuideState.getState().setChecklistCollapsed(key, true)
    const persisted = saved.get('tempo-guide')!
    expect(JSON.parse(persisted).state).toEqual({ workspaces: { [key]: { checklistCollapsed: true } }, claude: {} })
    useGuideState.setState({ workspaces: {} })
    saved.set('tempo-guide', persisted)
    await useGuideState.persist.rehydrate()
    expect(useGuideState.getState().workspaces[key]).toEqual({ checklistCollapsed: true })
  })
  it('isolates accounts, workspaces and sample data', () => {
    const scopes = [guideScope('one', 'user'), guideScope('two', 'user'), guideScope('one', 'other'), guideScope('one', 'user', true)]
    expect(new Set(scopes).size).toBe(4)
    useGuideState.getState().setChecklistCollapsed(scopes[0], true)
    for (const key of scopes.slice(1)) expect(useGuideState.getState().workspaces[key]).toBeUndefined()
  })
  it('stores the collapsed state', () => {
    useGuideState.getState().setChecklistCollapsed('scope', true)
    expect(useGuideState.getState().workspaces.scope).toEqual({ ...EMPTY_GUIDE, checklistCollapsed: true })
  })
})
