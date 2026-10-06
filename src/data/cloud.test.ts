import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const { auth, from, rpc, channel, removeChannel } = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() },
  from: vi.fn(),
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from, rpc, channel, removeChannel }) }))

import { useStore } from '../store/useStore'
import { useSession } from './session'
import { acceptInviteAppsCloud, acceptInviteCloud, connectGitHubInPopup, createInviteCloud, disconnectGitHub, initCloud, initGitHubPopup, listInvitesCloud, peekInvite, previewInviteCloud, removedWorkspaceCloud, requeue, restoreRows, revokeInviteCloud, setWorkspaceGitHubOrgCloud, setupWorkspaceCloud, startSync, stopSync, withoutProviderToken } from './cloud'

class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.push(this)
  }
}

const originalWindow = globalThis.window
afterAll(() => vi.stubGlobal('window', originalWindow))

describe('GitHub cookie session', () => {
  const providerToken = 'gho_0123456789abcdefghijklmnopqrstuv'
  let authChange: (event: string, session: unknown) => void
  let values: Map<string, string>
  let storage: {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
  }
  const mockFetch = vi.fn<typeof fetch>()

  beforeEach(() => {
    values = new Map()
    storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
      removeItem: vi.fn((key: string) => { values.delete(key) }),
    }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('history', { replaceState: vi.fn() })
    vi.stubGlobal('window', {
      location: { origin: 'https://tempo.example', pathname: '/', search: '', hash: '' },
      dispatchEvent: vi.fn(),
    })
    mockFetch.mockReset()
    auth.getSession.mockReset().mockResolvedValue({ data: { session: null } })
    auth.signInWithOAuth.mockReset().mockResolvedValue({ error: null })
    auth.signOut.mockReset().mockResolvedValue({ error: null })
    auth.onAuthStateChange.mockReset().mockImplementation((callback) => {
      authChange = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    useSession.setState({ status: 'loading', user: null, githubToken: null, error: null })
    useStore.getState().resetAll()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', originalWindow)
  })

  it('posts a provider token without writing it to localStorage', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ connected: true, login: 'maya' }), { status: 200 }))
    await initCloud()

    authChange('SIGNED_IN', {
      provider_token: providerToken,
      user: { app_metadata: { provider: 'github' } },
    })
    await vi.waitFor(() => expect(useSession.getState().githubToken).toBe('proxy'))

    expect(mockFetch).toHaveBeenCalledWith('/api/github-session', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: providerToken }),
    }))
    expect(storage.setItem).not.toHaveBeenCalledWith('tempo.githubToken', providerToken)
    expect(values.get('tempo.githubConnected')).toBe('1')
  })

  it('sends the provider refresh token but never stores it', async () => {
    const refreshToken = 'ghr_0123456789abcdefghijklmnopqrstuv'
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ connected: true, login: 'maya' }), { status: 200 }))
    await initCloud()

    authChange('SIGNED_IN', {
      provider_token: providerToken,
      provider_refresh_token: refreshToken,
      user: { app_metadata: { provider: 'github' } },
    })
    await vi.waitFor(() => expect(useSession.getState().githubToken).toBe('proxy'))

    expect(mockFetch).toHaveBeenCalledWith('/api/github-session', expect.objectContaining({
      body: JSON.stringify({ token: providerToken, refreshToken }),
    }))
    expect([...values.values()].join(' ')).not.toContain(providerToken)
    expect([...values.values()].join(' ')).not.toContain(refreshToken)
  })

  it('keeps the dev OAuth scopes unless GitHub App mode is enabled', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    await initCloud()
    await useSession.getState().signIn('github')
    expect(auth.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://tempo.example/', scopes: 'repo read:user user:email read:org' },
    })

    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    await useSession.getState().signIn('github')
    expect(auth.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://tempo.example/' },
    })
  })

  it('fails closed in production when the GitHub App slug is missing', async () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    vi.stubEnv('PROD', true)
    await initCloud()
    auth.signInWithOAuth.mockClear()
    await useSession.getState().signIn('github')
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
    expect(useSession.getState().error).toMatch(/GitHub App/)
  })

  it('migrates and removes the legacy token', async () => {
    values.set('tempo.githubToken', providerToken)
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ connected: true }), { status: 200 }))

    await initCloud()

    expect(mockFetch).toHaveBeenCalledWith('/api/github-session', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: providerToken }),
    }))
    expect(values.has('tempo.githubToken')).toBe(false)
    await vi.waitFor(() => expect(useSession.getState().githubToken).toBe('proxy'))
  })

  it('keeps a failed migration only in memory', async () => {
    values.set('tempo.githubToken', providerToken)
    mockFetch.mockRejectedValue(new TypeError('offline'))

    await initCloud()

    expect(values.has('tempo.githubToken')).toBe(false)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(useSession.getState().githubToken).toBe(providerToken)
  })

  it('leaves the GitHub token out of the saved Supabase session', () => {
    const saved = JSON.parse(withoutProviderToken(JSON.stringify({ access_token: 'a', provider_token: providerToken, provider_refresh_token: 'r' })))
    expect(saved).toEqual({ access_token: 'a' })
    expect(withoutProviderToken('code-verifier')).toBe('code-verifier')
  })

  it('deletes the cookie session and both storage keys on sign-out', async () => {
    values.set('tempo.githubToken', providerToken)
    values.set('tempo.githubConnected', '1')
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ connected: true }), { status: 200 }))
    await initCloud()
    mockFetch.mockClear()

    await useSession.getState().signOut()

    expect(mockFetch).toHaveBeenCalledWith('/api/github-session', expect.objectContaining({ method: 'DELETE' }))
    // This browser only: a global sign-out would also end connected AI apps' sessions.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(values.has('tempo.githubToken')).toBe(false)
    expect(values.has('tempo.githubConnected')).toBe(false)
    expect(useSession.getState().githubToken).toBeNull()
  })

  it('deletes the cookie session after a remote sign-out event', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    await initCloud()
    useSession.setState({ status: 'signed-in', githubToken: 'proxy' })
    mockFetch.mockClear()

    authChange('SIGNED_OUT', null)

    expect(mockFetch).toHaveBeenCalledWith('/api/github-session', expect.objectContaining({ method: 'DELETE' }))
    expect(useSession.getState().githubToken).toBeNull()
  })

  it('disconnects GitHub without signing out of Supabase or reconnecting from its session', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ connected: false, revoked: true }), { status: 200 }))
    await initCloud()
    values.set('tempo.githubToken', providerToken)
    values.set('tempo.githubConnected', '1')
    const user = { id: 'user-1', name: 'Maya', email: 'maya@example.com', avatarUrl: null, githubLogin: 'maya', lastSignInAt: null }
    useSession.setState({ status: 'signed-in', user, githubToken: 'proxy' })
    mockFetch.mockClear()

    await expect(disconnectGitHub()).resolves.toEqual({ revoked: true })
    authChange('TOKEN_REFRESHED', {
      provider_token: providerToken,
      user: { app_metadata: { provider: 'github' } },
    })

    expect(mockFetch).toHaveBeenCalledExactlyOnceWith('/api/github-session?revoke=1', {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    expect(values.has('tempo.githubToken')).toBe(false)
    expect(values.has('tempo.githubConnected')).toBe(false)
    expect(useSession.getState()).toMatchObject({ status: 'signed-in', user, githubToken: null })
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})

