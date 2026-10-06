import type { BeforeSendEvent } from '@vercel/analytics/react'
import { ROUTE_SEGMENTS } from './router'

const KNOWN = new Set(ROUTE_SEGMENTS)

/** The route name if Tempo has such a route, else "other": a stray first segment can be anything a person pastes in. */
const nameOf = (segment: string | undefined) => (segment === undefined ? '' : KNOWN.has(segment) ? segment : 'other')

/** The page name alone (`#/p/<id>/brief` → `/p`): never app ids, invite tokens or sign-in codes. An unknown name is `/other`. */
export function pagePath(hash: string): string {
  return `/${nameOf(/^#\/([^/?#]+)/.exec(hash)?.[1])}`
}

/**
 * Last stop before Vercel: the reported URL keeps only the origin and the page name, no query or hash. The page
 * comes from the pathname Tempo set for the pageview (the hash may already be on the next page by then), else the hash.
 * A pathname counts only when it is a known route name; anything else is not trusted to be free of ids.
 */
export function pageOnly(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url)
  const named = /^\/([a-z-]+)$/.exec(url.pathname)?.[1]
  const page = named && (KNOWN.has(named) || named === 'other') ? url.pathname : pagePath(url.hash)
  return { ...event, url: `${url.origin}${page}` }
}
