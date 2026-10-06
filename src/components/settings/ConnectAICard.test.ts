import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiBrands, type AiBrandId } from '../../lib/mcpSetup'
import { defaultSettings } from '../../store/useStore'
import type { Settings } from '../../types'
import { AIChoices, AiBrandDetail, AiBrandGrid, ApiKeyChoice, ClientsList, ConnectAICard, ConnectedNotice, ConnectedWay, SignInFirst, type ClientsListProps, type Watch } from './ConnectAICard'

// A server render reads a zustand store's initial state, so the card's session and settings are faked here.
const fake = vi.hoisted(() => ({ session: {} as Record<string, unknown>, settings: null as unknown }))
vi.mock('../../data/session', async (original) => {
  const actual = await original<typeof import('../../data/session')>()
  return { ...actual, useSession: Object.assign((selector: (state: never) => unknown) => selector(fake.session as never), actual.useSession) }
})
vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  const useStore = Object.assign((selector: (state: never) => unknown) => selector({ ...actual.useStore.getState(), settings: fake.settings } as never), actual.useStore)
  return { ...actual, useStore }
})

vi.mock('../ui/Modal', () => ({ Modal: () => null })) // the picker's dialog portals into document.body

const URL = 'https://tempo.example/api/mcp'
const noop = () => {}
const list = (patch: Partial<ClientsListProps> = {}) => renderToStaticMarkup(createElement(ClientsList, {
  state: { status: 'ready', clients: [] }, confirmId: null, revoking: null, error: null,
  onRetry: noop, onAskRevoke: noop, onCancel: noop, onRevoke: noop, ...patch,
}))

describe('AiBrandGrid', () => {
  const html = renderToStaticMarkup(createElement(AiBrandGrid, { brands: aiBrands(URL), onPick: noop, onApiKey: noop }))

  it('shows every brand by name with its logo, then the universal way and the API key', () => {
    for (const name of ['Claude', 'ChatGPT', 'Gemini', 'GitHub Copilot', 'Cursor', 'Perplexity', 'Le Chat', 'Grok', 'Any AI app', 'API key']) expect(html).toContain(`>${name}<`)
    expect(html.match(/<svg/g)?.length).toBe(10)
    expect(html).not.toContain('>VS Code<')
  })

  it("draws the logos in their brands' colours; black-and-white marks follow the theme", () => {
    expect(html).toContain('fill="#D97757"') // Claude
    expect(html).toContain('fill="#1FB8CD"') // Perplexity
    expect(html.match(/<linearGradient/g)).toHaveLength(2) // Gemini, Mistral
    expect(html).toContain('fill="currentColor"') // Copilot, Cursor
  })

  it("makes a brand with a single one-click way the link itself; the rest open the brand's ways", () => {
    expect(html).toContain('href="cursor://anysphere.cursor-deeplink/mcp/install?name=tempo')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html.match(/<button /g)).toHaveLength(9)
  })

  it('offers the API key only where this build keeps it', () => {
    const noKey = renderToStaticMarkup(createElement(AiBrandGrid, { brands: aiBrands(URL), onPick: noop }))
    expect(noKey).toContain('>Any AI app<')
    expect(noKey).not.toContain('>API key<')
  })
})

describe('ApiKeyChoice', () => {
  it('says there is no app to connect and leads to the key setup', () => {
    const html = renderToStaticMarkup(createElement(ApiKeyChoice, { onBack: noop, onSetUp: noop }))
    expect(html).toContain('There is no app to connect')
    expect(html).toContain('Full automation.')
    expect(html).toContain('whenever apps sync')
    expect(html).toContain('Set up an API key')
    expect(html).toContain('All apps')
  })
})

