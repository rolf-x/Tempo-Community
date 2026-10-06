import { describe, expect, it } from 'vitest'
import type { HandoverOut } from '../schemas'
import { cleanCardDraft, cleanHandoverDraft, cleanTasksDraft, clientName, repoEvidenceUrls } from './mcpDrafts'

const doc = (patch: Partial<HandoverOut> = {}): HandoverOut => ({
  summary: 'Tracks invoices.',
  howToRun: ['npm run dev'],
  whereThingsAre: [{ path: 'src/', what: 'The app' }],
  openWork: [],
  risks: [],
  contacts: [],
  unknowns: [],
  ...patch,
})

describe('cleanCardDraft', () => {
  it('clips each field to the sync_app limits', () => {
    const out = cleanCardDraft({ what: 'w'.repeat(500), who: 'u'.repeat(500), stage: 'live', status: 's'.repeat(900) })
    expect(out.what.length).toBeLessThanOrEqual(240)
    expect(out.who.length).toBeLessThanOrEqual(160)
    expect(out.status.length).toBeLessThanOrEqual(400)
    expect(out.stage).toBe('live')
  })

  it('redacts secrets and strips markdown links an agent sends', () => {
    const out = cleanCardDraft({
      what: 'Billing app. [Log in here](https://evil.example/login)',
      who: 'Finance',
      stage: 'building',
      status: 'Set OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 to run it.',
    })
    expect(out.what).toBe('Billing app. Log in here')
    expect(out.status).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(out.status).toContain('[redacted]')
  })

  it('fills an empty who the way the prompt asks', () => {
    expect(cleanCardDraft({ what: 'An app', who: '  ', stage: 'idea', status: 'New' }).who).toBe('Not stated in the repo.')
  })
})

describe('repoEvidenceUrls', () => {
  it("keeps only issue, pull request and commit pages of the app's own repo", () => {
    const urls = repoEvidenceUrls(doc({ openWork: [
      { title: 'a', evidenceUrl: 'https://github.com/Acme/Billing/issues/12' },
      { title: 'b', evidenceUrl: 'https://github.com/acme/billing/pull/3' },
      { title: 'c', evidenceUrl: 'https://github.com/acme/billing/commit/0a1b2c3' },
      { title: 'd', evidenceUrl: 'https://github.com/acme/other/issues/1' },
      { title: 'e', evidenceUrl: 'https://github.com/acme/billing/issues/12/../../../evil' },
      { title: 'f', evidenceUrl: 'https://evil.example/acme/billing/issues/1' },
      { title: 'g', evidenceUrl: 'https://github.com/acme/billing.evil/issues/1' },
    ] }), 'acme/billing')
    expect([...urls].sort()).toEqual([
      'https://github.com/Acme/Billing/issues/12',
      'https://github.com/acme/billing/commit/0a1b2c3',
      'https://github.com/acme/billing/pull/3',
    ])
  })

  it('allows nothing when the app has no repo', () => {
    expect(repoEvidenceUrls(doc({ openWork: [{ title: 'a', evidenceUrl: 'https://github.com/acme/billing/issues/1' }] }), null).size).toBe(0)
  })
})