describe('GitHub popup', () => {
  const popup = { closed: false, close: vi.fn(), location: { href: '' } }
  const mockFetch = vi.fn<typeof fetch>()

  beforeEach(() => {
    FakeBroadcastChannel.channels = []
    popup.closed = false
    popup.close.mockReset()
    popup.location.href = ''
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })
    vi.stubGlobal('history', { replaceState: vi.fn() })
    vi.stubGlobal('window', {
      location: { origin: 'https://tempo.example', pathname: '/', search: '', hash: '' },
      open: vi.fn(() => popup),
      close: vi.fn(),
      setInterval,
      clearInterval,
    })
    auth.signInWithOAuth.mockReset().mockResolvedValue({ data: { url: 'https://github.com/login/oauth' }, error: null })
    auth.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
    auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    mockFetch.mockReset()
    useSession.setState({ status: 'signed-in', githubToken: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', originalWindow)
  })

  it('opens before OAuth starts and points the popup at GitHub', async () => {
    const result = connectGitHubInPopup()
    expect(vi.mocked(window.open).mock.invocationCallOrder[0]).toBeLessThan(auth.signInWithOAuth.mock.invocationCallOrder[0])
    await vi.waitFor(() => expect(popup.location.href).toBe('https://github.com/login/oauth'))
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: {
        redirectTo: 'https://tempo.example/?github_popup=1',
        skipBrowserRedirect: true,
        scopes: 'repo read:user user:email read:org',
      },
    })
    FakeBroadcastChannel.channels[0].onmessage?.({ data: { type: 'connected' } } as MessageEvent)
    await expect(result).resolves.toEqual({ status: 'connected' })
    expect(useSession.getState().githubToken).toBe('proxy')
  })

  it('returns blocked without starting OAuth', async () => {
    vi.mocked(window.open).mockReturnValueOnce(null)
    await expect(connectGitHubInPopup()).resolves.toEqual({ status: 'blocked' })
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
  })

  it('returns cancelled when the popup closes', async () => {
    vi.useFakeTimers()
    const result = connectGitHubInPopup()
    popup.closed = true
    await vi.advanceTimersByTimeAsync(250)
    await expect(result).resolves.toEqual({ status: 'cancelled' })
    vi.useRealTimers()
  })

  it('returns failed when OAuth fails', async () => {
    auth.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: new Error('no') })
    await expect(connectGitHubInPopup()).resolves.toEqual({ status: 'failed' })
    expect(popup.close).toHaveBeenCalled()
  })

  it('finishes popup mode without rendering app state or broadcasting a token', async () => {
    const providerToken = 'gho_popup_token'
    window.location.search = '?github_popup=1&code=abc&keep=1'
    window.location.hash = '#/app'
    auth.getSession.mockResolvedValueOnce({
      data: { session: { provider_token: providerToken, provider_refresh_token: null, user: { app_metadata: { provider: 'github' } } } },
      error: null,
    })
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ connected: true }), { status: 200 }))

    await initGitHubPopup()

    expect(FakeBroadcastChannel.channels[0].postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'connected' })
    expect(JSON.stringify(FakeBroadcastChannel.channels[0].postMessage.mock.calls)).not.toContain(providerToken)
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?keep=1#/app')
    expect(window.close).toHaveBeenCalled()
  })

  it('broadcasts popup failure and strips OAuth params', async () => {
    window.location.search = '?github_popup=1&error=access_denied&error_description=No'

    await initGitHubPopup()

    expect(FakeBroadcastChannel.channels[0].postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failed' })
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?error=access_denied&error_description=No')
    expect(window.close).not.toHaveBeenCalled()
  })
})

describe('peekInvite', () => {
  const token = '0123456789abcdef0123456789abcdef'
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    auth.getSession.mockReset()
    auth.getSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal('window', {
      location: { origin: 'https://tempo.example', pathname: '/', search: '' },
      dispatchEvent: vi.fn(),
    })
    useStore.setState({ workspace: { id: 'workspace-1', name: 'Halden Freight', kind: 'org' } })
  })

  it.each(['ok', 'expired', 'used', 'missing'])('returns %s without accepting the invite', async (status) => {
    rpc.mockResolvedValue({ data: status, error: null })
    expect(await peekInvite(token)).toBe(status)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('invite_status', { p_token: token })
  })
  it('rejects malformed tokens without a server call', async () => {
    expect(await peekInvite('bad-link')).toBe('missing')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['PGRST202', '42883', '42501'])('falls back when RPC fails with %s', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code } })
    expect(await peekInvite(token)).toBeNull()
  })
  it('falls back when the request throws', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    expect(await peekInvite(token)).toBeNull()
  })
  it.each([null, 'unexpected', { status: 'ok' }])('falls back for an unexpected response: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    expect(await peekInvite(token)).toBeNull()
  })
})

