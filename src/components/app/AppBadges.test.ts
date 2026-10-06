import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { HealthFlag } from '../../ai/tools/health'
import type { AppCard } from '../../types'
import { DraftBadge, HealthFlags } from './AppBadges'

const flag = (kind: HealthFlag['kind'], severity: HealthFlag['severity'], label: string): HealthFlag => ({ kind, severity, label })

describe('HealthFlags', () => {
  it('uses danger only for real risks and warning for people and pace flags', () => {
    const html = renderToStaticMarkup(createElement(HealthFlags, {
      flags: [
        flag('secrets', 'high', 'Secret committed'),
        flag('public-repo', 'medium', 'Public repo'),
        flag('no-owner', 'high', 'No owner'),
        flag('stale', 'medium', 'Stale'),
        flag('no-readme', 'low', 'No README'),
      ],
      max: 5,
    }))
    const classesFor = (label: string) => html.match(new RegExp(`<li[^>]*class="([^"]*)"[^>]*>(?:(?!</li>)[\\s\\S])*${label}`))?.[1]

    expect(classesFor('Secret committed')).toContain('bg-danger-soft text-danger')
    expect(classesFor('Public repo')).toContain('bg-danger-soft text-danger')
    expect(classesFor('No owner')).toContain('bg-warning-soft text-warning')
    expect(classesFor('Stale')).toContain('bg-warning-soft text-warning')
    expect(classesFor('No README')).toContain('bg-surface-2 text-text-muted')
  })
})

describe('DraftBadge', () => {
  const card: AppCard = { what: 'w', who: 'u', stage: 'live', status: 's', updatedAt: '2026-10-05T09:00:00Z', source: 'ai', checkedAt: null }
  it('says Tempo for its own drafts and names the client for an MCP draft', () => {
    expect(renderToStaticMarkup(createElement(DraftBadge, { card }))).toContain('Drafted by Tempo')
    const mcp = renderToStaticMarkup(createElement(DraftBadge, { card: { ...card, draftedBy: { client: 'Codex', clientId: 'c1', memberId: 'm1', at: '2026-10-05T09:00:00Z' } } }))
    expect(mcp).toContain('Drafted by Codex')
    expect(mcp).not.toContain('Tempo')
  })
  it('shows nothing once a person has checked the card', () => {
    expect(renderToStaticMarkup(createElement(DraftBadge, { card: { ...card, checkedAt: '2026-10-05T10:00:00Z' } }))).toBe('')
  })
})

