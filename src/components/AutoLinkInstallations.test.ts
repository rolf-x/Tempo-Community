import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { accessToken, client } = vi.hoisted(() => ({ accessToken: vi.fn(), client: vi.fn() }))
vi.mock('../data/cloud', () => ({ accessToken, client }))
// Server rendering skips effects and shows every store's first state. Run the effects as the component renders and read
// the stores' current state, so each render stands for a render in the browser.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useEffect: (effect: () => void) => { effect() } }))
vi.mock('../store/useStore', async (original) => {
  const actual = await original<typeof import('../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})
vi.mock('../data/session', async (original) => {
  const actual = await original<typeof import('../data/session')>()
  return { ...actual, useSession: Object.assign((selector: (state: ReturnType<typeof actual.useSession.getState>) => unknown) => selector(actual.useSession.getState()), actual.useSession) }
})
vi.mock('./uiState', async (original) => {
  const actual = await original<typeof import('./uiState')>()
  return { ...actual, useUI: Object.assign((selector: (state: ReturnType<typeof actual.useUI.getState>) => unknown) => selector(actual.useUI.getState()), actual.useUI) }
})
vi.mock('../data/githubLink', async (original) => {
  const actual = await original<typeof import('../data/githubLink')>()
  return { ...actual, useInstallationLinks: (id: string | null) => actual.installationLinks(id ?? '') }
})

import { installationLinks, resetInstallationLinks } from '../data/githubLink'
import { useSession } from '../data/session'
import { appDefaults } from '../lib/model'
import { useStore } from '../store/useStore'
import type { Member, Project } from '../types'
import { AutoLinkInstallations } from './AutoLinkInstallations'
import { useUI } from './uiState'

const mockFetch = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const posts = () => mockFetch.mock.calls.filter(([url]) => url === '/api/github-link')
const mount = () => renderToStaticMarkup(createElement(AutoLinkInstallations))
const links = (data: unknown[]) => client.mockReturnValue({ from: () => ({ select: () => ({ eq: async () => ({ data, error: null }) }) }) })
// The read and the link are real async work (a dynamic import, then a request): wait until the store is no longer busy.
const flush = () => vi.waitFor(() => expect(installationLinks('ws-1').status).not.toBe('loading'))

const member = (id: string, role: Member['role'], isAdmin = false): Member => ({ id, name: id, email: null, avatarUrl: null, githubLogin: id, userId: id, role, isAdmin, active: true })
const app = (repo: string | null): Project => ({
  ...appDefaults(), id: repo ?? 'draft', name: repo ?? 'draft', emoji: 'A', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false, ownerId: 'maya',
  repo: repo ? { fullName: repo, url: `https://github.com/${repo}`, private: true, defaultBranch: 'main' } : null,
})

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockResolvedValue(json({ links: [{ installationId: 11, login: 'acme', linkedAt: '2026-10-06T08:00:00Z' }] }))
  accessToken.mockResolvedValue('jwt')
  links([])
  resetInstallationLinks()
  useStore.getState().resetAll()
  useStore.setState({ workspace: { id: 'ws-1', name: 'Acme', kind: 'org' }, members: [member('maya', 'owner'), member('sam', 'member')], meId: 'maya', projects: [app('acme/web')] })
  useSession.setState({ status: 'signed-in', githubToken: 'proxy' })
  useUI.getState().setRepoPickerOpen(false)
})

describe('AutoLinkInstallations', () => {
  it('shows nothing', () => {
    expect(mount()).toBe('')
  })

  it('reads the links first, then links an owner\'s workspace that has none, once per page load', async () => {
    mount() // reads the links
    expect(mockFetch).not.toHaveBeenCalled()
    await flush()
    mount() // the links are in and empty
    await flush()
    mount()
    mount()

    expect(posts()).toHaveLength(1)
    expect(installationLinks('ws-1')).toMatchObject({ status: 'ready', links: [{ login: 'acme' }] })
  })

  it('links for an admin too', async () => {
    useStore.setState({ members: [member('maya', 'member', true)] })
    mount(); await flush(); mount(); await flush()
    expect(posts()).toHaveLength(1)
  })

  it('leaves a member alone', async () => {
    useStore.setState({ meId: 'sam' })
    mount(); await flush(); mount(); await flush()
    expect(posts()).toHaveLength(0)
  })

  it('leaves a workspace that is already linked alone', async () => {
    links([{ installation_id: 11, account_login: 'acme', linked_at: '2026-10-06T08:00:00Z' }])
    mount(); await flush(); mount(); await flush()
    expect(posts()).toHaveLength(0)
  })

  it.each([
    ['demo mode', () => useStore.setState({ settings: { ...useStore.getState().settings, demo: true } })],
    ['signed out', () => useSession.setState({ status: 'signed-out' })],
    ['GitHub not connected', () => useSession.setState({ githubToken: null })],
    ['no app with a repo', () => useStore.setState({ projects: [app(null)] })],
    ['only sample apps', () => useStore.setState({ projects: [app('acme-sample/web')] })],
  ])('does nothing in %s', async (_name, setup) => {
    setup()
    mount(); await flush(); mount(); await flush()
    expect(posts()).toHaveLength(0)
  })

  it('waits for the repo picker, then links again once after it added apps', async () => {
    mount(); await flush(); mount(); await flush()
    expect(posts()).toHaveLength(1)

    const { requestAutoLink } = await import('../data/githubLink')
    useUI.getState().setRepoPickerOpen(true)
    requestAutoLink('ws-1')
    mount()
    await flush()
    expect(posts()).toHaveLength(1)

    useUI.getState().setRepoPickerOpen(false)
    mount(); await flush(); mount()
    expect(posts()).toHaveLength(2)
  })

  it('never throws or raises an error when the server says no', async () => {
    mockFetch.mockResolvedValue(json({ error: 'not_configured' }, 503))
    mount(); await flush(); mount(); await flush()
    expect(() => mount()).not.toThrow()
    expect(installationLinks('ws-1')).toMatchObject({ status: 'error', error: 'not_configured' })
    expect(useSession.getState().error).toBeNull()
  })
})