describe('invite app RPCs', () => {
  const token = '0123456789abcdef0123456789abcdef'

  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    auth.getSession.mockReset()
    auth.getSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal('window', {
      location: { origin: 'https://tempo.example', pathname: '/', search: '' },
      dispatchEvent: vi.fn(),
    })
    useStore.setState({ workspace: { id: 'workspace-1', name: 'Halden Freight', kind: 'org' } })
  })

  it('reads the public preview without exposing or inventing fields', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'ok',
        inviter_name: 'Maya',
        workspace_name: 'Halden Freight',
        apps: [{ id: 'app-1', name: 'Route planner', repo: 'halden/route-planner' }],
      },
      error: null,
    })

    await expect(previewInviteCloud(token)).resolves.toEqual({
      status: 'ok',
      inviterName: 'Maya',
      workspaceName: 'Halden Freight',
      apps: [{ id: 'app-1', name: 'Route planner', repo: 'halden/route-planner' }],
    })
    expect(rpc).toHaveBeenCalledWith('invite_preview', { p_token: token })
  })

  it('passes on the removed status for a link made before the removal', async () => {
    rpc.mockResolvedValue({ data: { status: 'removed', inviter_name: 'Maya', workspace_name: 'Halden Freight', apps: [] }, error: null })
    await expect(previewInviteCloud(token)).resolves.toMatchObject({ status: 'removed', workspaceName: 'Halden Freight' })
  })

  it('stores the unique app ids on a new invite', async () => {
    const single = vi.fn().mockResolvedValue({ data: { token, expires_at: '2026-10-11T12:00:00Z' }, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    from.mockReturnValue({ insert })

    await expect(createInviteCloud(' sam@example.com ', ['app-1', 'app-1', ' app-2 '])).resolves.toEqual({
      url: `https://tempo.example/#/join/${token}`,
      expiresAt: '2026-10-11T12:00:00Z',
    })
    expect(from).toHaveBeenCalledWith('invites')
    expect(insert).toHaveBeenCalledWith({
      workspace_id: 'workspace-1',
      email: 'sam@example.com',
      app_ids: ['app-1', 'app-2'],
    })
  })

  it('revokes an invite by its token, the only key the invites table has', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ token }], error: null })
    const eq = vi.fn()
    const chain = { eq, select }
    eq.mockReturnValue(chain)
    const del = vi.fn(() => chain)
    from.mockReturnValue({ delete: del })

    await expect(revokeInviteCloud(token)).resolves.toBeUndefined()
    expect(from).toHaveBeenCalledWith('invites')
    expect(eq.mock.calls).toEqual([['workspace_id', 'workspace-1'], ['token', token]])
    expect(eq).not.toHaveBeenCalledWith('id', expect.anything())
    expect(select).toHaveBeenCalledWith('token')
  })

  it('reports a revoke that the access rules refused instead of claiming success', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn()
    const chain = { eq, select }
    eq.mockReturnValue(chain)
    from.mockReturnValue({ delete: () => chain })

    await expect(revokeInviteCloud(token)).rejects.toThrow('Only the owner or an admin can')
  })

  it('confirms only the selected apps and sends the optional note', async () => {
    rpc.mockResolvedValue({ data: { workspace_id: 'workspace-1', name: 'Halden Freight' }, error: null })

    await expect(acceptInviteAppsCloud(token, ['app-1', 'app-1'], ' Not the fuel app ')).resolves.toBe('Halden Freight')
    expect(rpc).toHaveBeenCalledWith('accept_invite_apps', {
      p_token: token,
      p_confirmed: ['app-1'],
      p_note: 'Not the fuel app',
    })
  })

  it('maps the manager invite list and builds join URLs locally', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: token,
        token,
        email: 'sam@example.com',
        created_at: '2026-10-04T12:00:00Z',
        expires_at: '2026-10-11T12:00:00Z',
        used_at: null,
        declined_at: null,
        decline_note: null,
        app_ids: ['app-1'],
        apps: [{ id: 'app-1', name: 'Route planner' }],
        inviter_name: 'Maya',
        invitee_name: 'Sam',
        joined_member_name: null,
      }],
      error: null,
    })

    const result = await listInvitesCloud()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: token,
      appIds: ['app-1'],
      inviterName: 'Maya',
      inviteeName: 'Sam',
      url: `https://tempo.example/#/join/${token}`,
    })
    expect(rpc).toHaveBeenCalledWith('list_invites', { p_workspace: 'workspace-1' })
  })
})

describe('removed workspace recovery', () => {
  const token = '0123456789abcdef0123456789abcdef'

  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    auth.getSession.mockReset()
    auth.getSession.mockResolvedValue({ data: { session: null } })
    useSession.setState({ needsSetup: true, removedFrom: { name: 'Old team' } })
  })

  afterEach(() => stopSync())

  it('reads the workspace name exposed by the optional removal RPC', async () => {
    rpc.mockResolvedValue({ data: [{ workspace_id: 'workspace-1', name: 'Halden Freight' }], error: null })

    await expect(removedWorkspaceCloud()).resolves.toEqual({ name: 'Halden Freight' })
    expect(rpc).toHaveBeenCalledWith('my_removed_workspaces')
  })

  it.each(['42883', '42703', 'PGRST202', 'PGRST204'])('quietly keeps the old setup flow when the RPC is unavailable (%s)', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'not in schema cache' } })
    await expect(removedWorkspaceCloud()).resolves.toBeNull()
  })

  it('does not hide unrelated failures while checking removed workspaces', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'database unavailable' } })
    await expect(removedWorkspaceCloud()).rejects.toThrow('database unavailable')
  })

  it('accepts the workspace invite, loads it and clears the removal state', async () => {
    const workspace = { id: 'workspace-1', name: 'Halden Freight', kind: 'org' }
    const member = {
      id: 'member-1', workspace_id: workspace.id, user_id: 'user-1', name: 'Sam', email: null,
      avatar_url: null, github_login: null, role: 'member', active: true, leaving_on: null,
    }
    rpc.mockResolvedValue({ data: { workspace_id: 'workspace-1', name: 'Halden Freight' }, error: null })
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    from.mockImplementation((table: string) => ({
      select: (columns: string) => {
        if (table === 'members' && columns.startsWith('workspace_id')) {
          return { eq: () => ({ eq: () => Promise.resolve({ data: [{ workspace_id: workspace.id, workspaces: workspace }], error: null }) }) }
        }
        if (table === 'activity') {
          return { eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }
        }
        return { eq: () => Promise.resolve({ data: table === 'members' ? [member] : [], error: null }) }
      },
    }))
    channel.mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })

    await expect(acceptInviteCloud(token)).resolves.toBe('Halden Freight')
    expect(rpc).toHaveBeenCalledWith('accept_invite', { p_token: token })
    expect(useSession.getState()).toMatchObject({ needsSetup: false, removedFrom: null })
    expect(useStore.getState()).toMatchObject({ workspace, meId: 'member-1' })
  })
})

