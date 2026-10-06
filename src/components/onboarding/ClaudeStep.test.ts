import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brandClients, type ConnectedClient } from '../../lib/mcpSetup'
import { guideScope, useGuideState } from '../guide/guideState'
import { useUI } from '../uiState'
import { draftPrompt } from '../../lib/claudeWork'
import { AskClaude } from './ClaudeStep'

// The guide state persists to localStorage, which it looks up when the module loads.
vi.hoisted(() => {
  const items = new Map<string, string>()
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) } })
})

const client = (clientId: string, name: string): ConnectedClient => ({ clientId, name, grantedOn: '5 Oct 2026' })

describe('Let Claude write your cards', () => {
  it('counts only Claude apps as Claude', () => {
    const list = [client('a', 'Claude'), client('b', 'Claude Code (tempo)'), client('c', 'Cursor'), client('d', 'Claude helper')]
    expect(brandClients('claude', list).map((item) => item.clientId)).toEqual(['a', 'b'])
  })

  it('once connected, gives the one message to paste and opens Claude on the web', () => {
    const prompt = draftPrompt('Acme', ['Billing'])
    const html = renderToStaticMarkup(createElement(AskClaude, { clients: [client('a', 'Claude')], prompt }))
    expect(html).toContain('Claude app</span> is connected to Tempo.')
    expect(html).toContain('Use Tempo to draft the app cards for &quot;Billing&quot; in my &quot;Acme&quot; workspace.')
    expect(html).toContain('aria-label="Copy message"')
    // Step by step: Claude works in its own app; the button copies the message and opens a new chat to paste it into.
    expect(html).toContain('Claude works in its own app, not inside Tempo.')
    expect(html).toContain('Open Claude. Tempo copies the message for you.')
    expect(html).toContain('Copy message and open Claude')
    // "Always allow", or Claude asks again for every app it writes.
    expect(html).toContain('Paste it into the new chat and press Send. When Claude asks to use Tempo, choose Always allow, so it doesn&#x27;t ask again for every app.')
    // Never prefilled through the link: claude.ai shows a red caution banner over any message that arrives that way.
    expect(html).toContain('href="https://claude.ai/new"')
    expect(html).not.toContain('?q=')
    expect(html).toContain('Nothing counts until you check it.')
  })

  it('offers Connect it again only when given a way to, for a Claude that lost Tempo without Tempo knowing', () => {
    const prompt = draftPrompt('Acme', ['Billing'])
    const plain = renderToStaticMarkup(createElement(AskClaude, { clients: [client('a', 'Claude')], prompt }))
    expect(plain).not.toContain('Connect it again')
    const offered = renderToStaticMarkup(createElement(AskClaude, { clients: [client('a', 'Claude')], prompt, onConnectAgain: () => {} }))
    expect(offered).toContain('Claude says it can&#x27;t find Tempo?')
    expect(offered).toContain('>Connect it again</button>')
  })

  it('has no web link for Claude Code alone, and names both when both are connected', () => {
    const prompt = draftPrompt(null, [])
    const code = renderToStaticMarkup(createElement(AskClaude, { clients: [client('b', 'Claude Code (tempo)')], prompt }))
    expect(code).toContain('Claude Code</span> is connected')
    expect(code).toContain('Paste it into Claude Code and press Enter.')
    expect(code).not.toContain('claude.ai/new')
    const both = renderToStaticMarkup(createElement(AskClaude, { clients: [client('a', 'Claude'), client('b', 'Claude Code (tempo)')], prompt }))
    expect(both).toContain('Claude app and Claude Code</span> are connected')
  })
})

describe('first visit only', () => {
  beforeEach(() => {
    useGuideState.setState({ workspaces: {} })
    useUI.getState().closeAll()
  })

  it('remembers the step per workspace and person', () => {
    const scope = guideScope('w1', 'u1')
    useGuideState.getState().setClaudeStepShown(scope)
    expect(useGuideState.getState().workspaces[scope]?.claudeStepShown).toBe(true)
    expect(useGuideState.getState().workspaces[guideScope('w2', 'u1')]?.claudeStepShown).toBeUndefined()
  })

  it('opens as the only overlay, and Escape closes it', () => {
    useUI.getState().setRepoPickerOpen(true)
    useUI.getState().setClaudeWindow('first')
    expect(useUI.getState()).toMatchObject({ claudeWindow: 'first', repoPickerOpen: false })
    expect(useUI.getState().anyModalOpen()).toBe(true)
    useUI.getState().closeAll()
    expect(useUI.getState().claudeWindow).toBeNull()
  })
})
