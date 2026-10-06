import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The guide state persists to localStorage, which it looks up when the module loads.
vi.hoisted(() => {
  const items = new Map<string, string>()
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) } })
})

const { ClaudeBanner } = await import('./ClaudeNotices')
const { useGuideState } = await import('../guide/guideState')

describe('Claude is not connected', () => {
  it('says so at the top, with Connect Claude and a way to hide it until the next sign-in', () => {
    const html = renderToStaticMarkup(createElement(ClaudeBanner, { onConnect: () => {}, onHide: () => {} }))
    expect(html).toContain('role="status"')
    expect(html).toContain('Claude isn&#x27;t connected.')
    expect(html).toContain('Claude writes your app descriptions and adds tasks when an app has a problem.')
    expect(html).toContain('>Connect Claude<')
    expect(html).toContain('aria-label="Hide until next sign-in"')
  })

  it('remembers per person which sign-in it reminded and hid the banner in', () => {
    useGuideState.getState().setClaudeNotice('u1', { remindedFor: 's1' })
    useGuideState.getState().setClaudeNotice('u1', { bannerHiddenFor: 's1' })
    expect(useGuideState.getState().claude).toEqual({ u1: { remindedFor: 's1', bannerHiddenFor: 's1' } })
    expect(JSON.parse(localStorage.getItem('tempo-guide') ?? '{}').state.claude.u1.remindedFor).toBe('s1')
  })
})