describe('AiBrandDetail', () => {
  const brands = aiBrands(URL)
  const detail = (brandId: AiBrandId, wayId?: string, watch: Watch = 'waiting') => {
    const brand = brands.find((item) => item.id === brandId)!
    const way = brand.ways.find((item) => item.id === wayId) ?? brand.ways[0]
    return renderToStaticMarkup(createElement(AiBrandDetail, { brand, way, url: URL, watch, onBack: noop, onChooseWay: noop, onCheckAgain: noop }))
  }

  it('asks where you use a brand with several ways in, and shows the first one', () => {
    const html = detail('claude')
    expect(html).toContain('Where do you use it?')
    expect(html).toContain('>Claude app<')
    expect(html).toContain('>Claude Code<')
    expect(html).toContain('href="https://claude.ai/customize/connectors?modal=add-custom-connector')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).not.toContain('Nothing opened?')
    expect(detail('cursor')).not.toContain('Where do you use it?')
  })

  it("shows a terminal tool's line with a copy button", () => {
    const html = detail('claude', 'claude-code')
    expect(html).toContain(`claude mcp add --transport http tempo ${URL} &amp;&amp; claude mcp login tempo`)
    expect(html).toContain('aria-label="Copy command"')
  })

  it('gives a chat app the address and a copy button', () => {
    const html = detail('chatgpt')
    expect(html).toContain(`>${URL}</code>`)
    expect(html).toContain('aria-label="Copy address"')
    expect(html).toContain('Developer mode')
  })

  it('offers to open an installed app again, with a hint in case nothing opened', () => {
    expect(detail('copilot')).toContain('Open VS Code')
    expect(detail('copilot')).toContain('Nothing opened?')
  })

  it('waits for the Allow click, and says when it stopped checking or missed a check', () => {
    expect(detail('chatgpt', 'codex')).toContain('Waiting for you to click Allow')
    expect(detail('chatgpt', 'codex')).toContain('All apps')
    expect(detail('chatgpt', 'codex', 'missed')).toContain('Trying again')
    const stopped = detail('chatgpt', 'codex', 'stopped')
    expect(stopped).toContain('Stopped checking')
    expect(stopped).toContain('Check again')
    expect(stopped).not.toContain('Waiting for you')
  })

  it('shows only the reason, and no waiting, for a cloud app on a local site', () => {
    const local = aiBrands('http://localhost:5173/api/mcp').find((item) => item.id === 'chatgpt')!
    const html = renderToStaticMarkup(createElement(AiBrandDetail, { brand: local, way: local.ways[0], url: 'http://localhost:5173/api/mcp', watch: 'off', onBack: noop, onChooseWay: noop, onCheckAgain: noop }))
    expect(html).toContain('not on localhost')
    expect(html).not.toContain('Waiting for you')
    expect(html).not.toContain('Copy address')
  })
})

describe('ConnectedNotice', () => {
  const client = (clientId: string, name: string) => ({ clientId, name, grantedOn: '' })
  const notice = (others: ReturnType<typeof client>[], error: { id: string; text: string } | null = null) =>
    renderToStaticMarkup(createElement(ConnectedNotice, { fresh: [client('n', 'Codex')], others, revoking: null, error, onDisconnect: noop }))

  it('says the new app is connected', () => {
    expect(notice([])).toContain('Codex</span> is connected to Tempo.')
    expect(notice([])).not.toContain('Switching?')
  })

  it('offers to disconnect the apps from before, and to keep them', () => {
    const html = notice([client('o', 'Claude Code')])
    expect(html).toContain('Switching?')
    expect(html).toContain('Disconnect Claude Code')
    expect(html).toContain('several apps can be connected at once')
  })

  it('shows a failed disconnect on its own row', () => {
    const html = notice([client('o', 'Claude Code')], { id: 'o', text: "Couldn't revoke access." })
    expect(html).toContain('role="alert"')
    expect(html).toContain("Couldn&#x27;t revoke access.")
  })
})

describe('SignInFirst', () => {
  it('is one line that points signed-out people to sign in', () => {
    const html = renderToStaticMarkup(createElement(SignInFirst, { canSignIn: true }))
    expect(html).toContain('Sign in first to connect an AI app.')
    expect(html).toContain('href="#/login"')
  })

  it('has no link when sign-in is not set up', () => {
    expect(renderToStaticMarkup(createElement(SignInFirst, { canSignIn: false }))).not.toContain('href')
  })
})