describe('cleanHandoverDraft', () => {
  it('drops links outside the repo, keeps repo links, and redacts', () => {
    const out = cleanHandoverDraft(doc({
      summary: 'See [docs](https://evil.example). DATABASE_URL=postgres://admin:hunter2secret@db.example.com/prod',
      openWork: [
        { title: 'Fix login', evidenceUrl: 'https://github.com/acme/billing/issues/7' },
        { title: 'Phish', evidenceUrl: 'https://evil.example/x' },
      ],
    }), 'acme/billing')
    expect(out.summary).not.toContain('evil.example')
    expect(out.summary).not.toContain('hunter2secret')
    expect(out.openWork).toEqual([
      { title: 'Fix login', evidenceUrl: 'https://github.com/acme/billing/issues/7' },
      { title: 'Phish' },
    ])
  })

  it('caps every list so one draft cannot fill the app document', () => {
    const many = Array.from({ length: 80 }, (_, i) => `item ${i}`)
    const out = cleanHandoverDraft(doc({ risks: many, howToRun: many, contacts: many, unknowns: many }), 'acme/billing')
    for (const list of [out.risks, out.howToRun, out.contacts, out.unknowns]) expect(list.length).toBeLessThanOrEqual(20)
  })

  it('clips long items', () => {
    const out = cleanHandoverDraft(doc({ risks: ['r'.repeat(2000)] }), 'acme/billing')
    expect(out.risks[0].length).toBeLessThanOrEqual(300)
  })
})

describe('cleanTasksDraft', () => {
  it('keeps plain tasks, with no detail as null', () => {
    expect(cleanTasksDraft([
      { problem: 'no-readme', title: 'Write a README', detail: 'Say what it does and how to run it.' },
      { problem: 'no-owner', title: 'Pick an owner' },
    ])).toEqual([
      { problem: 'no-readme', title: 'Write a README', detail: 'Say what it does and how to run it.' },
      { problem: 'no-owner', title: 'Pick an owner', detail: null },
    ])
  })

  it('removes links: a task is a note, never a link', () => {
    expect(cleanTasksDraft([{ problem: 'secrets', title: 'Rotate it at https://evil.example/login now', detail: 'See www.evil.example for help' }]))
      .toEqual([{ problem: 'secrets', title: 'Rotate it at now', detail: 'See for help' }])
  })

  it('clips the title to 80 characters and the detail to 240', () => {
    const [task] = cleanTasksDraft([{ problem: 'stale', title: 't'.repeat(300), detail: 'd'.repeat(500) }])
    expect(task.title.length).toBeLessThanOrEqual(80)
    expect(task.detail!.length).toBeLessThanOrEqual(240)
  })

  it('flattens markdown to text, redacts secrets and strips invisible characters', () => {
    const [task] = cleanTasksDraft([{
      problem: 'secrets',
      title: 'Rotate the key in [the console](https://evil.example/login)',
      detail: 'It is OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\u202e and was **committed**.',
    }])
    expect(task.title).toBe('Rotate the key in the console')
    expect(task.detail).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(task.detail).toContain('[redacted]')
    expect(task.detail).not.toContain('\u202e')
    expect(task.detail).toContain('was committed.')
  })

  it('drops tasks with an empty title and collapses whitespace in the rest', () => {
    expect(cleanTasksDraft([
      { problem: 'no-readme', title: '   ', detail: 'x' },
      { problem: 'no-readme', title: '\u200b', detail: 'x' },
      { problem: 'no-repo', title: ' Connect\n  a repo ', detail: '  ' },
    ])).toEqual([{ problem: 'no-repo', title: 'Connect a repo', detail: null }])
  })

  it('dedupes by problem and title, so the same title on another problem stays', () => {
    const out = cleanTasksDraft([
      { problem: 'stale', title: 'Archive it', detail: 'a' },
      { problem: 'stale', title: 'archive it', detail: 'b' },
      { problem: 'no-owner', title: 'Archive it' },
    ])
    expect(out.map((t) => [t.problem, t.detail])).toEqual([['stale', 'a'], ['no-owner', null]])
  })

  it('returns nothing for nothing', () => expect(cleanTasksDraft([])).toEqual([]))
})

describe('clientName', () => {
  it('uses the reported name, trimmed to one short line', () => {
    expect(clientName('  Claude Code  ')).toBe('Claude Code')
    expect(clientName('a\nb')).toBe('a b')
    expect(clientName('x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })

  it('falls back when the client sends nothing useful', () => {
    expect(clientName(undefined)).toBe('An AI agent')
    expect(clientName('   ')).toBe('An AI agent')
  })
})