describe('concurrent workspace setup', () => {
  const workspace = { id: 'workspace-1', name: 'Halden Freight', kind: 'org' as const, github_org: 'halden' }
  const member = {
    id: 'member-1', workspace_id: workspace.id, user_id: 'user-1', name: 'Sam', email: null,
    avatar_url: null, github_login: 'sam', role: 'owner' as const, active: true, leaving_on: null,
  }

  function mockWorkspaceReads(memberships: Array<typeof workspace | null>) {
    from.mockImplementation((table: string) => ({
      select: (columns: string) => {
        if (table === 'members' && columns.startsWith('workspace_id')) {
          const found = memberships.shift()
          return { eq: () => ({ eq: () => Promise.resolve({
            data: found ? [{ workspace_id: found.id, workspaces: found }] : [],
            error: null,
          }) }) }
        }
        if (table === 'activity') {
          return { eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }
        }
        return { eq: () => Promise.resolve({ data: table === 'members' ? [member] : [], error: null }) }
      },
    }))
  }

  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    channel.mockReset().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })
    auth.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    useStore.getState().resetAll()
    useStore.setState({ meId: 'local-member' })
    useSession.setState({ needsSetup: true, removedFrom: null, error: null })
  })

  afterEach(() => stopSync())

  it('adopts an existing membership before trying to create another workspace', async () => {
    mockWorkspaceReads([workspace])

    await expect(setupWorkspaceCloud('org', 'Different choice', 'different-org')).resolves.toBeUndefined()

    expect(rpc).not.toHaveBeenCalledWith('create_workspace_of_kind', expect.anything())
    expect(useStore.getState()).toMatchObject({ workspace: { id: workspace.id, name: workspace.name, githubOrg: 'halden' }, meId: member.id })
    expect(useSession.getState().needsSetup).toBe(false)
  })

  it('recovers a 23505 race by loading the workspace created in the other tab', async () => {
    mockWorkspaceReads([null, workspace])
    rpc.mockImplementation(async (name: string) => {
      if (name === 'my_removed_workspaces') return { data: [], error: null }
      if (name === 'create_workspace_of_kind') return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "members_pkey"' } }
      return { data: null, error: null }
    })

    await expect(setupWorkspaceCloud('org', 'Halden Freight', 'halden')).resolves.toBeUndefined()

    expect(rpc).toHaveBeenCalledWith('create_workspace_of_kind', { p_name: 'Halden Freight', p_kind: 'org', p_member_id: 'local-member' })
    expect(useStore.getState().workspace?.id).toBe(workspace.id)
    expect(useSession.getState().needsSetup).toBe(false)
  })

  it('does not expose database text when workspace creation fails', async () => {
    mockWorkspaceReads([null])
    rpc.mockImplementation(async (name: string) => name === 'my_removed_workspaces'
      ? { data: [], error: null }
      : { data: null, error: { code: 'XX000', message: 'raw database details' } })

    const error = await setupWorkspaceCloud('org', 'Halden Freight', 'halden').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("Tempo couldn't create the workspace")
    expect((error as Error).message).not.toContain('raw database details')
  })
})

describe('workspace GitHub organization', () => {
  beforeEach(() => {
    rpc.mockReset()
    useStore.setState({ workspace: { id: 'workspace-1', name: 'Halden Freight', kind: 'org', githubOrg: null } })
  })

  it('saves through the manager RPC and updates the workspace store', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await expect(setWorkspaceGitHubOrgCloud(' Halden-Team ')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('set_workspace_github_org', { ws: 'workspace-1', org: 'Halden-Team' })
    expect(useStore.getState().workspace?.githubOrg).toBe('Halden-Team')
  })

  it.each(['42883', '42703', 'PGRST202', 'PGRST204'])('quietly keeps the browser fallback when the migration is missing (%s)', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'missing' } })

    await expect(setWorkspaceGitHubOrgCloud('halden')).resolves.toBe(false)
    expect(useStore.getState().workspace?.githubOrg).toBeNull()
  })

  it('does not hide other database failures', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only managers can do that.' } })

    await expect(setWorkspaceGitHubOrgCloud('halden')).rejects.toThrow('Only managers can do that.')
  })
})

