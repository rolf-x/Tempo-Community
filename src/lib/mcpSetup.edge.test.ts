import { describe, expect, it } from 'vitest'
import { aiBrands, copyText, mcpUrl, newClients } from './mcpSetup'

const ways = (url: string) => aiBrands(url).flatMap((brand) => brand.ways)

describe('mcpUrl edge cases', () => {
  it('handles origins with trailing slashes, ports, IPv6, uppercase scheme', () => {
    expect(mcpUrl('https://example.com/')).toBe('https://example.com/api/mcp')
    expect(mcpUrl('https://example.com:8080')).toBe('https://example.com:8080/api/mcp')
    expect(mcpUrl('http://[::1]:3000')).toBe('http://[::1]:3000/api/mcp')
    expect(mcpUrl('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM/api/mcp')
    expect(mcpUrl('https://example.com///')).toBe('https://example.com/api/mcp')
  })
})

describe('aiBrands edge cases', () => {
  it('encodes URLs with quotes, spaces, unicode, #, and & safely', () => {
    const oddUrl = 'https://tempö.example/api/mcp?x=1&y=2#hash " space'
    const all = ways(oddUrl)
    const method = (id: string) => all.find((way) => way.id === id)!.method

    const claude = method('claude-app')
    if (claude.kind !== 'link') throw new Error('claude-app is not a link')
    expect(new URL(claude.href).searchParams.get('connectorUrl')).toBe(oddUrl)

    const cursor = method('cursor')
    if (cursor.kind !== 'link') throw new Error('cursor is not a link')
    // Cursor's config is base64 of UTF-8 JSON, so decode the bytes as UTF-8.
    const bytes = Uint8Array.from(atob(decodeURIComponent(cursor.href.split('config=')[1])), (c) => c.charCodeAt(0))
    expect(JSON.parse(new TextDecoder().decode(bytes)).url).toBe(oddUrl)

    const vscode = method('vscode')
    if (vscode.kind !== 'link') throw new Error('vscode is not a link')
    expect(JSON.parse(decodeURIComponent(vscode.href.split('?').slice(1).join('?'))).url).toBe(oddUrl)

    // In a terminal line the odd address stays one shell word.
    const codex = method('codex')
    if (codex.kind !== 'command') throw new Error('codex is not a command')
    expect(codex.command).toContain(`'${oddUrl}'`)
  })

  it('offers the Claude app link only for https', () => {
    expect(ways('https://example.com').find((way) => way.id === 'claude-app')?.method.kind).toBe('link')
    expect(ways('http://example.com').find((way) => way.id === 'claude-app')?.method.kind).toBe('unavailable')
  })

  it('has unique way ids', () => {
    const ids = ways('https://example.com').map((way) => way.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('mentions Allow in every way that can connect, on a local site too', () => {
    // A cloud app can't reach localhost, so it gets the reason instead of steps that end on Allow.
    for (const way of ways('http://example.com').filter((entry) => entry.method.kind !== 'unavailable')) {
      expect(way.steps.some((step) => step.includes('Allow')), way.id).toBe(true)
    }
  })

  it('includes the URL exactly once in command ways', () => {
    const url = 'https://example.com/api/mcp'
    for (const way of ways(url)) {
      if (way.method.kind === 'command') expect(way.method.command.split(url).length, way.id).toBe(2)
    }
  })
})

describe('newClients edge cases', () => {
  it('handles empty sets, duplicates, and existing clients', () => {
    const before = new Set(['a', 'b'])
    expect(newClients(before, [])).toEqual([])

    const nowWithDups = [
      { clientId: 'c', name: 'New 1', grantedOn: '' },
      { clientId: 'c', name: 'New 1', grantedOn: '' },
    ]
    expect(newClients(before, nowWithDups).length).toBe(2)

    const nowWithExisting = [
      { clientId: 'a', name: 'Existing', grantedOn: '' },
      { clientId: 'c', name: 'New 1', grantedOn: '' },
    ]
    expect(newClients(before, nowWithExisting)).toEqual([{ clientId: 'c', name: 'New 1', grantedOn: '' }])
    expect(newClients(new Set(), nowWithExisting).length).toBe(2)
  })
})

describe('copyText edge cases', () => {
  it('returns the command for a terminal way and the address otherwise', () => {
    const url = 'https://example.com'
    for (const way of ways(url)) expect(copyText(way, url)).toBe(way.method.kind === 'command' ? way.method.command : url)
  })
})
