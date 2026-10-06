import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { describeRedirect } from '../lib/oauthConsent'
import { ConsentBody, messageToCopy, type ConsentBodyProps } from './OAuthConsentView'

const noop = () => {}
const body = (patch: Partial<ConsentBodyProps> = {}) => renderToStaticMarkup(createElement(ConsentBody, {
  details: { client: { id: 'c1', name: 'Claude Code', uri: 'https://claude.ai', logo_uri: '' } },
  redirect: describeRedirect('http://localhost:54321/callback'),
  account: 'dana@example.com',
  busy: null,
  error: null,
  onAllow: noop,
  onDeny: noop,
  onSignOut: noop,
  ...patch,
}))

describe('Allow copies the message for Claude', () => {
  const pending = { prompt: 'Use Tempo to draft…', workspaceId: 'ws1', projectIds: ['p1'], savedAt: 1 }

  it('only for a Claude app, and only when the Claude window is holding a message', () => {
    for (const name of ['Claude', 'Claude Code (tempo-staging)', 'claude.ai']) expect(messageToCopy(name, pending), name).toBe(pending)
    for (const name of ['Cursor', 'ChatGPT', 'Claude helper', 'My Claude tool', null]) expect(messageToCopy(name, pending), String(name)).toBeNull()
    expect(messageToCopy('Claude', null)).toBeNull()
  })

  it('says so under the buttons', () => {
    expect(body({ copiesMessage: true })).toContain('Allow also copies your message for Claude. Back in Claude, start a new chat and paste it.')
    expect(body()).not.toContain('copies your message')
  })
})

describe('ConsentBody', () => {
  it('names the client, where it returns to and the signed-in account', () => {
    const html = body()
    expect(html).toContain('Claude Code wants to connect')
    expect(html).toContain('localhost:54321')
    expect(html).toContain('This computer')
    expect(html).toContain('dana@example.com')
  })

  it('says what allowing means in plain words', () => {
    const html = body()
    expect(html).toContain('Read your apps, their health, owners and recent activity')
    expect(html).toContain('Write draft app cards and handover packs that a person checks before they count')
    expect(html).toContain('It can&#x27;t change owners, members, invites, keys or settings')
  })

  it('has Allow and Deny, and Allow is on', () => {
    const html = body()
    expect(html).toContain('Allow access')
    expect(html).toContain('Deny')
    expect(html).not.toMatch(/disabled=""[^>]*>(<[^>]+>)*Allow access/)
  })

  it('turns Allow off while a decision is in flight', () => {
    const html = body({ busy: 'deny' })
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('will not offer Allow when the return address cannot be read', () => {
    const html = body({ redirect: null })
    expect(html).toContain('can&#x27;t tell where this app sends you back')
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('warns about plain http to another host', () => {
    expect(body({ redirect: describeRedirect('http://example.com/cb') })).toContain('not secure')
  })

  it('shows a failed answer as an alert', () => {
    const html = body({ error: { text: "Couldn't allow it. Nothing was shared. Try again.", detail: 'expired' } })
    expect(html).toContain('role="alert"')
    expect(html).toContain('expired')
  })

  it('shows a hostile client name as text, not markup', () => {
    const html = body({ details: { client: { id: 'x', name: '<img src=x onerror=alert(1)>', uri: '', logo_uri: '' } } })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
