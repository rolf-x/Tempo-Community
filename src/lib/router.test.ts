import { describe, expect, it } from 'vitest'
import { canonicalHash, isPublicRoute, parseHash, toHash, type Route } from './router'

describe('parseHash', () => {
  it('empty and #/ are home (App decides landing vs portfolio)', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
  })
  it('keeps portfolio pages and redirects removed task pages', () => {
    for (const n of ['settings', 'portfolio', 'login', 'welcome', 'setup', 'privacy'] as const) expect(parseHash(`#/${n}`)).toEqual({ name: n })
    for (const n of ['today', 'calendar', 'my', 'digest']) expect(parseHash(`#/${n}`)).toEqual({ name: 'portfolio' })
    expect(parseHash('#/savings')).toEqual({ name: 'notFound' }) // the in-app Savings page moved to the landing page
  })
  it('all project paths land on the app page', () => {
    expect(parseHash('#/p/p_1')).toEqual({ name: 'project', projectId: 'p_1', view: 'app' })
    expect(parseHash('#/p/p_1/board')).toEqual({ name: 'project', projectId: 'p_1', view: 'app' })
    expect(parseHash('#/p/p_1/list')).toEqual({ name: 'project', projectId: 'p_1', view: 'app' })
    expect(parseHash('#/p/p_1/calendar')).toEqual({ name: 'project', projectId: 'p_1', view: 'app' })
    expect(parseHash('#/p/p_1/app')).toEqual({ name: 'project', projectId: 'p_1', view: 'app' })
  })
  it('join carries the invite token', () => expect(parseHash('#/join/abc_123')).toEqual({ name: 'join', token: 'abc_123' }))
  it.each(['#/nope', '#/join', '#/p', '#/portfolio/nope'])('unknown path %s is notFound', (hash) => {
    expect(parseHash(hash)).toEqual({ name: 'notFound' })
  })
})

describe('isPublicRoute', () => {
  it('draws both landing designs, login, join and setup without the shell', () => {
    for (const r of [{ name: 'home' }, { name: 'welcome' }, { name: 'login' }, { name: 'setup' }, { name: 'join', token: 't' }, { name: 'privacy' }, { name: 'notFound' }] as Route[]) expect(isPublicRoute(r)).toBe(true)
    expect(isPublicRoute({ name: 'portfolio' })).toBe(false)
  })
})

describe('toHash round-trips', () => {
  const routes: Route[] = [{ name: 'home' }, { name: 'portfolio' }, { name: 'project', projectId: 'p_1', view: 'app' }, { name: 'join', token: 't1' }, { name: 'privacy' }, { name: 'notFound' }]
  it.each(routes)('%o', (r) => expect(parseHash(toHash(r))).toEqual(r))
})

describe('canonicalHash', () => {
  it('points removed pages at what they render', () => {
    expect(canonicalHash('#/my')).toBe('#/portfolio')
    expect(canonicalHash('#/digest')).toBe('#/portfolio')
    expect(canonicalHash('#/p/abc/list')).toBe('#/p/abc/app')
  })
  it('leaves current pages alone', () => {
    expect(canonicalHash('#/portfolio')).toBeNull()
    expect(canonicalHash('#/p/abc/app')).toBeNull()
    expect(canonicalHash('#/settings')).toBeNull()
  })
})
