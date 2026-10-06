import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { accessToken, client } = vi.hoisted(() => ({ accessToken: vi.fn(), client: vi.fn() }))
vi.mock('./cloud', () => ({ accessToken, client }))

import { useSession } from './session'
import {
  autoLinkDue, autoLinkInstallations, installationLinks, InstallationLinkError, linkInstallations, linkWorkspace,
  listInstallationLinks, loadInstallationLinks, requestAutoLink, resetInstallationLinks, type AutoLinkContext,
} from './githubLink'

const mockFetch = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const LINKS = [{ installationId: 11, login: 'acme', linkedAt: '2026-10-06T08:00:00Z' }, { installationId: 12, login: 'octo-labs', linkedAt: '2026-10-06T08:00:01Z' }]
const posts = () => mockFetch.mock.calls.filter(([url]) => url === '/api/github-link')

/** What `client().from('workspace_installations').select(...).eq(...)` answers. */
const rows = (data: unknown[] | null, error: { code?: string; message?: string } | null = null) => {
  const eq = vi.fn(async () => ({ data, error }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  client.mockReturnValue({ from })
  return { from, select, eq }
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  accessToken.mockReset()
  accessToken.mockResolvedValue('supabase-jwt')
  client.mockReset()
  resetInstallationLinks()
  useSession.setState({ status: 'signed-in', githubToken: 'proxy' })
})
afterEach(() => vi.unstubAllGlobals())

describe('linkInstallations', () => {
  it('posts the workspace with the Supabase token and the GitHub cookie', async () => {
    mockFetch.mockResolvedValueOnce(json({ links: LINKS }))

    await expect(linkInstallations('ws-1')).resolves.toEqual(LINKS)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/github-link', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer supabase-jwt' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    })
  })

  it('keeps only well-formed links and answers no links as an empty list', async () => {
    mockFetch.mockResolvedValueOnce(json({ links: [LINKS[0], { login: 'no-id' }, null, { installationId: 'x', login: 'bad' }] }))
    await expect(linkInstallations('ws-1')).resolves.toEqual([LINKS[0]])
    mockFetch.mockResolvedValueOnce(json({ links: [] }))
    await expect(linkInstallations('ws-1')).resolves.toEqual([])
  })

  it.each([
    [401, { error: 'not_signed_in' }, 'not_signed_in'],
    [401, { error: 'not_connected' }, 'not_connected'],
    [403, { error: 'not_manager' }, 'not_manager'],
    [503, { error: 'not_configured' }, 'not_configured'],
    // No (or an unknown) error name: the status decides.
    [401, {}, 'not_signed_in'],
    [403, { error: 'something_new' }, 'not_manager'],
    [503, {}, 'not_configured'],
    [500, { error: 'boom' }, 'other'],
  ])('maps %i %j to %s', async (status, body, code) => {
    mockFetch.mockResolvedValueOnce(json(body, status))
    const failure = await linkInstallations('ws-1').catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(InstallationLinkError)
    expect(failure).toMatchObject({ code })
    expect(mockFetch).toHaveBeenCalledTimes(1) // only token_expired is tried again
  })

  it('says not_signed_in without calling the server when there is no Supabase session', async () => {
    accessToken.mockResolvedValue(null)
    await expect(linkInstallations('ws-1')).rejects.toMatchObject({ code: 'not_signed_in' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps a failed request to network', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('offline'))
    await expect(linkInstallations('ws-1')).rejects.toMatchObject({ code: 'network' })
  })

  it('refreshes the GitHub session on token_expired and tries once more', async () => {
    mockFetch
      .mockResolvedValueOnce(json({ error: 'token_expired' }, 401))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // PATCH /api/github-session
      .mockResolvedValueOnce(json({ links: LINKS }))

    await expect(linkInstallations('ws-1')).resolves.toEqual(LINKS)

    expect(mockFetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
      'POST /api/github-link', 'PATCH /api/github-session', 'POST /api/github-link',
    ])
    expect(mockFetch.mock.calls[1][1]).toEqual({ method: 'PATCH', credentials: 'same-origin' })
  })

  it('gives up after one retry when the token is still expired', async () => {
    mockFetch
      .mockResolvedValueOnce(json({ error: 'token_expired' }, 401))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ error: 'token_expired' }, 401))

    await expect(linkInstallations('ws-1')).rejects.toMatchObject({ code: 'token_expired' })
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(posts()).toHaveLength(2)
  })

  it('still retries when the refresh call itself fails', async () => {
    mockFetch
      .mockResolvedValueOnce(json({ error: 'token_expired' }, 401))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ links: LINKS }))
    await expect(linkInstallations('ws-1')).resolves.toEqual(LINKS)
  })
})

