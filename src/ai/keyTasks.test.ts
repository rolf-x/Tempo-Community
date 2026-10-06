import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import type { AppTask, Project } from '../types'
import type { HealthKind } from './tools/health'
import { callTool } from './client'
import { AIError } from './adapterTypes'
import { aiWriteTasks, appWantsTasks, keyLabel } from './keyTasks'

vi.mock('./client', async (importOriginal) => ({ ...(await importOriginal<typeof import('./client')>()), callTool: vi.fn() }))
const call = vi.mocked(callTool)

const now = () => new Date().toISOString()
const repo = (patch: Partial<NonNullable<Project['repo']>> = {}) => ({ fullName: 'acme/web', url: 'https://github.com/acme/web', private: true, defaultBranch: 'main', ...patch })
const signals = (patch: Partial<NonNullable<Project['signals']>> = {}) => ({ hasReadme: true, secretFiles: [], lastCommitAt: now(), openIssues: 2, openPrs: 1, syncedAt: now(), ...patch })
const task = (problem: HealthKind, patch: Partial<AppTask> = {}): AppTask => ({
  id: `${problem}-${patch.title ?? 't'}`, problem, title: patch.title ?? `Task for ${problem}`, detail: null, createdAt: '2026-10-05T09:00:00.000Z',
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: '2026-10-05T09:00:00.000Z' }, fixedAt: null, ...patch,
})

/** An app with no owner, a public repo and no README: flags no-owner (high), public-repo (medium), no-readme (low). */
function flagged(patch: Partial<Project> = {}): Project {
  return useStore.getState().createProject({ name: 'Web', repo: repo({ private: false }), ownerId: null, signals: signals({ hasReadme: false }), ...patch })
}
const project = (id: string) => useStore.getState().projects.find((p) => p.id === id)!
const state = () => useStore.getState()
const sent = (n = 0) => JSON.parse(call.mock.calls[n][0].user) as { app: Record<string, unknown>; problems: { kind: string; detail: string }[]; signals: Record<string, unknown>; alreadyRemoved: string[] }
const answer = (...tasks: [HealthKind, string][]) => call.mockResolvedValue({ tasks: tasks.map(([problem, title]) => ({ problem, title, detail: `${title} detail` })) } as never)

beforeEach(() => {
  vi.stubEnv('VITE_AI_MODE', 'both')
  vi.stubEnv('VITE_AI_LOCAL_ONLY', '0')
  call.mockReset()
  state().resetAll()
  state().setAI({ provider: 'anthropic', apiKey: 'k' })
})
afterEach(() => vi.unstubAllEnvs())

describe('appWantsTasks', () => {
  it('is true when a health flag has no open task', () => {
    expect(appWantsTasks(flagged(), state().members)).toBe(true)
  })

  it('is false when every flag has an open task', () => {
    const p = flagged({ tasks: [task('no-owner'), task('public-repo'), task('no-readme')] })
    expect(appWantsTasks(p, state().members)).toBe(false)
  })

  it('is true again for a flag whose task is fixed or was removed', () => {
    const open = [task('no-owner'), task('public-repo'), task('no-readme')]
    expect(appWantsTasks(flagged({ tasks: [{ ...open[0], fixedAt: now() }, open[1], open[2]] }), state().members)).toBe(true)
    expect(appWantsTasks(flagged({ tasks: [open[0], { ...open[1], removedAt: now() }, open[2]] }), state().members)).toBe(true)
  })

  it('ignores a task whose flag is gone: it covers nothing', () => {
    // The README exists, so a no-readme task is fixed; no-owner and public-repo are still missing a task.
    const p = flagged({ signals: signals(), tasks: [task('no-readme')] })
    expect(appWantsTasks(p, state().members)).toBe(true)
  })

  it('is false when the app has no flags', () => {
    const ok = state().createProject({ name: 'Web', repo: repo(), ownerId: state().meId, signals: signals() })
    expect(appWantsTasks(ok, state().members)).toBe(false)
  })

  it('is false for an archived app, an app with no repo and a sample app', () => {
    expect(appWantsTasks(flagged({ archived: true }), state().members)).toBe(false)
    expect(appWantsTasks(flagged({ repo: null }), state().members)).toBe(false)
    expect(appWantsTasks(flagged({ repo: repo({ fullName: 'acme-sample/web' }) }), state().members)).toBe(false)
  })

  it('does not count ownership flags in a personal workspace, like the rest of the app', () => {
    state().setWorkspace({ id: 'w', name: 'Mine', kind: 'personal' })
    const p = flagged({ repo: repo(), signals: signals() })
    expect(appWantsTasks(p, state().members)).toBe(false)
    state().setWorkspace({ id: 'w', name: 'Acme', kind: 'org' })
    expect(appWantsTasks(p, state().members)).toBe(true)
  })
})

