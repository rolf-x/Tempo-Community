import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { aiBrands } from '../../lib/mcpSetup'
import { AiBrandDetail, AiBrandGrid, ClientsList, ConnectedNotice } from './ConnectAICard'

const hostileUrl = 'https://example.com/api/mcp?test="><script>alert(1)</script>'
const noop = () => {}

describe('ConnectAICard edge cases', () => {
  describe('XSS prevention with hostile URLs', () => {
    it('escapes hostile URL in AiBrandGrid', () => {
      const html = renderToStaticMarkup(createElement(AiBrandGrid, { brands: aiBrands(hostileUrl), onPick: noop }))
      expect(html).not.toContain('<script>')
      // Depending on the implementation, the URL might be URI-encoded or HTML-escaped. Both are safe.
    })

    it('escapes hostile URL in AiBrandDetail', () => {
      const brand = aiBrands(hostileUrl).find(b => b.id === 'chatgpt')!
      const html = renderToStaticMarkup(createElement(AiBrandDetail, { brand, way: brand.ways[0], url: hostileUrl, watch: 'waiting', onBack: noop, onChooseWay: noop, onCheckAgain: noop }))
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })

  describe('ConnectedNotice edge cases', () => {
    it('renders with several fresh clients and several others', () => {
      const fresh = [
        { clientId: '1', name: 'Claude', grantedOn: '' },
        { clientId: '2', name: 'ChatGPT', grantedOn: '' }
      ]
      const others = [
        { clientId: '3', name: 'Codex', grantedOn: '' },
        { clientId: '4', name: 'Cursor', grantedOn: '' }
      ]
      const html = renderToStaticMarkup(createElement(ConnectedNotice, { fresh, others, revoking: null, error: null, onDisconnect: noop }))
      expect(html).toContain('Claude, ChatGPT</span> are connected')
      expect(html).toContain('Disconnect Codex')
      expect(html).toContain('Disconnect Cursor')
    })
  })

  describe('Long client names', () => {
    it('renders correctly in ConnectedNotice and ClientsList', () => {
      const longName = 'A'.repeat(200)
      const clients = [{ clientId: '1', name: longName, grantedOn: 'Today' }]
      
      const noticeHtml = renderToStaticMarkup(createElement(ConnectedNotice, { fresh: clients, others: [], revoking: null, error: null, onDisconnect: noop }))
      expect(noticeHtml).toContain(longName)

      const listHtml = renderToStaticMarkup(createElement(ClientsList, { 
        state: { status: 'ready', clients }, 
        confirmId: null, revoking: null, error: null,
        onRetry: noop, onAskRevoke: noop, onCancel: noop, onRevoke: noop 
      }))
      expect(listHtml).toContain(longName)
    })
  })

  describe('ClientsList edge cases', () => {
    it('shows a busy button when revoking', () => {
      const clients = [{ clientId: 'a', name: 'Test App', grantedOn: '' }]
      const html = renderToStaticMarkup(createElement(ClientsList, {
        state: { status: 'ready', clients },
        confirmId: 'a', revoking: 'a', error: null,
        onRetry: noop, onAskRevoke: noop, onCancel: noop, onRevoke: noop
      }))
      // A loading state in most generic UI button components applies a disabled attribute.
      expect(html).toContain('disabled')
    })
  })

  describe('AiBrandDetail edge cases', () => {
    it('renders every way of every brand without throwing and always contains Waiting for you to click Allow', () => {
      for (const brand of aiBrands('https://example.com')) {
        for (const way of brand.ways) {
          const html = renderToStaticMarkup(createElement(AiBrandDetail, { brand, way, url: 'https://example.com', watch: 'waiting', onBack: noop, onChooseWay: noop, onCheckAgain: noop }))
          expect(html, way.id).toContain('Waiting for you to click Allow')
        }
      }
    })
  })
})
