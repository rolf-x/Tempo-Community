import { describe, expect, it } from 'vitest'
import type { AppCard, Project } from '../types'
import { MAX_NAMED, appsNeedingCard, draftPrompt } from './claudeWork'

const card = (patch: Partial<AppCard> = {}): AppCard => ({ what: 'w', who: 'u', stage: 'live', status: 's', updatedAt: '2026-10-01T00:00:00Z', source: 'ai', checkedAt: '2026-10-01T00:00:00Z', ...patch })
const app = (id: string, patch: Partial<Project> = {}): Project => ({
  id, name: id, emoji: '', color: 'slate', description: '', createdAt: '2026-09-01T00:00:00Z', archived: false, ownerId: null,
  repo: { fullName: `acme/${id}`, url: `https://github.com/acme/${id}`, private: true, defaultBranch: 'main' } as Project['repo'],
  signals: null, appCard: null, lastActivityAt: null, autoApply: false, ...patch,
})

describe('which apps need a card from Claude', () => {
  it('takes apps with no card or only facts, and leaves drafts, checked cards, archived and sample apps alone', () => {
    const apps = [
      app('none'),
      app('facts', { appCard: card({ source: 'fallback', checkedAt: null }) }),
      app('draft', { appCard: card({ checkedAt: null }) }),
      app('checked', { appCard: card() }),
      app('archived', { archived: true }),
      app('norepo', { repo: null }),
      app('sample', { repo: { fullName: 'acme-sample/x', url: '', private: true, defaultBranch: 'main' } as Project['repo'] }),
    ]
    expect(appsNeedingCard(apps).map((p) => p.id)).toEqual(['none', 'facts'])
  })
})

describe('the message for Claude', () => {
  it('names the workspace and the apps, then asks for tasks', () => {
    expect(draftPrompt('Acme', ['Billing', 'Ops "board"'])).toBe(
      'Use Tempo to draft the app cards for "Billing" and "Ops board" in my "Acme" workspace. Then add tasks for the problems Tempo flags on my apps there.')
    expect(draftPrompt('Acme', ['Billing'])).toBe(
      'Use Tempo to draft the app cards for "Billing" in my "Acme" workspace. Then add tasks for the problems Tempo flags on my apps there.')
  })

  it('names which Tempo off live, so an AI app connected to live and staging uses the right one', () => {
    expect(draftPrompt('Acme', ['Billing'], 'Tempo (staging)')).toBe(
      'Use Tempo (staging) to draft the app cards for "Billing" in my "Acme" workspace. Then add tasks for the problems Tempo flags on my apps there.')
    expect(draftPrompt('Acme', [], 'Tempo (staging)')).toBe('Use Tempo (staging) to add tasks for the problems Tempo flags on my apps in my "Acme" workspace.')
  })

  it('describes the apps instead of naming them when there are many', () => {
    const many = Array.from({ length: MAX_NAMED + 1 }, (_, i) => `App ${i}`)
    expect(draftPrompt('Acme', many)).toBe(
      'Use Tempo to draft the app card for each app in my "Acme" workspace that Tempo marks as needing one. Then add tasks for the problems Tempo flags on my apps there.')
  })

  it('asks only for tasks when every card is fine', () => {
    expect(draftPrompt('Acme', [])).toBe('Use Tempo to add tasks for the problems Tempo flags on my apps in my "Acme" workspace.')
    expect(draftPrompt(null, [])).toBe('Use Tempo to add tasks for the problems Tempo flags on my apps.')
  })
})