describe('aiWriteTasks', () => {
  it('asks only for the flags that have no open task, with what Tempo saw and the repo facts', async () => {
    const p = flagged({ description: 'Internal tool', appCard: { what: 'Tracks invoices.', who: 'Finance', stage: 'live', status: 'Quiet this week', updatedAt: now(), source: 'ai' }, tasks: [task('public-repo')] })
    answer(['no-owner', 'Assign an owner'])
    await aiWriteTasks(p.id)
    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0][0].tool).toBe('write_tasks')
    const input = sent()
    expect(input.problems.map((item) => item.kind)).toEqual(['no-owner', 'no-readme'])
    expect(input.problems[0].detail).toBe('No owner')
    expect(input.app).toMatchObject({ name: 'Web', repo: 'acme/web', description: 'Internal tool', what: 'Tracks invoices.', status: 'Quiet this week' })
    expect(input.signals).toEqual({ hasReadme: false, secretFiles: [], lastCommitAt: expect.any(String), openIssues: 2, openPrs: 1 })
  })

  it('tells the AI which tasks a person removed', async () => {
    const p = flagged({ tasks: [task('no-owner', { title: 'Assign an owner', removedAt: now() })] })
    answer(['no-owner', 'Name a maintainer'])
    await aiWriteTasks(p.id)
    expect(sent().alreadyRemoved).toEqual(['Assign an owner'])
  })

  it('saves what the AI wrote, cleaned, for the asked problems only, and keeps the open tasks it did not ask about', async () => {
    const existing = task('public-repo')
    const p = flagged({ tasks: [existing] })
    call.mockResolvedValue({
      tasks: [
        { problem: 'no-owner', title: 'Assign an owner', detail: 'Pick one person. See https://example.com/guide for how.' },
        { problem: 'no-owner', title: 'x'.repeat(120), detail: '' },
        { problem: 'no-owner', title: 'Write down who to ask', detail: 'Add a line to the README.' },
        { problem: 'no-owner', title: 'A fourth owner task', detail: '' },
        { problem: 'no-readme', title: 'Write a README', detail: 'Say what it does.' },
        { problem: 'public-repo', title: 'Make the repo private', detail: 'It already has a task.' },
        { problem: 'secrets', title: 'Rotate the key', detail: 'Not flagged on this app.' },
      ],
    } as never)
    const out = await aiWriteTasks(p.id)
    expect(out).toEqual({ written: 4 })
    const tasks = project(p.id).tasks!
    expect(tasks[0]).toEqual(existing)
    expect(tasks.slice(1).map((t) => [t.problem, t.title.length > 80 ? 'long' : t.title])).toEqual([
      ['no-owner', 'Assign an owner'], ['no-owner', expect.stringMatching(/^x+…$/)], ['no-owner', 'Write down who to ask'], ['no-readme', 'Write a README'],
    ])
    expect(tasks[1].title.length).toBeLessThanOrEqual(80)
    expect(tasks[1].detail).toBe('Pick one person. See for how.')
    expect(tasks[1].draftedBy).toEqual({ client: 'Anthropic API key', clientId: null, memberId: state().meId, at: expect.any(String) })
    expect(project(p.id).tasksAt).toBeTruthy()
  })

  it('writes at most 10 tasks in all, and every flagged problem keeps at least one', async () => {
    const p = flagged({ signals: signals({ hasReadme: false, secretFiles: ['.env'], lastCommitAt: '2026-01-01T00:00:00.000Z' }) })
    const kinds: HealthKind[] = ['no-owner', 'secrets', 'public-repo', 'stale', 'no-readme']
    call.mockResolvedValue({ tasks: kinds.flatMap((problem) => [1, 2, 3].map((n) => ({ problem, title: `${problem} ${n}`, detail: '' }))) } as never)
    const out = await aiWriteTasks(p.id)
    expect(out.written).toBe(10)
    const tasks = project(p.id).tasks!
    expect(tasks).toHaveLength(10)
    for (const kind of kinds) expect(tasks.filter((t) => t.problem === kind)).toHaveLength(2)
  })

  it('does not call the AI when nothing is missing', async () => {
    const p = flagged({ tasks: [task('no-owner'), task('public-repo'), task('no-readme')] })
    expect(await aiWriteTasks(p.id)).toEqual({ written: 0 })
    expect(call).not.toHaveBeenCalled()
    expect(await aiWriteTasks('missing')).toEqual({ written: 0 })
  })

  it.each(['none', 'demo'] as const)('does not call the AI in %s mode', async (provider) => {
    const p = flagged()
    state().setAI({ provider })
    expect(await aiWriteTasks(p.id)).toEqual({ written: 0 })
    expect(call).not.toHaveBeenCalled()
    expect(project(p.id).tasks ?? []).toEqual([])
  })

  it('does not call the AI when the browser makes no AI calls (VITE_AI_MODE=mcp)', async () => {
    vi.stubEnv('VITE_AI_MODE', 'mcp')
    const p = flagged()
    expect(await aiWriteTasks(p.id)).toEqual({ written: 0 })
    expect(call).not.toHaveBeenCalled()
  })

  it('works through the local bridge and labels the tasks "Claude (local)"', async () => {
    const p = flagged()
    state().setAI({ provider: 'local', apiKey: null })
    answer(['no-owner', 'Assign an owner'])
    expect(await aiWriteTasks(p.id)).toEqual({ written: 1 })
    expect(call.mock.calls[0][1].provider).toBe('local')
    expect(project(p.id).tasks![0].draftedBy.client).toBe('Claude (local)')
  })

  it('throws the AI error and saves nothing', async () => {
    const p = flagged()
    call.mockRejectedValue(new AIError('OpenAI is out of credit.'))
    await expect(aiWriteTasks(p.id)).rejects.toThrow('out of credit')
    expect(project(p.id).tasks ?? []).toEqual([])
  })

  it('saves nothing when the AI wrote nothing usable', async () => {
    const p = flagged()
    answer(['secrets', 'Rotate the key'])
    expect(await aiWriteTasks(p.id)).toEqual({ written: 0 })
    expect(project(p.id).tasks ?? []).toEqual([])
  })

  it('leaves alone a problem that got a task while the AI was writing', async () => {
    const p = flagged()
    call.mockImplementation(async () => {
      // Claude added a no-owner task over MCP in the meantime.
      state().updateProject(p.id, { tasks: [task('no-owner', { title: 'From Claude' })] })
      return { tasks: [{ problem: 'no-owner', title: 'Assign an owner', detail: '' }, { problem: 'no-readme', title: 'Write a README', detail: '' }] } as never
    })
    expect(await aiWriteTasks(p.id)).toEqual({ written: 1 })
    expect(project(p.id).tasks!.map((t) => t.title)).toEqual(['From Claude', 'Write a README'])
  })
})

describe('keyLabel', () => {
  it.each([
    [{ provider: 'anthropic', preset: null }, 'Anthropic API key'],
    [{ provider: 'openai-compatible', preset: 'openai' }, 'OpenAI API key'],
    [{ provider: 'openai-compatible', preset: 'gemini' }, 'Gemini API key'],
    [{ provider: 'openai-compatible', preset: 'openrouter' }, 'OpenRouter API key'],
    [{ provider: 'openai-compatible', preset: 'grok' }, 'Grok API key'],
    [{ provider: 'openai-compatible', preset: 'custom' }, 'Custom API key'],
    [{ provider: 'openai-compatible', preset: null }, 'Custom API key'],
    [{ provider: 'openai-compatible', preset: 'ollama' }, 'Ollama (local)'],
    [{ provider: 'local', preset: null }, 'Claude (local)'],
  ] as const)('%j is "%s"', (settings, label) => expect(keyLabel(settings)).toBe(label))

  it('names the local bridge when the testing lock sends every call there', () => {
    vi.stubEnv('VITE_AI_LOCAL_ONLY', '1')
    expect(keyLabel({ provider: 'openai-compatible', preset: 'openai' })).toBe('Claude (local)')
  })
})
