import { describe, expect, it } from 'vitest'
import { appDefaults } from './model'
import type { Project } from '../types'
import { isAICardOutOfDate } from './cardFreshness'

const project = (patch: Partial<Project> = {}): Project => ({
  id: 'app', name: 'Payments', emoji: 'P', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false,
  ...appDefaults(),
  repo: { fullName: 'acme/payments', url: 'https://github.com/acme/payments', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-03T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' },
  appCard: {
    what: 'Payments worker', who: 'Finance', stage: 'live', status: 'The .env file was removed.', updatedAt: '2026-10-02T00:00:00Z', source: 'ai',
    evidence: {
      readme: null, deployFile: null,
      lastCommit: { message: 'Remove .env', author: 'Maya', at: '2026-10-02T00:00:00Z', url: 'https://github.com/acme/payments/commit/old' },
      repoFacts: { hasReadme: true, secretFiles: [], private: true, lastCommitAt: '2026-10-02T00:00:00Z' },
    },
  },
  ...patch,
})

describe('isAICardOutOfDate', () => {
  it('spots new and cleared health facts after an AI card was written', () => {
    const newSecret = project()
    newSecret.appCard = { ...newSecret.appCard!, evidence: { ...newSecret.appCard!.evidence!, repoFacts: { ...newSecret.appCard!.evidence!.repoFacts!, lastCommitAt: newSecret.signals!.lastCommitAt } } }
    newSecret.signals = { ...newSecret.signals!, secretFiles: ['.env'] }
    expect(isAICardOutOfDate(newSecret)).toBe(true)

    const hadSecret = project()
    hadSecret.appCard = { ...hadSecret.appCard!, evidence: { ...hadSecret.appCard!.evidence!, repoFacts: { ...hadSecret.appCard!.evidence!.repoFacts!, secretFiles: ['.env'], lastCommitAt: hadSecret.signals!.lastCommitAt } } }
    expect(isAICardOutOfDate(hadSecret)).toBe(true)
  })

  it('does not mark a card stale just because the same facts were synced again', () => {
    const unchanged = project()
    unchanged.appCard = { ...unchanged.appCard!, evidence: { ...unchanged.appCard!.evidence!, repoFacts: { ...unchanged.appCard!.evidence!.repoFacts!, lastCommitAt: unchanged.signals!.lastCommitAt } } }
    expect(isAICardOutOfDate(unchanged)).toBe(false)
  })

  it('uses last-commit evidence for cards saved before fact snapshots', () => {
    const legacy = project()
    legacy.appCard = { ...legacy.appCard!, evidence: { ...legacy.appCard!.evidence!, repoFacts: undefined } }
    expect(isAICardOutOfDate(legacy)).toBe(true)
  })
})
