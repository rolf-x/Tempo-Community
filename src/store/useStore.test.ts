import { beforeEach, describe, expect, it } from 'vitest'
import { exportData, parseImport } from '../lib/export'
import type { Activity } from '../types'
import { useStore } from './useStore'

const store = () => useStore.getState()

beforeEach(() => store().resetAll())

describe('portfolio store', () => {
  it('creates, deletes and restores an app', () => {
    const app = store().createProject({ name: 'Tempo' })
    expect(app.id).toMatch(/^p_/)
    store().deleteProject(app.id)
    expect(store().projects).toHaveLength(0)
    store().undo?.restore()
    expect(store().projects.map((project) => project.id)).toEqual([app.id])
  })

  it('stores app cards and repo signals without task operations', () => {
    const app = store().createProject({ name: 'Tempo' })
    const signals = { hasReadme: true, secretFiles: [], lastCommitAt: null, openIssues: 1, openPrs: 2, syncedAt: '2026-10-04T00:00:00Z' }
    store().commitSync(app.id, { card: { what: 'Maps apps.', who: 'Teams', stage: 'live', status: 'Healthy' }, signals, source: 'ai' })
    expect(store().projects[0]).toMatchObject({ appCard: { what: 'Maps apps.', source: 'ai' }, signals })
    expect(store().activity[0].kind).toBe('sync')
    expect(store()).not.toHaveProperty('tasks')
  })

  it('marks an agent handover checked by the current member, and leaves apps without one alone', () => {
    const app = store().createProject({ name: 'Tempo' })
    const other = store().createProject({ name: 'Other' })
    const draftedBy = { client: 'Codex', clientId: 'c1', memberId: null, at: '2026-10-05T09:00:00Z' }
    const doc = { summary: 'Maps apps.', howToRun: [], whereThingsAre: [], openWork: [], risks: [], contacts: [], unknowns: [] }
    useStore.setState((state) => ({ projects: state.projects.map((p) => p.id === app.id ? { ...p, handover: { doc, draftedBy, checkedAt: null, checkedBy: null } } : p) }))
    store().checkHandover(app.id)
    store().checkHandover(other.id)
    const [checked, untouched] = [app.id, other.id].map((id) => store().projects.find((p) => p.id === id))
    expect(checked?.handover).toMatchObject({ doc, draftedBy, checkedBy: store().meId })
    expect(typeof checked?.handover?.checkedAt).toBe('string')
    expect(untouched?.handover).toBeUndefined()
  })
})

describe('export and import', () => {
  it('omits tasks and ignores them in old backups', () => {
    store().createProject({ name: 'Tempo' })
    store().setAI({ provider: 'anthropic', apiKey: 'sk-secret' })
    const exported = exportData(store())
    expect(exported).not.toContain('sk-secret')
    expect(JSON.parse(exported)).not.toHaveProperty('tasks')
    const old = JSON.parse(exported)
    old.tasks = [{ id: 'old-task' }]
    expect(parseImport(JSON.stringify(old)).projects).toHaveLength(1)
  })
})

describe('saved copy', () => {
  it('drops coding-agent entries a browser cached before they were removed, without crashing and keeping the rest', async () => {
    const row = (id: string, kind: string): Activity => ({ id, projectId: 'p1', kind: kind as Activity['kind'], actor: 'sam', title: id, url: null, at: '2026-10-04T10:00:00Z' })
    const saved = { ...store(), activity: [row('commit-1', 'commit'), row('old-update', 'heartbeat'), row('sync-1', 'sync')] }
    await useStore.persist.getOptions().storage!.setItem('tempo', { state: saved, version: 6 })
    await useStore.persist.rehydrate()
    expect(store().activity.map((item) => item.id)).toEqual(['commit-1', 'sync-1'])
    expect(store().hydrated).toBe(true)
  })
})
