import { describe, expect, it } from 'vitest'
import { pageOnly, pagePath } from './analytics'
import { parseHash, toHash } from './router'

const view = (url: string) => pageOnly({ type: 'pageview', url }).url

describe('pageOnly', () => {
  it('keeps the page name and drops ids and tokens', () => {
    expect(view('https://tempo.example.com/#/p/abc123/settings')).toBe('https://tempo.example.com/p')
    expect(view('https://tempo.example.com/#/join/secret-token')).toBe('https://tempo.example.com/join')
    expect(view('https://tempo.example.com/#/settings')).toBe('https://tempo.example.com/settings')
  })

  it('drops query strings and OAuth fragments', () => {
    expect(view('https://tempo.example.com/?code=abc&github_popup=1')).toBe('https://tempo.example.com/')
    expect(view('https://tempo.example.com/#access_token=abc&refresh_token=def')).toBe('https://tempo.example.com/')
    expect(view('https://tempo.example.com/')).toBe('https://tempo.example.com/')
  })

  it('names the page for in-app route changes, which Vercel cannot see in the hash', () => {
    expect(pagePath('#/p/abc123/brief')).toBe('/p')
    expect(pagePath('#/join/secret-token')).toBe('/join')
    expect(pagePath('#/')).toBe('/')
  })

  it('keeps the page name when a pageview path was set', () => {
    expect(view('https://tempo.example.com/settings#/settings')).toBe('https://tempo.example.com/settings')
    expect(view('https://tempo.example.com/p#/portfolio')).toBe('https://tempo.example.com/p')
  })

  it('ignores a pathname that is not a bare page name', () => {
    expect(view('https://tempo.example.com/x/secret-token#/settings')).toBe('https://tempo.example.com/settings')
    expect(view('https://tempo.example.com/Secret123')).toBe('https://tempo.example.com/')
  })
})

describe('route allowlist', () => {
  it('reports every real route by name', () => {
    for (const name of ['settings', 'portfolio', 'review', 'login', 'welcome', 'setup', 'directory', 'privacy', 'p', 'join']) {
      expect(pagePath(`#/${name}`), name).toBe(`/${name}`)
      expect(view(`https://tempo.example.com/#/${name}/x`), name).toBe(`https://tempo.example.com/${name}`)
    }
  })

  it('agrees with the router: whatever page the app shows is reported by its own name', () => {
    for (const hash of ['#/settings', '#/portfolio', '#/p/abc123/app', '#/join/some-token', '#/privacy']) {
      const route = parseHash(hash)
      expect(pagePath(toHash(route))).toBe(`/${route.name === 'project' ? 'p' : route.name}`)
    }
  })

  it('reports anything else as other, never the text', () => {
    for (const hash of ['#/secret-token', '#/Secret123/x', '#/sk-ant-abc', '#/a1b2c3d4', '#/invite-9f8e7d', '#/my', '#/p2']) {
      expect(pagePath(hash), hash).toBe('/other')
      expect(view(`https://tempo.example.com/${hash}`), hash).toBe('https://tempo.example.com/other')
    }
  })

  it('does not trust a pathname that is not a known route name', () => {
    expect(view('https://tempo.example.com/secret-token')).toBe('https://tempo.example.com/')
    expect(view('https://tempo.example.com/secret-token#/settings')).toBe('https://tempo.example.com/settings')
    expect(view('https://tempo.example.com/secret-token#/other-secret')).toBe('https://tempo.example.com/other')
    expect(view('https://tempo.example.com/other')).toBe('https://tempo.example.com/other')
  })

  it('keeps the home page and token-less fragments as the root', () => {
    expect(pagePath('')).toBe('/')
    expect(pagePath('#/')).toBe('/')
    expect(pagePath('#access_token=abc')).toBe('/')
  })
})
