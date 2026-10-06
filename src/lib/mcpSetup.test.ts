import { describe, expect, it } from 'vitest'
import { aiBrands, clientLabel, clientsByWay, connectedClients, copyText, grantsFeed, matchClient, mcpUrl, newClients, type AiBrandId, type ClientsState, type ConnectedClient } from './mcpSetup'

const URL_ = globalThis.URL

const URL = 'https://tempo.example/api/mcp'

describe('mcpUrl', () => {
  it('is the site origin plus /api/mcp', () => {
    expect(mcpUrl('https://tempo.example')).toBe(URL)
    expect(mcpUrl('http://localhost:5173')).toBe('http://localhost:5173/api/mcp')
  })

  it('does not double a trailing slash', () => {
    expect(mcpUrl('https://tempo.example/')).toBe(URL)
  })
})

describe('aiBrands', () => {
  const brands = aiBrands(URL)
  const brand = (id: AiBrandId) => brands.find((item) => item.id === id)!
  const ways = brands.flatMap((item) => item.ways)
  const way = (id: string) => ways.find((item) => item.id === id)!
  const href = (id: string) => { const m = way(id).method; if (m.kind !== 'link') throw new Error(`${id} is not a link`); return m.href }
  const command = (id: string) => { const m = way(id).method; if (m.kind !== 'command') throw new Error(`${id} is not a command`); return m.command }
  /** Cursor's config is base64 of UTF-8 JSON. */
  const cursorConfig = (link: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(link.split('config=')[1])), (c) => c.charCodeAt(0))))

  it('offers the main AI brands first and ends with the way that works for any app', () => {
    expect(brands.map((item) => item.id)).toEqual(['claude', 'chatgpt', 'gemini', 'copilot', 'cursor', 'perplexity', 'le-chat', 'grok', 'any'])
    expect(brand('any').name).toBe('Any AI app')
    expect(brand('copilot').name).toBe('GitHub Copilot')
  })

  it("groups each brand's ways in, its main app first", () => {
    const byBrand = Object.fromEntries(brands.map((item) => [item.id, item.ways.map((entry) => entry.id)]))
    expect(byBrand).toEqual({
      claude: ['claude-app', 'claude-code'],
      chatgpt: ['chatgpt', 'codex'],
      gemini: ['gemini-app', 'antigravity', 'gemini-cli'],
      copilot: ['vscode', 'copilot-cli'],
      cursor: ['cursor'],
      perplexity: ['perplexity'],
      'le-chat': ['le-chat'],
      grok: ['grok'],
      any: ['other', 'windsurf', 'zed'],
    })
    expect(new Set(ways.map((item) => item.id)).size).toBe(ways.length)
  })

  it("opens claude.ai's Add custom connector dialog with Tempo's name and address", () => {
    const link = new URL_(href('claude-app'))
    expect(link.origin + link.pathname).toBe('https://claude.ai/customize/connectors')
    expect(Object.fromEntries(link.searchParams)).toEqual({ modal: 'add-custom-connector', connectorName: 'Tempo', connectorUrl: URL })
    expect(way('claude-app').method).toMatchObject({ web: true })
    // Claude, not Tempo, is where the browser ends up after Allow; the steps say so and point back here.
    expect(way('claude-app').steps.join(' ')).toContain('Claude takes you back to Claude')
  })

  it("says which ChatGPT plans can save drafts", () => {
    expect(way('chatgpt').steps.join(' ')).toContain('On Pro, ChatGPT can only read it.')
  })

  it('gives Cursor the server config as base64 JSON, and VS Code as URL-encoded JSON', () => {
    expect(href('cursor').startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=tempo&config=')).toBe(true)
    expect(cursorConfig(href('cursor'))).toEqual({ url: URL })
    expect(href('vscode').startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(href('vscode').slice('vscode:mcp/install?'.length)))).toEqual({ name: 'tempo', type: 'http', url: URL })
    expect(way('cursor').method).toMatchObject({ web: false })
  })

  it('gives each terminal tool one line; Claude Code and Codex sign in in the same line', () => {
    expect(command('claude-code')).toBe(`claude mcp add --transport http tempo ${URL} && claude mcp login tempo`)
    expect(command('codex')).toBe(`codex mcp add tempo --url ${URL} && codex mcp login tempo`)
    expect(command('antigravity')).toBe(`agy mcp add tempo ${URL}`)
    expect(command('gemini-cli')).toBe(`gemini mcp add --transport http tempo ${URL}`)
    expect(command('copilot-cli')).toBe(`copilot mcp add --transport http tempo ${URL}`)
    expect(way('gemini-cli').steps.join(' ')).toContain('/mcp auth tempo')
    // The names Claude Code gives Tempo's MCP prompts (checked in Claude Code 2.1, 5 Oct 2026).
    expect(way('claude-code').steps.join(' ')).toContain('/tempo:sync_app')
    expect(way('claude-code').steps.join(' ')).toContain('/tempo:handover')
  })

  it('has the chat apps and the other apps take the address', () => {
    for (const id of ['chatgpt', 'gemini-app', 'perplexity', 'le-chat', 'grok', 'windsurf', 'zed', 'other']) expect(way(id).method.kind).toBe('address')
  })

  it("ends every way in on Tempo's Allow page", () => {
    for (const item of ways) expect(item.steps.join(' '), item.id).toMatch(/Allow/)
  })

  it('gives the cloud apps no way in on a local site their servers could not reach, and says why', () => {
    const local = aiBrands('http://localhost:5173/api/mcp').flatMap((item) => item.ways)
    for (const id of ['claude-app', 'chatgpt', 'gemini-app', 'perplexity', 'le-chat', 'grok']) {
      const entry = local.find((item) => item.id === id)!
      expect(entry.method.kind, id).toBe('unavailable')
      expect(entry.steps.join(' '), id).toContain('localhost')
    }
    expect(local.find((item) => item.id === 'cursor')!.method.kind).toBe('link')
    expect(local.find((item) => item.id === 'claude-code')!.method.kind).toBe('command')
  })

  it('keeps an address with query characters intact in every link', () => {
    const odd = 'https://tempo.example/api/mcp?x=1&y=2'
    const all = aiBrands(odd).flatMap((item) => item.ways)
    const link = (id: string) => { const m = all.find((item) => item.id === id)!.method; return m.kind === 'link' ? m.href : '' }
    expect(new URL_(link('claude-app')).searchParams.get('connectorUrl')).toBe(odd)
    expect(cursorConfig(link('cursor')).url).toBe(odd)
    expect(JSON.parse(decodeURIComponent(link('vscode').slice('vscode:mcp/install?'.length))).url).toBe(odd)
  })

  it('quotes an address the shell would misread, and leaves a plain one bare', () => {
    const local = aiBrands('http://[::1]:5173/api/mcp').flatMap((item) => item.ways)
    const line = (id: string) => { const m = local.find((item) => item.id === id)!.method; return m.kind === 'command' ? m.command : '' }
    expect(line('codex')).toBe("codex mcp add tempo-local --url 'http://[::1]:5173/api/mcp' && codex mcp login tempo-local")
    expect(line('antigravity')).toBe("agy mcp add tempo-local 'http://[::1]:5173/api/mcp'")
    expect(command('codex')).not.toContain("'")
  })

  it('names staging "Tempo (staging)" everywhere an AI app shows the name, and live plainly', () => {
    const staging = 'https://tempo-staging.example.com/api/mcp'
    const ways = aiBrands(staging).flatMap((item) => item.ways)
    const way = (id: string) => ways.find((item) => item.id === id)!
    const text = (id: string) => { const m = way(id).method; return m.kind === 'command' ? m.command : m.kind === 'link' ? m.href : '' }
    expect(text('claude-app')).toContain(`connectorName=${encodeURIComponent('Tempo (staging)')}&`)
    expect(way('claude-app').steps[0]).toBe('Claude opens with Tempo (staging) filled in. Click Add.')
    expect(text('claude-code')).toBe(`claude mcp add --transport http tempo-staging ${staging} && claude mcp login tempo-staging`)
    expect(way('claude-code').steps.join(' ')).toContain('/tempo-staging:sync_app')
    for (const id of ['codex', 'antigravity', 'gemini-cli', 'copilot-cli']) expect(text(id), id).toMatch(/ tempo-staging /)
    expect(text('cursor')).toContain('name=tempo-staging&')
    expect(JSON.parse(decodeURIComponent(text('vscode').slice('vscode:mcp/install?'.length))).name).toBe('tempo-staging')
    // Live keeps the plain name.
    expect(aiBrands('https://tempo.example.com/api/mcp').flatMap((item) => item.ways).find((item) => item.id === 'claude-app')!.method)
      .toMatchObject({ href: expect.stringContaining('connectorName=Tempo&') })
  })
})

