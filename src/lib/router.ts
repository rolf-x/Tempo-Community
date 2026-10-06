// Tiny hash router. Removed task routes resolve to their nearest portfolio page.
import { useEffect, useSyncExternalStore } from 'react'

export type ProjectView = 'app'
const PAGES = ['settings', 'portfolio', 'review', 'login', 'welcome', 'setup', 'directory', 'privacy'] as const
type Page = (typeof PAGES)[number]
/** The first address segment of every real route (#/settings, #/p/<id>/app, #/join/<token>). Analytics reports only these names. */
export const ROUTE_SEGMENTS: readonly string[] = [...PAGES, 'p', 'join']

export type Route =
  | { name: 'home' } // App resolves it: landing for new visitors, portfolio otherwise
  | { name: 'notFound' }
  | { name: Page }
  | { name: 'project'; projectId: string; view: ProjectView }
  | { name: 'join'; token: string }

/** Routes drawn without the app shell (no sidebar/topbar). */
export const isPublicRoute = (r: Route) => r.name === 'home' || r.name === 'welcome' || r.name === 'login' || r.name === 'join' || r.name === 'setup' || r.name === 'privacy' || r.name === 'notFound'

const REMOVED_PAGES = ['my', 'digest', 'today', 'calendar']

/** The address a removed page should show instead (#/my → #/portfolio, #/p/x/list → #/p/x/app), or null. */
export function canonicalHash(hash: string): string | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const removed = (parts.length === 1 && REMOVED_PAGES.includes(parts[0])) || (parts[0] === 'p' && !!parts[1] && !!parts[2] && parts[2] !== 'app')
  return removed ? toHash(parseHash(hash)) : null
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'p' && parts[1]) {
    return { name: 'project', projectId: parts[1], view: 'app' }
  }
  if (parts[0] === 'join' && parts[1]) return { name: 'join', token: parts[1] }
  if (parts.length === 1 && REMOVED_PAGES.includes(parts[0])) return { name: 'portfolio' }
  const page = parts.length === 1 ? PAGES.find((p) => p === parts[0]) : undefined
  return page ? { name: page } : { name: parts.length === 0 ? 'home' : 'notFound' }
}

export function toHash(r: Route): string {
  if (r.name === 'project') return `#/p/${r.projectId}/${r.view}`
  if (r.name === 'join') return `#/join/${r.token}`
  if (r.name === 'home') return '#/'
  return `#/${r.name}`
}

export function navigate(r: Route) {
  window.location.hash = toHash(r)
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  // Keep the address bar in step with what renders, without adding a history entry.
  useEffect(() => {
    const next = canonicalHash(hash)
    if (next) history.replaceState(null, '', next)
  }, [hash])
  return parseHash(hash)
}