describe('cloud sync retries failed saves', () => {
  const ok = { error: null }
  const fail = { error: { message: 'Failed to fetch' } }
  const p1 = { id: 'p1', name: 'Route planner' }
  const p2 = { id: 'p2', name: 'Fuel log' }
  let upsert: Mock<(rows: unknown) => Promise<unknown>>
  let select: Mock<(columns: string) => void>
  let del: ReturnType<typeof vi.fn>
  let win: EventTarget

  beforeEach(() => {
    vi.useFakeTimers()
    from.mockReset()
    upsert = vi.fn()
    select = vi.fn()
    del = vi.fn()
    // `upsert(rows)` is awaitable by itself (activity) and also has `.select(columns)` (projects ask for the stored rows).
    from.mockImplementation(() => ({
      upsert: (rows: unknown) => {
        const run = () => upsert(rows)
        return { select: (columns: string) => { select(columns); return run() }, then: (resolve: never, reject: never) => run().then(resolve, reject) }
      },
      delete: () => ({ in: del }),
    }))
    channel.mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })
    win = new EventTarget()
    vi.stubGlobal('window', win)
    useSession.setState({ error: null, pendingSave: false })
    useStore.setState({ projects: [p1, p2] as never, members: [], activity: [] })
    startSync('workspace-1')
  })
  afterEach(() => {
    stopSync()
    vi.useRealTimers()
  })

  const rename = (name: string) => useStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === 'p1' ? { ...p, name } : p)) }))
  const sentNames = () => upsert.mock.calls.map(([rows]) => (rows as { data: { name: string } }[]).map((r) => r.data.name))

  it('re-sends a failed upsert on the next flush and clears the error once it lands', async () => {
    upsert.mockResolvedValueOnce(fail).mockResolvedValue(ok)
    rename('Route planner v2')
    await vi.advanceTimersByTimeAsync(400)
    expect(useSession.getState()).toMatchObject({ error: "Some changes didn't save: you seem to be offline", pendingSave: true })

    await vi.advanceTimersByTimeAsync(2000)
    expect(sentNames()).toEqual([['Route planner v2'], ['Route planner v2']])
    expect(useSession.getState().error).toBeNull()
    expect(useSession.getState().pendingSave).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('does not resend a row the database refused (access rules), puts it back and says so', async () => {
    upsert.mockResolvedValue({ error: { message: 'new row violates row-level security policy', code: '42501' } })
    const before = useStore.getState().projects.find((p) => p.id === 'p1')!.name
    rename('Not mine')
    await vi.advanceTimersByTimeAsync(400)
    expect(useSession.getState().error).toMatch(/only the app's owner or an admin can change this/)
    expect(useStore.getState().projects.find((p) => p.id === 'p1')!.name).toBe(before)
    expect(useSession.getState().pendingSave).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('clears the waiting indicator after a clean save even if another message replaced the error', async () => {
    upsert.mockResolvedValueOnce(fail).mockResolvedValue(ok)
    rename('Later')
    await vi.advanceTimersByTimeAsync(400)
    expect(useSession.getState().pendingSave).toBe(true)
    useSession.setState({ error: 'Something else went wrong' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(useSession.getState()).toMatchObject({ pendingSave: false, error: 'Something else went wrong' })
  })

  it('re-sends a failed delete', async () => {
    del.mockResolvedValueOnce(fail).mockResolvedValue(ok)
    useStore.setState((s) => ({ projects: s.projects.filter((p) => p.id !== 'p2') }))
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(2000)
    expect(del.mock.calls).toEqual([['id', ['p2']], ['id', ['p2']]])
    expect(useSession.getState().error).toBeNull()
  })

  it('sends the latest version when the record changed while the save was failing', async () => {
    upsert.mockResolvedValueOnce(fail).mockResolvedValue(ok)
    rename('First')
    await vi.advanceTimersByTimeAsync(400)
    rename('Second')
    await vi.advanceTimersByTimeAsync(400)
    expect(sentNames()).toEqual([['First'], ['Second']])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('backs off 2s, 5s, 15s, then resets after a clean save', async () => {
    upsert.mockResolvedValueOnce(fail).mockResolvedValueOnce(fail).mockResolvedValueOnce(ok).mockResolvedValueOnce(fail).mockResolvedValue(ok)
    rename('A')
    await vi.advanceTimersByTimeAsync(400) // fails: retry in 2s
    await vi.advanceTimersByTimeAsync(1999)
    expect(upsert).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1) // fails again: retry in 5s
    expect(upsert).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4999)
    expect(upsert).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1) // lands
    expect(upsert).toHaveBeenCalledTimes(3)

    rename('B')
    await vi.advanceTimersByTimeAsync(400) // fails: back to a 2s wait, not 15s
    await vi.advanceTimersByTimeAsync(2000)
    expect(upsert).toHaveBeenCalledTimes(5)
  })

  it('retries at once when the browser comes back online, and stops after sign-out', async () => {
    upsert.mockResolvedValueOnce(fail).mockResolvedValueOnce(fail).mockResolvedValue(ok)
    rename('Offline edit')
    await vi.advanceTimersByTimeAsync(400)
    win.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(upsert).toHaveBeenCalledTimes(2)

    stopSync()
    win.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(upsert).toHaveBeenCalledTimes(2)
  })
})

describe('cloud sync takes the stored copy of a saved project', () => {
  const card = (what: string) => ({ what, who: 'drivers', stage: 'live', status: 'ok', updatedAt: '2026-10-06T10:00:00Z', source: 'ai', checkedAt: null })
  const p1 = { id: 'p1', name: 'Route planner', appCard: card('Old card') }
  const p2 = { id: 'p2', name: 'Fuel log', appCard: null }
  const row = (id: string, data: Record<string, unknown>) => ({ id, workspace_id: 'workspace-1', data })
  const stored = (data: Record<string, unknown>) => ({ error: null, data: [row('p1', data)] })
  let upsert: Mock<(rows: unknown) => Promise<unknown>>
  let select: Mock<(columns: string) => void>

  beforeEach(() => {
    vi.useFakeTimers()
    from.mockReset()
    upsert = vi.fn()
    select = vi.fn()
    from.mockImplementation(() => ({
      upsert: (rows: unknown) => ({ select: (columns: string) => { select(columns); return upsert(rows) }, then: (resolve: never, reject: never) => upsert(rows).then(resolve, reject) }),
      delete: () => ({ in: vi.fn() }),
    }))
    channel.mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })
    vi.stubGlobal('window', new EventTarget())
    useSession.setState({ error: null, pendingSave: false })
    useStore.setState({ projects: [p1, p2] as never, members: [], activity: [] })
    startSync('workspace-1')
  })
  afterEach(() => {
    stopSync()
    vi.useRealTimers()
  })

  const rename = (name: string) => useStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === 'p1' ? { ...p, name } : p)) }))
  const local = (id = 'p1') => useStore.getState().projects.find((p) => p.id === id) as unknown as typeof p1

  it('asks for the stored rows back, for projects only', async () => {
    upsert.mockResolvedValue({ error: null, data: [] })
    rename('Route planner v2')
    useStore.setState({ activity: [{ id: 'a1', kind: 'note' }] as never })
    await vi.advanceTimersByTimeAsync(400)
    expect(select.mock.calls).toEqual([['id, workspace_id, data, updated_at']])
    expect(upsert).toHaveBeenCalledTimes(2) // projects, then activity (which is not asked to return anything)
  })

  it('shows what the server kept (a newer appCard from Claude) and does not send it back', async () => {
    const newer = card('Claude wrote this while you were saving')
    upsert.mockResolvedValue(stored({ appCard: newer, name: 'Route planner v2' }))
    rename('Route planner v2')
    await vi.advanceTimersByTimeAsync(400)
    expect(local()).toEqual({ id: 'p1', name: 'Route planner v2', appCard: newer })
    expect(local('p2')).toEqual(p2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(upsert).toHaveBeenCalledTimes(1) // the stored copy was not queued as a new edit
  })

  it('leaves the store alone when the stored row is the same, whatever order its keys come in', async () => {
    upsert.mockResolvedValue(stored({ appCard: { source: 'ai', what: 'Old card', who: 'drivers', stage: 'live', status: 'ok', checkedAt: null, updatedAt: '2026-10-06T10:00:00Z' }, name: 'Route planner v2' }))
    rename('Route planner v2')
    const before = useStore.getState().projects
    await vi.advanceTimersByTimeAsync(400)
    expect(useStore.getState().projects).toBe(before)
  })

  it('does not overwrite a project edited again while it was saving', async () => {
    let finish!: (result: unknown) => void
    upsert.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValue({ error: null, data: [] })
    rename('First')
    await vi.advanceTimersByTimeAsync(400) // the save of "First" is in flight
    rename('Second')
    finish(stored({ appCard: card('Claude wrote this'), name: 'First' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(local().name).toBe('Second')
    expect(local().appCard).toEqual(p1.appCard)

    await vi.advanceTimersByTimeAsync(400) // "Second" goes out next and is not overwritten either
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(local().name).toBe('Second')
  })

  it('takes nothing from a failed save, and a retry still sends the local edit', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'Failed to fetch' }, data: [row('p1', { name: 'Elsewhere' })] }).mockResolvedValue({ error: null })
    rename('Mine')
    await vi.advanceTimersByTimeAsync(400)
    expect(local().name).toBe('Mine')
    await vi.advanceTimersByTimeAsync(2000)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(local().name).toBe('Mine')
  })
})