describe('copyText', () => {
  it('copies the command for a terminal tool and the address for the rest', () => {
    const ways = aiBrands(URL).flatMap((item) => item.ways)
    expect(copyText(ways.find((item) => item.id === 'codex')!, URL)).toBe(`codex mcp add tempo --url ${URL} && codex mcp login tempo`)
    expect(copyText(ways.find((item) => item.id === 'chatgpt')!, URL)).toBe(URL)
  })
})

describe('newClients', () => {
  it('is the clients that were not there when the picker opened', () => {
    const now = [{ clientId: 'a', name: 'Claude Code', grantedOn: '' }, { clientId: 'b', name: 'Codex', grantedOn: '' }]
    expect(newClients(new Set(['a']), now).map((item) => item.clientId)).toEqual(['b'])
    expect(newClients(new Set(['a', 'b']), now)).toEqual([])
  })
})

describe('clientLabel', () => {
  it('flattens whitespace, clips long names and names an empty one', () => {
    expect(clientLabel('  Claude \n Code ')).toBe('Claude Code')
    expect(clientLabel('x'.repeat(200))).toHaveLength(60)
    expect(clientLabel('')).toBe('Unnamed AI client')
    expect(clientLabel(null)).toBe('Unnamed AI client')
  })
})

describe('connectedClients', () => {
  it('lists the newest grant first with a readable date', () => {
    const list = connectedClients([
      { client: { id: 'a', name: 'Codex' }, granted_at: new Date(2026, 8, 1, 12).toISOString() },
      { client: { id: 'b', name: 'Claude Code' }, granted_at: new Date(2026, 9, 4, 12).toISOString() },
    ])
    expect(list.map((item) => item.clientId)).toEqual(['b', 'a'])
    expect(list[0]).toMatchObject({ name: 'Claude Code', grantedOn: '4 Oct 2026' })
  })

  it('shows one row per client and survives a missing date or name', () => {
    const list = connectedClients([
      { client: { id: 'a', name: null }, granted_at: 'not a date' },
      { client: { id: 'a', name: 'Dup' }, granted_at: null },
    ])
    expect(list).toEqual([{ clientId: 'a', name: 'Unnamed AI client', grantedOn: '' }])
  })
})

