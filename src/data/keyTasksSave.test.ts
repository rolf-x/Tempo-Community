import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import type { TaskDraft } from '../ai/tools/mcpDrafts'
import type { HealthKind } from '../ai/tools/health'
import type { AppTask, DraftedBy } from '../types'
import { useSession } from './session'
import { capTasks, mergeKeyTasks, saveKeyTasks } from './keyTasksSave'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./cloud', () => ({ client: () => ({ rpc }) }))

const draft = (problem: HealthKind, title: string, detail: string | null = null): TaskDraft => ({ problem, title, detail })
const by = (client = 'Anthropic API key'): DraftedBy => ({ client, clientId: null, memberId: 'me', at: '2026-10-06T10:00:00.000Z' })
const task = (problem: HealthKind, title: string, patch: Partial<AppTask> = {}): AppTask => ({
  id: `${problem}:${title}`, problem, title, detail: null, createdAt: '2026-10-05T09:00:00.000Z',
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: '2026-10-05T09:00:00.000Z' }, fixedAt: null, ...patch,
})
const repo = { fullName: 'acme/web', url: 'https://github.com/acme/web', private: true, defaultBranch: 'main' }
const state = () => useStore.getState()
const tasksOf = (id: string) => state().projects.find((p) => p.id === id)!.tasks

beforeEach(() => {
  rpc.mockReset()
  state().resetAll()
  useSession.setState({ status: 'off' })
})
afterEach(() => useSession.setState({ status: 'off' }))

describe('capTasks', () => {
  it('keeps at most 3 for each problem and 10 in all, in order', () => {
    const many = (['no-owner', 'secrets', 'stale', 'no-readme'] as const).flatMap((p) => [1, 2, 3, 4].map((n) => draft(p, `${p} ${n}`)))
    const capped = capTasks(many)
    expect(capped).toHaveLength(10)
    expect(capped.filter((t) => t.problem === 'no-owner').map((t) => t.title)).toEqual(['no-owner 1', 'no-owner 2', 'no-owner 3'])
    expect(capped.at(-1)!.title).toBe('no-readme 1')
  })
})

describe('mergeKeyTasks', () => {
  it('replaces the open tasks of the problems written, keeps the others, and keeps fixed and removed ones', () => {
    const existing = [
      task('no-owner', 'Old open'), task('no-owner', 'Old fixed', { fixedAt: '2026-10-04T00:00:00.000Z' }),
      task('no-owner', 'Old removed', { removedAt: '2026-10-04T00:00:00.000Z' }), task('stale', 'Other problem'),
    ]
    let n = 0
    const { tasks, added } = mergeKeyTasks(existing, [draft('no-owner', 'New one', 'Why'), draft('no-readme', 'Write a README')], by(), () => `id${++n}`)
    expect(added).toBe(2)
    expect(tasks.map((t) => t.title)).toEqual(['Old fixed', 'Old removed', 'Other problem', 'New one', 'Write a README'])
    expect(tasks[3]).toEqual({ id: 'id1', problem: 'no-owner', title: 'New one', detail: 'Why', createdAt: '2026-10-06T10:00:00.000Z', draftedBy: by(), fixedAt: null })
  })

  it('does not add a task again that a person removed (same problem and title, any case)', () => {
    const existing = [task('no-owner', 'Assign an owner', { removedAt: '2026-10-04T00:00:00.000Z' })]
    const { tasks, added } = mergeKeyTasks(existing, [draft('no-owner', 'assign an OWNER'), draft('no-owner', 'Name a maintainer'), draft('secrets', 'Assign an owner')], by())
    expect(added).toBe(2)
    expect(tasks.map((t) => [t.problem, t.title])).toEqual([['no-owner', 'Assign an owner'], ['no-owner', 'Name a maintainer'], ['secrets', 'Assign an owner']])
  })
})

describe('saveKeyTasks in a cloud workspace', () => {
  beforeEach(() => {
    useSession.setState({ status: 'signed-in' })
    state().setWorkspace({ id: 'ws', name: 'Acme', kind: 'org' })
  })

  it('calls key_submit_tasks with the app, the tasks and the label, and leaves the store to realtime', async () => {
    const p = state().createProject({ name: 'Web', repo })
    rpc.mockResolvedValue({ data: { appId: p.id, tasks: 2 }, error: null })
    const tasks = [draft('no-owner', 'Assign an owner', 'Pick one.'), draft('no-readme', 'Write a README')]
    expect(await saveKeyTasks(p.id, tasks, 'OpenAI API key')).toBe(2)
    expect(rpc).toHaveBeenCalledWith('key_submit_tasks', { p_app: p.id, p_tasks: tasks, p_label: 'OpenAI API key' })
    expect(tasksOf(p.id) ?? []).toEqual([])
  })

  it('sends nothing for no tasks', async () => {
    expect(await saveKeyTasks('app', [], 'OpenAI API key')).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says plainly when the database refuses the person', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table projects' } })
    await expect(saveKeyTasks('app', [draft('no-owner', 'Assign an owner')], 'OpenAI API key')).rejects.toThrow("You can't add tasks to this app.")
  })

  it('does not show database wording on other failures', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'check constraint "x" violated' } })
    await expect(saveKeyTasks('app', [draft('no-owner', 'Assign an owner')], 'OpenAI API key')).rejects.toThrow("Tempo couldn't save the tasks.")
  })

  it('says so when the database has no key_submit_tasks yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.key_submit_tasks' } })
    await expect(saveKeyTasks('app', [draft('no-owner', 'Assign an owner')], 'OpenAI API key')).rejects.toThrow("isn't set up")
  })
})

describe('saveKeyTasks in guest mode', () => {
  it('merges into the local store, stamps tasksAt and names the writer', async () => {
    const p = state().createProject({ name: 'Web', repo, tasks: [task('stale', 'Other problem'), task('no-owner', 'Old open')] })
    expect(await saveKeyTasks(p.id, [draft('no-owner', 'Assign an owner', 'Pick one.')], 'Claude (local)')).toBe(1)
    expect(rpc).not.toHaveBeenCalled()
    const tasks = tasksOf(p.id)!
    expect(tasks.map((t) => t.title)).toEqual(['Other problem', 'Assign an owner'])
    expect(tasks[1]).toMatchObject({ problem: 'no-owner', detail: 'Pick one.', fixedAt: null, draftedBy: { client: 'Claude (local)', clientId: null, memberId: state().meId } })
    expect(tasks[1].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(tasks[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(state().projects[0].tasksAt).toBe(tasks[1].draftedBy.at)
  })

  it('also stays local when signed in with no workspace yet', async () => {
    useSession.setState({ status: 'signed-in' })
    const p = state().createProject({ name: 'Web', repo })
    expect(await saveKeyTasks(p.id, [draft('no-owner', 'Assign an owner')], 'OpenAI API key')).toBe(1)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not re-add a removed task, and changes nothing when that was all there was', async () => {
    const removed = task('no-owner', 'Assign an owner', { removedAt: '2026-10-04T00:00:00.000Z' })
    const p = state().createProject({ name: 'Web', repo, tasks: [removed] })
    expect(await saveKeyTasks(p.id, [draft('no-owner', 'Assign an owner')], 'OpenAI API key')).toBe(0)
    expect(tasksOf(p.id)).toEqual([removed])
    expect(state().projects[0].tasksAt).toBeUndefined()
  })

  it('returns 0 for an app that is gone', async () => {
    expect(await saveKeyTasks('gone', [draft('no-owner', 'Assign an owner')], 'OpenAI API key')).toBe(0)
  })
})
