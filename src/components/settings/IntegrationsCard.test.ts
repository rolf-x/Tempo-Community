import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkEntry } from '../../data/githubLink'
import { GitHubConnectionRow, githubDisconnectToast, PushUpdatesRow, pushUpdatesState } from './IntegrationsCard'

const row = (connected: boolean, confirmDisconnect = false) => renderToStaticMarkup(createElement(GitHubConnectionRow, {
  connected,
  appMode: true,
  repoCount: connected ? 3 : null,
  statusOff: false,
  confirmDisconnect,
  disconnecting: false,
  onConnect: vi.fn(),
  onRequestDisconnect: vi.fn(),
  onCancel: vi.fn(),
  onDisconnect: vi.fn(),
}))

describe('GitHub integration settings', () => {
  it('shows an inline disconnect confirmation and GitHub installation link', () => {
    const html = row(true, true)

    expect(html).toContain('Disconnect GitHub? Your apps stay in Tempo, but syncing stops until you connect again.')
    expect(html).toContain('data-variant="danger"')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('href="https://github.com/settings/installations"')
    expect(html).toContain('Manage where Tempo is installed on GitHub')
  })

  it('returns to the connect state after disconnecting', () => {
    const html = row(false)

    expect(html).toContain('>Connect GitHub</button>')
    expect(html).not.toContain('Disconnect GitHub?')
  })

  it('uses the revoke result in the disconnect toast', () => {
    expect(githubDisconnectToast(true)).toBe("GitHub disconnected. Tempo's access was revoked.")
    expect(githubDisconnectToast(false)).toBe('GitHub disconnected in this browser.')
  })
})

describe('Updates on every push', () => {
  afterEach(() => vi.unstubAllEnvs())
  const links = [
    { installationId: 11, login: 'acme', linkedAt: '2026-10-06T08:00:00Z' },
    { installationId: 12, login: 'octo-labs', linkedAt: '2026-10-06T08:00:01Z' },
  ]
  const entry = (change: Partial<LinkEntry> = {}): LinkEntry => ({ links: [], status: 'ready', error: null, noInstall: false, recheck: false, ...change })
  const html = (e: LinkEntry, props: { canManage?: boolean; githubConnected?: boolean; turningOn?: boolean } = {}) => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme')
    return renderToStaticMarkup(createElement(PushUpdatesRow, { entry: e, canManage: true, githubConnected: true, turningOn: false, onTurnOn: vi.fn(), ...props })).replace(/&#x27;/g, "'")
  }

  it('says which accounts it is on for', () => {
    const out = html(entry({ links }), { canManage: false })

    expect(out).toContain('Updates on every push')
    expect(out).toContain('On for acme, octo-labs. Tempo re-checks an app as soon as someone pushes to it.')
    expect(out).not.toContain('Turn on')
    expect(out).not.toContain('Ask an owner or admin')
  })

  it('offers a manager a Turn on button when it is off', () => {
    const out = html(entry())

    expect(out).toContain('Off. Tempo only re-checks an app when someone presses Sync.')
    expect(out).toContain('>Turn on</button>')
    expect(out).not.toContain('Install it on GitHub')
  })

  it('shows a spinner on the button while it turns on', () => {
    const out = html(entry({ status: 'loading' }), { turningOn: true })

    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>[\s\S]*animate-spin[\s\S]*Turn on<\/button>/)
  })

  it('tells a member to ask an owner or admin', () => {
    const out = html(entry(), { canManage: false })

    expect(out).toContain('Ask an owner or admin to turn this on.')
    expect(out).not.toContain('Turn on')
  })

  it('says when Tempo\'s GitHub App is not installed, with a link to install it', () => {
    const out = html(entry({ noInstall: true }))

    expect(out).toContain("Tempo's GitHub App isn't installed on the account that owns your repos.")
    expect(out).toContain('href="https://github.com/apps/tempo-acme/installations/new"')
    expect(out).toContain('Install it on GitHub')
    expect(out).toContain('>Try again</button>')
  })

  it('says it is not available on a server that is not set up, with no button', () => {
    for (const canManage of [true, false]) {
      const out = html(entry({ status: 'error', error: 'not_configured' }), { canManage })
      expect(out).toContain('Not available on this server yet.')
      expect(out).not.toContain('Turn on')
      expect(out).not.toContain('Ask an owner or admin')
    }
  })

  it('asks for GitHub first, and shows what went wrong after a failed try', () => {
    const notConnected = html(entry(), { githubConnected: false })
    expect(notConnected).toContain('Connect GitHub first, then turn this on.')
    expect(notConnected).toMatch(/<button[^>]*disabled=""[^>]*>Turn on<\/button>/)

    const failed = html(entry({ status: 'error', error: 'token_expired' }))
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('GitHub access expired. Reconnect GitHub.')
    expect(failed).toContain('>Turn on</button>')
  })

  it('names the state from the links, the role and the last answer', () => {
    expect(pushUpdatesState(entry({ links }), false)).toBe('on')
    expect(pushUpdatesState(entry({ status: 'idle' }), true)).toBe('checking')
    expect(pushUpdatesState(entry({ status: 'loading' }), true)).toBe('checking') // the quiet attempt is running
    expect(pushUpdatesState(entry({ status: 'loading' }), true, true)).toBe('off') // after Turn on: the button stays
    expect(pushUpdatesState(entry({ status: 'loading' }), false, true)).toBe('checking')
    expect(pushUpdatesState(entry(), true)).toBe('off')
    expect(pushUpdatesState(entry(), false)).toBe('member')
    expect(pushUpdatesState(entry({ noInstall: true }), true)).toBe('no-install')
    expect(pushUpdatesState(entry({ status: 'error', error: 'not_configured' }), true)).toBe('not-configured')
  })
})
