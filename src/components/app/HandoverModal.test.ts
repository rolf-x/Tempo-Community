import { describe, expect, it } from 'vitest'
import type { StoredHandover } from '../../types'
import { isCheckedHandover, storedHandoverMarkdown } from './HandoverModal'

const stored = (doc: Partial<StoredHandover['doc']> = {}): StoredHandover => ({
  doc: { summary: 'Tracks invoices.', howToRun: ['npm run dev'], whereThingsAre: [{ path: 'src/', what: 'The app' }], openWork: [], risks: [], contacts: [], unknowns: [], ...doc },
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: '2026-10-05T09:00:00Z' },
})

describe('storedHandoverMarkdown', () => {
  it('is null when the app has no stored handover', () => {
    expect(storedHandoverMarkdown(null, 'acme/billing', 'Billing')).toBeNull()
    expect(storedHandoverMarkdown(undefined, 'acme/billing', 'Billing')).toBeNull()
  })

  it('renders the stored pack with handoverMarkdown', () => {
    const md = storedHandoverMarkdown(stored(), 'acme/billing', 'Billing') ?? ''
    expect(md).toContain('# Handover: Billing')
    expect(md).toContain('Tracks invoices.')
    expect(md).toContain('`npm run dev`')
  })

  it('cleans the pack again: secrets are redacted and markdown links go', () => {
    const md = storedHandoverMarkdown(stored({
      summary: 'Run it with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456. [Click](https://evil.example/x)',
    }), 'acme/billing', 'Billing') ?? ''
    expect(md).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(md).not.toContain('evil.example')
  })

  it('keeps links only into the app\'s own repo', () => {
    const md = storedHandoverMarkdown(stored({
      openWork: [
        { title: 'Fix login', evidenceUrl: 'https://github.com/acme/billing/issues/12' },
        { title: 'Elsewhere', evidenceUrl: 'https://github.com/other/repo/issues/1' },
      ],
    }), 'acme/billing', 'Billing') ?? ''
    expect(md).toContain('(https://github.com/acme/billing/issues/12)')
    expect(md).not.toContain('other/repo')
  })

  it('keeps no links at all when the app has no repo', () => {
    const md = storedHandoverMarkdown(stored({ openWork: [{ title: 'Fix login', evidenceUrl: 'https://github.com/acme/billing/issues/12' }] }), undefined, 'Billing') ?? ''
    expect(md).not.toContain('github.com')
  })

  it('is null for a pack the database holds in a shape Tempo cannot read', () => {
    const broken = { doc: { summary: 'x' }, draftedBy: stored().draftedBy } as unknown as StoredHandover
    expect(storedHandoverMarkdown(broken, 'acme/billing', 'Billing')).toBeNull()
  })

  it('is null when a list holds something other than text', () => {
    const odd = stored({ howToRun: [{ cmd: 'rm -rf /' }] as unknown as string[] })
    expect(storedHandoverMarkdown(odd, 'acme/billing', 'Billing')).toBeNull()
  })
})

describe('isCheckedHandover', () => {
  it('is a draft until a person marks it checked', () => {
    expect(isCheckedHandover(stored())).toBe(false)
    expect(isCheckedHandover({ ...stored(), checkedAt: null })).toBe(false)
    expect(isCheckedHandover({ ...stored(), checkedAt: 'yes' as unknown as string })).toBe(true)
    expect(isCheckedHandover({ ...stored(), checkedAt: '2026-10-05T10:00:00Z', checkedBy: 'm1' })).toBe(true)
    expect(isCheckedHandover(null)).toBe(false)
  })
})
