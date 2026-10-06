import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SavedAIConnection } from '../../types'
import { SavedConnectionsList, type SavedConnectionsListProps } from './AIConnectionCard'

const noop = () => {}
const saved = (id: string, ai: Partial<SavedAIConnection['ai']>): SavedAIConnection => ({
  id, savedAt: '2026-10-05', ai: { provider: 'anthropic', preset: null, baseUrl: null, apiKey: 'sk-secret', model: null, ...ai },
})
const connections = [
  saved('a', { model: 'claude-sonnet-5-5' }),
  saved('b', { provider: 'openai-compatible', preset: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }),
]
const list = (patch: Partial<SavedConnectionsListProps> = {}) => renderToStaticMarkup(createElement(SavedConnectionsList, {
  connections, defaultId: 'a', confirmId: null, onMakeDefault: noop, onEdit: noop, onAskRemove: noop, onCancelRemove: noop, onRemove: noop, ...patch,
}))

describe('SavedConnectionsList', () => {
  it('lists each key by provider and model, and marks the default', () => {
    const html = list()
    expect(html).toContain('Claude')
    expect(html).toContain('claude-sonnet-5-5')
    expect(html).toContain('OpenAI')
    expect(html).toContain('gpt-5')
    expect(html.match(/>Default</g)).toHaveLength(1)
    expect(html.match(/>Make default</g)).toHaveLength(1)
  })

  it('never shows a key', () => {
    expect(list()).not.toContain('sk-secret')
  })

  it('says when a key will use the recommended model', () => {
    expect(list({ connections: [saved('c', {})], defaultId: 'c' })).toContain('Recommended model')
  })

  it('asks before removing, and says what happens to the default', () => {
    const html = list({ confirmId: 'a' })
    expect(html).toContain('Remove key')
    expect(html).toContain('The next key becomes the default.')
    expect(list({ connections: [connections[0]], confirmId: 'a' })).toContain('App cards go back to repo facts only.')
  })

  it('has an empty state', () => {
    expect(list({ connections: [] })).toContain('No API key saved')
  })
})
