import type { Member } from '../../types'
import type { PortfolioRow } from './derive'

export const PORTFOLIO_VIEW_KEY = 'tempo.portfolio.view'
export const SHOW_ALL_APPS = 'tempo:show-all-apps'

export type PortfolioScope = 'my' | 'team' | 'all'

export function defaultPortfolioScope(viewer: Member | null): PortfolioScope {
  return viewer?.role === 'owner' || viewer?.isAdmin ? 'all' : 'my'
}

export function rowsInScope(rows: PortfolioRow[], scope: PortfolioScope, viewerId: string | null, members: Member[]): PortfolioRow[] {
  if (scope === 'all') return rows
  if (scope === 'my') return rows.filter((row) => row.project.ownerId === viewerId)
  const memberIds = new Set(members.map((member) => member.id))
  return rows.filter((row) => !!row.project.ownerId && row.project.ownerId !== viewerId && memberIds.has(row.project.ownerId))
}

export const portfolioStorageKey = (viewerId: string | null) => `${PORTFOLIO_VIEW_KEY}:${viewerId ?? 'guest'}`

export function requestAllApps() {
  window.dispatchEvent(new Event(SHOW_ALL_APPS))
}