describe('ClientsList', () => {
  const clients = [
    { clientId: 'a', name: 'Claude Code', grantedOn: '4 Oct 2026' },
    { clientId: 'b', name: 'Codex', grantedOn: '' },
  ]

  it('has a loading state', () => {
    expect(list({ state: { status: 'loading' } })).toContain('Loading connected AI apps')
  })

  it('has an error state with a retry', () => {
    const html = list({ state: { status: 'error' } })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Try again')
  })

  it('has a designed empty state', () => {
    expect(list()).toContain('No AI app connected')
  })

  it('lists each client with its name, date and a Revoke button', () => {
    const html = list({ state: { status: 'ready', clients } })
    expect(html).toContain('Claude Code')
    expect(html).toContain('Connected 4 Oct 2026')
    expect(html).toContain('Codex')
    expect(html.match(/>Revoke</g)).toHaveLength(2)
  })

  it('asks inline before revoking, without window.confirm', () => {
    const html = list({ state: { status: 'ready', clients }, confirmId: 'a' })
    expect(html).toContain('Revoke access')
    expect(html).toContain('Cancel')
    expect(html).toContain('will be signed out of Tempo')
    expect(html.match(/>Revoke</g)).toHaveLength(1)
  })

  it('shows a failed revoke on its own row', () => {
    const html = list({ state: { status: 'ready', clients }, confirmId: 'a', error: { id: 'a', text: "Couldn't revoke access." } })
    expect(html).toContain("Couldn&#x27;t revoke access.")
  })
})