describe('cloud sync saves each project against the server copy it was made from', () => {
  const T0 = '2026-10-06T10:00:00.100000+00:00'
  const T1 = '2026-10-06T10:00:05.000000+00:00'
  const T2 = '2026-10-06T10:00:09.123456+00:00'
  const T3 = '2026-10-06T10:00:09.123457+00:00' // the same millisecond as T2
  const T4 = '2026-10-06T10:00:30.000000+00:00'
  const card = (what: string) => ({ what, who: 'drivers', stage: 'live', status: 'ok', updatedAt: '2026-10-06T10:00:00Z', source: 'ai', checkedAt: null })
  const p1 = { id: 'p1', name: 'Route planner', appCard: null }
  const p2 = { id: 'p2', name: 'Fuel log', appCard: null }
  const row = (id: string, data: Record<string, unknown>, updated_at: string | null = null) => ({ id, workspace_id: 'workspace-1', data, updated_at })
  let upsert: Mock<(rows: unknown) => Promise<unknown>>
  let columns: string[]
  let realtimeHandlers: Record<string, (payload: unknown) => void>
  /** A realtime row for a project, as the server sends it. */
  const realtime = (data: Record<string, unknown>, updated_at: string, id = 'p1') => realtimeHandlers.projects({ eventType: 'UPDATE', new: row(id, data, updated_at) })
  const local = (id = 'p1') => useStore.getState().projects.find((p) => p.id === id) as unknown as typeof p1 & Record<string, unknown>
  const rename = (name: string) => useStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === 'p1' ? { ...p, name } : p)) }))
  /** The `_base` of every project document sent so far, in order. */
  const bases = () => upsert.mock.calls.flatMap(([rows]) => (rows as { id: string; data: Record<string, unknown> }[]).filter((r) => 'name' in r.data).map((r) => [r.id, r.data._base]))
  const sent = (call: number) => (upsert.mock.calls[call][0] as { id: string; data: Record<string, unknown> }[])

  beforeEach(() => {
    vi.useFakeTimers()
    from.mockReset()
    upsert = vi.fn().mockResolvedValue({ error: null, data: [] })
    columns = []
    realtimeHandlers = {}
    from.mockImplementation(() => ({
      upsert: (rows: unknown) => ({ select: (cols: string) => { columns.push(cols); return upsert(rows) }, then: (resolve: never, reject: never) => upsert(rows).then(resolve, reject) }),
      delete: () => ({ in: vi.fn().mockResolvedValue({ error: null }) }),
    }))
    const chan = { on: vi.fn((_type: string, filter: { table: string }, callback: (payload: unknown) => void) => { realtimeHandlers[filter.table] = callback; return chan }), subscribe: vi.fn() }
    channel.mockReset().mockReturnValue(chan)
    vi.stubGlobal('window', new EventTarget())
    useSession.setState({ error: null, pendingSave: false })
    useStore.setState({ projects: [p1, p2] as never, members: [], activity: [] })
  })
  afterEach(() => {
    stopSync()
    vi.useRealTimers()
  })

  describe('which revision goes out', () => {
    it('sends the revision each project was loaded at, as the server wrote it, and none for a project the server never sent', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      rename('Route planner v2')
      useStore.setState((s) => ({ projects: [...s.projects, { id: 'p3', name: 'New app', appCard: null } as never] }))
      await vi.advanceTimersByTimeAsync(400)
      expect(sent(0).map((r) => [r.id, r.data._base])).toEqual([['p1', T0], ['p3', null]])
      expect(sent(0)[0].data).toEqual({ name: 'Route planner v2', appCard: null, _base: T0 })
    })

    it('sends null for a project whose revision it does not know', async () => {
      startSync('workspace-1')
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', null]])
    })

    it('puts the revision on projects only, not on activity', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      useStore.setState({ activity: [{ id: 'a1', kind: 'note' }] as never })
      await vi.advanceTimersByTimeAsync(400)
      expect(sent(0)).toEqual([{ id: 'a1', workspace_id: 'workspace-1', data: { kind: 'note' } }])
    })

    it('asks for updated_at back with the stored project', async () => {
      startSync('workspace-1')
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      expect(columns).toEqual(['id, workspace_id, data, updated_at'])
    })

    it('moves to the revision of the latest realtime row', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      realtime({ name: 'Route planner', appCard: card('Claude wrote this') }, T1)
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T1]])
    })

    it('moves to the revision of the row a save returns', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      upsert.mockResolvedValue({ error: null, data: [row('p1', { name: 'Route planner v2', appCard: null }, T1)] })
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      rename('Route planner v3')
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T0], ['p1', T1]])
    })

    it('moves to the revision of a returned row that differs from what was sent, as it takes that copy', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      upsert.mockResolvedValue({ error: null, data: [row('p1', { name: 'Route planner v2', appCard: card('Claude, meanwhile') }, T1)] })
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      expect(local().appCard).toEqual(card('Claude, meanwhile'))
      rename('Route planner v3')
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T0], ['p1', T1]])
    })

    it('keeps the revision a failed save was sent with, and sends it again on the retry', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      upsert.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } }).mockResolvedValue({ error: null, data: [] })
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      await vi.advanceTimersByTimeAsync(2000)
      expect(bases()).toEqual([['p1', T0], ['p1', T0]])
    })

    it('forgets the revision of a project that was deleted', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      useStore.setState((s) => ({ projects: s.projects.filter((p) => p.id !== 'p1') }))
      await vi.advanceTimersByTimeAsync(400)
      useStore.setState((s) => ({ projects: [...s.projects, p1 as never] }))
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', null]])
    })

    it('forgets the revision of a project another person deleted', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      realtimeHandlers.projects({ eventType: 'DELETE', old: { id: 'p1' } })
      expect(useStore.getState().projects.map((p) => p.id)).toEqual(['p2'])
      useStore.setState((s) => ({ projects: [...s.projects, { ...p1, name: 'Again' } as never] }))
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', null]])
    })
  })

  describe('the revision stays out of the store', () => {
    it('strips _base from a row the server sends in realtime', () => {
      startSync('workspace-1')
      realtime({ name: 'From the server', appCard: null, _base: T0 }, T1)
      expect(local()).toEqual({ id: 'p1', name: 'From the server', appCard: null })
    })

    it('strips _base and updated_at from what a save returns', async () => {
      startSync('workspace-1')
      upsert.mockResolvedValue({ error: null, data: [row('p1', { name: 'Elsewhere', appCard: null, _base: T0 }, T1)] })
      rename('Route planner v2')
      await vi.advanceTimersByTimeAsync(400)
      expect(local()).toEqual({ id: 'p1', name: 'Elsewhere', appCard: null })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(upsert).toHaveBeenCalledTimes(1) // taking the stored copy is not a new edit
    })

    it('does not put it on the projects in the store when it loads a workspace', async () => {
      const workspace = { id: 'workspace-1', name: 'Halden Freight', kind: 'org' as const, github_org: null }
      const member = { id: 'member-1', workspace_id: workspace.id, user_id: 'user-1', name: 'Sam', email: null, avatar_url: null, github_login: null, role: 'owner' as const, active: true, leaving_on: null }
      const loadColumns: string[] = []
      from.mockImplementation((table: string) => ({
        select: (cols: string) => {
          if (table === 'members' && cols.startsWith('workspace_id')) return { eq: () => ({ eq: () => Promise.resolve({ data: [{ workspace_id: workspace.id, workspaces: workspace }], error: null }) }) }
          if (table === 'activity') return { eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }
          if (table === 'projects') {
            loadColumns.push(cols)
            return { eq: () => Promise.resolve({ data: [row('p1', { name: 'Route planner', appCard: null, _base: 'old' }, T0), row('p2', { name: 'Fuel log', appCard: null }, T1)], error: null }) }
          }
          return { eq: () => Promise.resolve({ data: [member], error: null }) }
        },
        upsert: (rows: unknown) => ({ select: () => upsert(rows) }),
      }))
      rpc.mockReset()
      auth.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
      useStore.getState().resetAll()

      await setupWorkspaceCloud('org', 'Halden Freight')

      expect(loadColumns).toEqual(['id, workspace_id, data, updated_at'])
      expect(useStore.getState().projects).toEqual([{ id: 'p1', name: 'Route planner', appCard: null }, { id: 'p2', name: 'Fuel log', appCard: null }])
      rename('Route planner v2')
      useStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === 'p2' ? { ...p, name: 'Fuel log v2' } : p)) }))
      await vi.advanceTimersByTimeAsync(400)
      expect(sent(0).map((r) => [r.id, r.data._base])).toEqual([['p1', T0], ['p2', T1]])
    })
  })

  describe('a realtime row that arrived while its project was being saved', () => {
    let finish!: (result: unknown) => void
    /** The save of "First" is in flight, and `finish(result)` is the server's answer. */
    const saving = async () => {
      upsert.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValue({ error: null, data: [] })
      rename('First')
      await vi.advanceTimersByTimeAsync(400)
    }
    const returned = (updated_at: string, data: Record<string, unknown> = { name: 'First', appCard: null }) => ({ error: null, data: [row('p1', data, updated_at)] })

    it('is applied after the save is acknowledged when it is newer than the row the save returned, even by a microsecond', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'First', appCard: card('Claude wrote this after the save') }, T3) // beats the response to the save
      expect(local().appCard).toBeNull() // dropped for now: the project is being saved
      finish(returned(T2))
      await vi.advanceTimersByTimeAsync(0)
      expect(local()).toEqual({ id: 'p1', name: 'First', appCard: card('Claude wrote this after the save') })
      rename('Second')
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T0], ['p1', T3]])
      expect(upsert).toHaveBeenCalledTimes(2) // applying it was not a new edit
    })

    it('is not applied when it is older than the row the save returned', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'Older', appCard: card('Written before the save') }, T1)
      finish(returned(T2))
      await vi.advanceTimersByTimeAsync(0)
      expect(local()).toEqual({ id: 'p1', name: 'First', appCard: null })
      rename('Second')
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T0], ['p1', T2]])
    })

    it('is not applied when it is the same row the save returned', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'First', appCard: null }, T2) // the echo of the save itself
      const before = useStore.getState().projects
      finish(returned(T2))
      await vi.advanceTimersByTimeAsync(0)
      expect(useStore.getState().projects).toBe(before)
    })

    it('is not applied while the project is dirty again; the save that goes out next settles it', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'First', appCard: card('Claude wrote this after the save') }, T3)
      rename('Second')
      finish(returned(T2))
      await vi.advanceTimersByTimeAsync(0)
      expect(local()).toEqual({ id: 'p1', name: 'Second', appCard: null })

      // "Second" goes out on the copy the first save stored (T2), and the database, which has Claude's newer write, keeps it.
      upsert.mockResolvedValueOnce(returned(T4, { name: 'Second', appCard: card('Claude wrote this after the save') }))
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T0], ['p1', T2]])
      expect(local()).toEqual({ id: 'p1', name: 'Second', appCard: card('Claude wrote this after the save') })
    })

    it('does not move the base of the next save to a returned row it did not take, when the database kept something of Claude\'s', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      rename('Second')
      finish(returned(T2, { name: 'First', appCard: card('Kept by the database') })) // not what was sent, and not taken: "Second" is pending
      await vi.advanceTimersByTimeAsync(0)
      expect(local()).toEqual({ id: 'p1', name: 'Second', appCard: null })
      await vi.advanceTimersByTimeAsync(400)
      expect(bases()).toEqual([['p1', T0], ['p1', T0]])
    })

    it('keeps the newest of several, whatever order they came in', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'First', appCard: card('Newest') }, T3)
      realtime({ name: 'First', appCard: card('Older') }, T1)
      finish(returned(T2))
      await vi.advanceTimersByTimeAsync(0)
      expect(local().appCard).toEqual(card('Newest'))
    })

    it('does not let a row for another project take its place', async () => {
      startSync('workspace-1', new Map([['p1', T0], ['p2', T0]]))
      await saving()
      realtime({ name: 'Fuel log', appCard: card('Other app') }, T3, 'p2') // p2 isn't being saved: applied at once
      expect(local('p2').appCard).toEqual(card('Other app'))
      finish(returned(T2))
      await vi.advanceTimersByTimeAsync(0)
      expect(local()).toEqual({ id: 'p1', name: 'First', appCard: null })
    })

    it('stays held when the save fails, and the answer to the retry settles it', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'First', appCard: card('Claude wrote this') }, T2)
      finish({ error: { message: 'Failed to fetch' } })
      await vi.advanceTimersByTimeAsync(0)
      expect(local().appCard).toBeNull() // still waiting for a save to be acknowledged
      upsert.mockResolvedValueOnce(returned(T4, { name: 'First', appCard: card('Claude wrote this, and then some') }))
      await vi.advanceTimersByTimeAsync(2000)
      expect(local().appCard).toEqual(card('Claude wrote this, and then some'))
    })

    it('is applied after a refusal puts the server copy back', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'Route planner', appCard: card('Claude wrote this') }, T2)
      finish({ error: { message: 'new row violates row-level security policy', code: '42501' } })
      await vi.advanceTimersByTimeAsync(0)
      expect(local()).toEqual({ id: 'p1', name: 'Route planner', appCard: card('Claude wrote this') })
    })

    it('is thrown away by stopSync, and a late answer to the save changes nothing', async () => {
      startSync('workspace-1', new Map([['p1', T0]]))
      await saving()
      realtime({ name: 'First', appCard: card('Claude wrote this') }, T3)
      stopSync()
      const before = useStore.getState().projects
      finish(returned(T2, { name: 'First', appCard: card('Not this either') }))
      await vi.advanceTimersByTimeAsync(0)
      expect(useStore.getState().projects).toBe(before)
    })
  })
})

describe('requeue', () => {
  it('restores what the server last had for failed ids and drops the ones it never had', () => {
    const a0 = { id: 'a' }, a1 = { id: 'a' }, b1 = { id: 'b' }, c0 = { id: 'c' }
    expect(requeue([a1, b1], [a0, c0], ['a', 'b', 'c'])).toEqual([a0, c0])
    expect(requeue([a1, b1], [a0, c0], ['a'])[1]).toBe(a0)
  })
})

describe('restoreRows', () => {
  it('puts refused rows back to the server copy in place, drops new ones and brings back refused deletes', () => {
    const a0 = { id: 'a', v: 0 }, a1 = { id: 'a', v: 1 }, b1 = { id: 'b', v: 1 }, c0 = { id: 'c', v: 0 }, d1 = { id: 'd', v: 1 }
    expect(restoreRows([a1, b1, d1], [a0, c0], ['a', 'b', 'c'])).toEqual([a0, d1, c0])
  })
})