describe('grantsFeed', () => {
  const client = (clientId: string): ConnectedClient => ({ clientId, name: clientId, grantedOn: '' })
  /** A fetch that answers when the test says so. */
  function deferredFetch() {
    const calls: { resolve: (list: ConnectedClient[]) => void; reject: (error: Error) => void }[] = []
    const fetchList = () => new Promise<ConnectedClient[]>((resolve, reject) => { calls.push({ resolve, reject }) })
    return { calls, fetchList }
  }
  function setup(start: ClientsState = { status: 'loading' }) {
    let state: ClientsState = start
    let clock = 0
    const { calls, fetchList } = deferredFetch()
    const feed = grantsFeed(fetchList, (next) => { state = next(state) }, () => clock)
    return { feed, calls, state: () => state, tick: (ms: number) => { clock += ms } }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('lets a poll share a request started a moment ago, but asks afresh otherwise', async () => {
    const { feed, calls, tick } = setup()
    const first = feed.load({ quiet: true })
    expect(feed.load({ quiet: true, join: true })).toBe(first)
    expect(calls).toHaveLength(1)
    tick(2500)
    void feed.load({ quiet: true, join: true })
    expect(calls).toHaveLength(2)
    // Coming back to the tab or an Allow elsewhere never joins: it asks again at once.
    void feed.load({ quiet: true })
    expect(calls).toHaveLength(3)
  })

  it('lets the newest request set the list, even when an older one answers last', async () => {
    const { feed, calls, state } = setup()
    void feed.load({ quiet: true })
    void feed.load({ quiet: true })
    calls[1].resolve([client('new')])
    await settle()
    calls[0].resolve([client('old')])
    await settle()
    expect(state()).toEqual({ status: 'ready', clients: [client('new')] })
  })

  it('drops an answer that was on its way when the list was invalidated (a revoke)', async () => {
    const { feed, calls, state } = setup({ status: 'ready', clients: [client('kept')] })
    const before = feed.load({ quiet: true })
    feed.invalidate()
    calls[0].resolve([client('kept'), client('revoked')])
    expect(await before).toEqual([client('kept'), client('revoked')])
    expect(state()).toEqual({ status: 'ready', clients: [client('kept')] })
  })

  it('keeps the list on a failed quiet check, and shows the error when there is no list yet', async () => {
    const shown = setup({ status: 'ready', clients: [client('a')] })
    const quiet = shown.feed.load({ quiet: true })
    shown.calls[0].reject(new Error('offline'))
    expect(await quiet).toBeNull()
    expect(shown.state()).toEqual({ status: 'ready', clients: [client('a')] })

    const first = setup()
    void first.feed.load()
    void first.feed.load({ quiet: true })
    first.calls[1].reject(new Error('offline'))
    await settle()
    expect(first.state()).toEqual({ status: 'error' })
  })
})

describe('matchClient', () => {
  it('tells the apps apart by the names they register with', () => {
    // Names seen on staging and in the CLIs' source (5 Oct 2026).
    expect(matchClient('Claude')).toEqual({ way: 'claude-app', brand: 'claude' })
    expect(matchClient('Claude Code (tempo)')).toEqual({ way: 'claude-code', brand: 'claude' })
    expect(matchClient('Gemini CLI MCP Client')).toEqual({ way: 'gemini-cli', brand: 'gemini' })
    expect(matchClient('Codex')).toEqual({ way: 'codex', brand: 'chatgpt' })
    expect(matchClient('ChatGPT')).toEqual({ way: 'chatgpt', brand: 'chatgpt' })
    expect(matchClient('Visual Studio Code')).toEqual({ way: 'vscode', brand: 'copilot' })
    expect(matchClient('GitHub Copilot CLI')).toEqual({ way: 'copilot-cli', brand: 'copilot' })
    expect(matchClient('Cursor')).toEqual({ way: 'cursor', brand: 'cursor' })
    expect(matchClient('Windsurf')).toEqual({ way: 'windsurf', brand: 'any' })
  })

  it('matches nothing for a name it does not know', () => {
    expect(matchClient('Tempo E2E check')).toBeNull()
    expect(matchClient('Unnamed AI client')).toBeNull()
    expect(matchClient('My Claude helper')).toBeNull()
    // A wrong match would hide that app's way in, so a name that only contains a brand stays unknown.
    expect(matchClient('Cursor helper')).toBeNull()
    expect(matchClient('My ChatGPT tool')).toBeNull()
    expect(matchClient('OpenAI Agents SDK')).toBeNull()
    expect(matchClient('Copilot for Docs')).toBeNull()
  })
})

describe('clientsByWay', () => {
  it('groups the connected clients by way and leaves unknown ones out', () => {
    const list = [
      { clientId: 'a', name: 'Claude Code (tempo)', grantedOn: '' },
      { clientId: 'b', name: 'Claude Code (tempo)', grantedOn: '' },
      { clientId: 'c', name: 'Claude', grantedOn: '' },
      { clientId: 'd', name: 'Tempo E2E check', grantedOn: '' },
    ]
    const byWay = clientsByWay(list)
    expect([...byWay.keys()]).toEqual(['claude-code', 'claude-app'])
    expect(byWay.get('claude-code')?.map((item) => item.clientId)).toEqual(['a', 'b'])
  })
})