describe('already connected apps', () => {
  const brands = aiBrands(URL)
  const claude = brands.find((item) => item.id === 'claude')!
  const client = { clientId: 'c1', name: 'Claude', grantedOn: '5 Oct 2026' }

  it('puts a green check on a connected brand, and a connected one-click brand is no longer a link', () => {
    const html = renderToStaticMarkup(createElement(AiBrandGrid, { brands, connectedWays: new Set(['claude-app', 'cursor', 'zed']), onPick: noop }))
    expect(html.match(/ \(connected\)</g)).toHaveLength(3) // Claude, Cursor, Any AI app (Zed)
    expect(html.match(/text-success/g)).toHaveLength(3)
    expect(html).not.toContain('href="cursor://')
  })

  it('shows a connected way as connected, with Revoke, and no way back in', () => {
    const html = renderToStaticMarkup(createElement(AiBrandDetail, {
      brand: claude, way: claude.ways[0], url: URL, watch: 'off', connectedWays: new Set(['claude-app']), connectedHere: [client],
      onRevoke: noop, onBack: noop, onChooseWay: noop, onCheckAgain: noop,
    }))
    expect(html).toContain('is already connected to Tempo.')
    expect(html).toContain('Claude app (connected)')
    expect(html).toContain('aria-label="Revoke Claude"')
    expect(html).toContain('revoke its access first')
    expect(html).not.toContain('Open Claude app')
    expect(html).not.toContain('claude.ai/customize')
    expect(html).not.toContain('Waiting for you')
  })

  it("still offers the brand's other ways while one is connected", () => {
    const html = renderToStaticMarkup(createElement(AiBrandDetail, {
      brand: claude, way: claude.ways[1], url: URL, watch: 'waiting', connectedWays: new Set(['claude-app']), connectedHere: [],
      onBack: noop, onChooseWay: noop, onCheckAgain: noop,
    }))
    expect(html).toContain('claude mcp add')
    expect(html).toContain('Claude app (connected)')
  })

  it('shows a failed revoke on its row', () => {
    const html = renderToStaticMarkup(createElement(ConnectedWay, { way: claude.ways[0], clients: [client], revoking: null, error: { id: 'c1', text: "Couldn't revoke access." }, onRevoke: noop }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('since 5 Oct 2026')
  })
})

describe('AIChoices (Settings, both mode)', () => {
  const choices = (patch: Partial<Parameters<typeof AIChoices>[0]> = {}) => renderToStaticMarkup(createElement(AIChoices, {
    app: 'Claude', logo: 'claude', connected: false, keySaved: false, connectLabel: 'Connect Claude', onConnect: noop, onApiKey: noop, ...patch,
  }))

  it('says what Claude (MCP) is, in plain words', () => {
    const html = choices()
    expect(html).toContain('Claude (MCP)')
    expect(html).toContain('Claude works in its own app. Send it one message and it writes the descriptions and adds tasks.')
    expect(html).toContain('Uses your Claude plan.')
    expect(html).toContain('>Connect Claude<')
  })

  it('says what the API key adds: full automation, no message to send, who pays, and that tasks come from Claude', () => {
    const html = choices()
    expect(html).toContain('>API key<')
    expect(html).toContain('>Full automation<')
    expect(html).toContain('Tempo does it all itself whenever apps sync: it writes the descriptions and adds tasks. No message to send.')
    expect(html).toContain('You pay your AI provider for what it uses.')
    expect(html).toContain('Sync all shows its progress as it goes.')
    expect(html).toContain('Have both? The key does the writing on every sync, and you can still ask Claude about your apps.')
    expect(html).toContain('>Add an API key<')
  })

  it('stacks on a phone and goes side by side from the small breakpoint, with named sections and no jargon words', () => {
    const html = choices()
    expect(html).toContain('grid gap-3 sm:grid-cols-2')
    expect(html.match(/<section aria-labelledby=/g)).toHaveLength(2)
    expect(html).not.toMatch(/OAuth|token|endpoint|JSON/)
  })

  it('uses theme tokens only, so light and dark both follow', () => {
    const html = choices()
    expect(html).not.toMatch(/bg-white|bg-black|text-black|text-white|bg-gray|text-gray/)
    expect(html).toContain('bg-surface')
    expect(html).toContain('text-text-muted')
  })

  it('shows a green check on the choice already in use', () => {
    const none = choices()
    expect(none).not.toContain('is connected.')
    expect(none).not.toContain('A key is saved')
    expect(choices({ connected: true })).toContain('Claude is connected.')
    const keyed = choices({ keySaved: true })
    expect(keyed).toContain('A key is saved. Tempo writes the descriptions and tasks.')
    expect(keyed).toContain('>Add another key<')
  })

  it('keeps the API key choice usable before sign-in, and asks for the sign-in only for Claude', () => {
    const html = choices({ signedIn: false, canSignIn: true })
    expect(html).toContain('Sign in first to connect an AI app.')
    expect(html).not.toContain('>Connect Claude<')
    expect(html).toContain('>Add an API key<')
  })

  it('names a generic AI app when the picker offers several brands', () => {
    const html = choices({ app: null, logo: 'any', connectLabel: 'Connect an AI app' })
    expect(html).toContain('Your AI app (MCP)')
    expect(html).toContain('Have both? The key does the writing on every sync, and you can still ask your AI app about your apps.')
  })
})

describe('ConnectAICard by build', () => {
  const withAI = (ai: Partial<Settings['ai']>): Settings => ({ ...defaultSettings(), ai: { ...defaultSettings().ai, ...ai } })
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://tempo.example' } })
    fake.session = { status: 'signed-in', user: { id: 'u1' } }
    fake.settings = withAI({ provider: 'none' })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  const card = (props: Parameters<typeof ConnectAICard>[0] = {}) => renderToStaticMarkup(createElement(ConnectAICard, props))

  it('opens with the two choices when the API key is kept next to Claude (both)', () => {
    const html = card({ onUseApiKey: noop })
    expect(html).toContain('Pick how your app descriptions get written.')
    expect(html).toContain('Claude (MCP)')
    expect(html).toContain('Full automation')
    expect(html).toContain('Connected AI apps')
  })

  it('stays as it was for Claude only (mcp): one button, no API key choice', () => {
    const html = card()
    expect(html).toContain('Connect Claude</button>')
    expect(html).toContain('Claude app or Claude Code.')
    expect(html).not.toContain('Full automation')
    expect(html).not.toContain('API key')
  })

  it('says a saved key is in use, and never shows it', () => {
    vi.stubEnv('VITE_AI_MODE', 'both')
    fake.settings = withAI({ provider: 'anthropic', apiKey: 'sk-test' })
    const html = card({ onUseApiKey: noop })
    expect(html).toContain('A key is saved. Tempo writes the descriptions and tasks.')
    expect(html).not.toContain('sk-test')
  })

  it('does not count a key in mcp mode, where the browser calls no AI', () => {
    vi.stubEnv('VITE_AI_MODE', 'mcp')
    fake.settings = withAI({ provider: 'anthropic', apiKey: 'sk-test' })
    expect(card({ onUseApiKey: noop })).not.toContain('A key is saved')
  })

  it('still offers the API key choice before sign-in, with a sign-in prompt for Claude only', () => {
    fake.session = { status: 'signed-out', user: null }
    const html = card({ onUseApiKey: noop })
    expect(html).toContain('Add an API key')
    expect(html).toContain('Sign in first to connect an AI app.')
    expect(html).not.toContain('Connected AI apps')
  })
})
