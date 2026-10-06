import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { useSession } from '../data/session'
import { clearGitHubCache } from '../data/github'
import { callTool } from './client'
import { aiSyncApp } from './router'

// Sync all's progress window asks aiSyncApp where it is: reading GitHub, then (with a key) writing the description.
vi.mock('./client', async (original) => ({ ...(await original<typeof import('./client')>()), callTool: vi.fn() }))

const mockFetch = vi.fn<typeof fetch>()
const json = (body: unknown) => new Response(JSON.stringify(body))
let projectId: string

beforeEach(() => {
  vi.stubEnv('VITE_AI_MODE', 'legacy')
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url) => {
    const u = String(url)
    if (u.endsWith('/acme/web')) return json({ full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: false, default_branch: 'main', description: null, pushed_at: null })
    if (u.includes('/readme')) return new Response('# Web')
    if (u.includes('/git/trees/')) return json({ tree: [] })
    return json([])
  })
  vi.mocked(callTool).mockReset()
  vi.mocked(callTool).mockRejectedValue(new Error('no answer'))
  clearGitHubCache()
  useStore.getState().resetAll()
  useStore.getState().setAI({ provider: 'anthropic', apiKey: 'sk-test' })
  useSession.setState({ githubToken: 'test-token' })
  projectId = useStore.getState().createProject({ name: 'Web', repo: { fullName: 'acme/web', url: 'https://github.com/acme/web', private: false, defaultBranch: 'main' } }).id
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('aiSyncApp steps', () => {
  it('says "reading" before it asks GitHub and "writing" right before the AI call', async () => {
    const seen: Array<[string, number, number]> = []
    await aiSyncApp(projectId, { onStep: (step) => seen.push([step, mockFetch.mock.calls.length, vi.mocked(callTool).mock.calls.length]) })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual(['reading', 0, 0])
    expect(seen[1][0]).toBe('writing')
    expect(seen[1][1]).toBeGreaterThan(0) // GitHub was read first
    expect(seen[1][2]).toBe(0) // and the AI had not been called yet
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('only reads when it is told to stay with the facts', async () => {
    const steps: string[] = []
    await aiSyncApp(projectId, { factsOnly: true, onStep: (step) => steps.push(step) })
    expect(steps).toEqual(['reading'])
    expect(callTool).not.toHaveBeenCalled()
  })

  it('works without a listener', async () => {
    await expect(aiSyncApp(projectId, { factsOnly: true })).resolves.toMatchObject({ source: 'fallback' })
  })
})
