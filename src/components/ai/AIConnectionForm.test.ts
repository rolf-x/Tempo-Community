import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AIConnectionForm } from './AIConnectionForm'

const saved = { provider: 'anthropic' as const, preset: null, baseUrl: null, apiKey: 'sk-ant-saved-secret-7f3a', model: 'claude-sonnet-5-5' }

describe('AIConnectionForm', () => {
  it('renders the key guide with one primary action', () => {
    const html = renderToStaticMarkup(createElement(AIConnectionForm, { showSkip: true }))
    for (const provider of ['Claude', 'OpenAI', 'Gemini', 'Grok', 'OpenRouter', 'Ollama', 'Custom']) expect(html).toContain(provider)
    expect(html).toContain('Create a key')
    expect(html).toContain('Add credit')
    expect(html).toContain('Test and save')
    expect(html).toContain('Skip for now')
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1)
  })

  it('never puts a saved key back into the page when editing', () => {
    const html = renderToStaticMarkup(createElement(AIConnectionForm, { initial: saved, lockProvider: true, onSave: () => true }))
    expect(html).not.toContain('sk-ant-saved-secret')
    expect(html).toContain('Saved key ending 7f3a')
  })

  it('hides the provider tiles when editing, and shows the model as step 4', () => {
    const html = renderToStaticMarkup(createElement(AIConnectionForm, { initial: saved, lockProvider: true, onSave: () => true }))
    expect(html).not.toContain('aria-label="AI providers"')
    expect(html).toContain('Pick a model')
    expect(html).toContain('claude-sonnet-5-5')
  })

  it('starts a new key on Claude with nothing filled in', () => {
    const html = renderToStaticMarkup(createElement(AIConnectionForm, { onSave: () => true }))
    expect(html).toContain('aria-label="AI providers"')
    expect(html).toContain('placeholder="Claude key"')
  })
})