describe('listInstallationLinks', () => {
  it('reads the workspace rows and renames the columns', async () => {
    const q = rows([{ installation_id: 11, account_login: 'acme', linked_at: '2026-10-06T08:00:00Z' }])

    await expect(listInstallationLinks('ws-1')).resolves.toEqual([LINKS[0]])

    expect(q.from).toHaveBeenCalledWith('workspace_installations')
    expect(q.select).toHaveBeenCalledWith('installation_id, account_login, linked_at')
    expect(q.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
  })

  it('treats a missing table as not configured and any other failure as a failed read', async () => {
    rows(null, { code: '42P01' })
    await expect(listInstallationLinks('ws-1')).rejects.toMatchObject({ code: 'not_configured' })
    rows(null, { code: '500', message: 'down' })
    await expect(listInstallationLinks('ws-1')).rejects.toMatchObject({ code: 'load_failed' })
  })
})

describe('link state per workspace', () => {
  it('loads the links into the store', async () => {
    rows([{ installation_id: 11, account_login: 'acme', linked_at: '2026-10-06T08:00:00Z' }])
    expect(installationLinks('ws-1')).toMatchObject({ links: [], status: 'idle', error: null })

    const loaded = loadInstallationLinks('ws-1')
    expect(installationLinks('ws-1').status).toBe('loading')
    await loaded

    expect(installationLinks('ws-1')).toMatchObject({ links: [LINKS[0]], status: 'ready', error: null })
    expect(installationLinks('ws-2').status).toBe('idle') // per workspace
  })

  it('records a failed read as an error, not a throw', async () => {
    rows(null, { code: '500' })
    await loadInstallationLinks('ws-1')
    expect(installationLinks('ws-1')).toMatchObject({ links: [], status: 'error', error: 'load_failed' })
  })

  it('keeps the links when a later attempt fails, and remembers when no installation was found', async () => {
    mockFetch.mockResolvedValueOnce(json({ links: LINKS }))
    await linkWorkspace('ws-1')
    expect(installationLinks('ws-1')).toMatchObject({ links: LINKS, status: 'ready', noInstall: false })

    mockFetch.mockResolvedValueOnce(json({ error: 'not_manager' }, 403))
    await linkWorkspace('ws-1')
    expect(installationLinks('ws-1')).toMatchObject({ links: LINKS, status: 'error', error: 'not_manager' })

    resetInstallationLinks()
    mockFetch.mockResolvedValueOnce(json({ links: [] }))
    await linkWorkspace('ws-1')
    expect(installationLinks('ws-1')).toMatchObject({ links: [], status: 'ready', noInstall: true })
  })

  it('shares one request between two callers', async () => {
    mockFetch.mockResolvedValueOnce(json({ links: LINKS }))
    await Promise.all([linkWorkspace('ws-1'), linkWorkspace('ws-1')])
    expect(posts()).toHaveLength(1)
  })

  it('forgets everything on sign-out', async () => {
    mockFetch.mockResolvedValueOnce(json({ links: LINKS }))
    await linkWorkspace('ws-1')
    useSession.setState({ status: 'signed-out' })
    expect(installationLinks('ws-1').links).toEqual([])
  })
})

describe('automatic link', () => {
  const ctx: AutoLinkContext = { signedIn: true, demo: false, githubConnected: true, canManage: true, hasRepoApp: true, pickerOpen: false }
  const loadedWith = async (data: unknown[]) => {
    rows(data)
    await loadInstallationLinks('ws-1')
  }

  it('waits until the links are read', async () => {
    expect(autoLinkDue('ws-1', ctx)).toBe(false)
    await loadedWith([])
    expect(autoLinkDue('ws-1', ctx)).toBe(true)
  })

  it('runs for an owner or admin whose workspace has no links, and only once', async () => {
    await loadedWith([])
    mockFetch.mockResolvedValue(json({ links: [] })) // installed nowhere yet: still only one attempt

    await autoLinkInstallations('ws-1', ctx)
    await autoLinkInstallations('ws-1', ctx)
    await autoLinkInstallations('ws-1', ctx)

    expect(posts()).toHaveLength(1)
    expect(installationLinks('ws-1').noInstall).toBe(true)
  })

  it('does not run again after a failed attempt, and keeps the error for Settings', async () => {
    await loadedWith([])
    mockFetch.mockResolvedValue(json({ error: 'not_configured' }, 503))

    await expect(autoLinkInstallations('ws-1', ctx)).resolves.toBeUndefined() // never throws
    await autoLinkInstallations('ws-1', ctx)

    expect(posts()).toHaveLength(1)
    expect(installationLinks('ws-1')).toMatchObject({ status: 'error', error: 'not_configured' })
  })

  it.each([
    ['a member', { canManage: false }],
    ['signed out', { signedIn: false }],
    ['the demo or sample workspace', { demo: true }],
    ['GitHub not connected', { githubConnected: false }],
    ['no app with a repo yet', { hasRepoApp: false }],
    ['the repo picker still open', { pickerOpen: true }],
  ])('does not run for %s', async (_name, change) => {
    await loadedWith([])
    await autoLinkInstallations('ws-1', { ...ctx, ...change })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not run when the workspace already has links', async () => {
    await loadedWith([{ installation_id: 11, account_login: 'acme', linked_at: '2026-10-06T08:00:00Z' }])
    await autoLinkInstallations('ws-1', ctx)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not run when the links could not be read', async () => {
    rows(null, { code: '500' })
    await loadInstallationLinks('ws-1')
    await autoLinkInstallations('ws-1', ctx)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('runs once more after the repo picker adds apps, even with links and an earlier attempt', async () => {
    await loadedWith([{ installation_id: 11, account_login: 'acme', linked_at: '2026-10-06T08:00:00Z' }])
    mockFetch.mockResolvedValue(json({ links: LINKS }))
    await linkWorkspace('ws-1')
    expect(posts()).toHaveLength(1)
    expect(autoLinkDue('ws-1', ctx)).toBe(false)

    requestAutoLink('ws-1')
    expect(autoLinkDue('ws-1', { ...ctx, pickerOpen: true })).toBe(false) // wait for the picker to close
    await autoLinkInstallations('ws-1', ctx)
    await autoLinkInstallations('ws-1', ctx)

    expect(posts()).toHaveLength(2)
  })
})
