import { describe, expect, it } from 'vitest'
import { cleanHandover, factUrls, fallbackHandover, withDeploymentEvidence } from './handoverFallback'
import { HandoverOut } from '../schemas'
import type { RepoFacts } from './repoFacts'

const facts: RepoFacts = {
  meta: { fullName: 'acme/app', url: 'https://github.com/acme/app', private: true, defaultBranch: 'main', description: 'Slack bot for receipts', pushedAt: null },
  readme: '# Expense bot\n\nPost a receipt photo and it lands in the finance sheet.\n\n```\nnpm install\nnpm run dev\n```\n',
  files: [{ path: 'CLAUDE.md', text: 'rules' }, { path: 'memory/progress.md', text: 'x' }],
  deployFile: null,
  commits: [],
  pulls: [{ number: 3, title: 'Weekly summary', author: 'maya', url: 'https://github.com/acme/app/pull/3', draft: false }],
  issues: [{ number: 7, title: 'VAT parsed wrong', url: 'https://github.com/acme/app/issues/7', labels: ['bug'] }],
}
const flags = [{ kind: 'owner-left' as const, severity: 'high' as const, label: 'Owner has left' }]

describe('fallbackHandover', () => {
  const d = fallbackHandover(facts, flags, 'Maya')
  it('is schema-valid', () => expect(HandoverOut.safeParse(d).success).toBe(true))
  it('summary comes from the README first paragraph', () => expect(d.summary).toContain('receipt photo'))
  it('pulls run commands from the README', () => expect(d.howToRun).toEqual(['npm install', 'npm run dev']))
  it('lists the agent memory files present', () => expect(d.whereThingsAre.map((w) => w.path)).toEqual(['README.md', 'CLAUDE.md', 'memory/progress.md']))
  it('open issues and PRs become open work with their URLs', () => {
    expect(d.openWork).toEqual([
      { title: 'PR #3: Weekly summary', evidenceUrl: 'https://github.com/acme/app/pull/3' },
      { title: 'Issue #7: VAT parsed wrong', evidenceUrl: 'https://github.com/acme/app/issues/7' },
    ])
  })
  it('health flags become risks', () => expect(d.risks).toContain('Owner has left'))
  it('never invents contacts; unknowns name the owner', () => {
    expect(d.contacts).toEqual([])
    expect(d.unknowns.every((u) => u.startsWith('Unknown — ask Maya'))).toBe(true)
  })
  it('missing README and files fall into unknowns', () => {
    const e = fallbackHandover({ ...facts, readme: null, files: [], pulls: [], issues: [] }, [], null)
    expect(e.howToRun).toEqual([])
    expect(e.unknowns.join(' ')).toContain('how to run')
    expect(e.unknowns[0]).toContain('ask the team')
  })
  it('uses the live URL and deploy file instead of calling the deployment unknown', () => {
    const live = fallbackHandover({ ...facts, deployFile: 'vercel.json' }, [], 'Maya', {
      liveUrl: 'https://app.acme.test',
      deployFile: 'vercel.json',
    })
    expect(live.whereThingsAre).toContainEqual({
      path: 'vercel.json',
      what: 'Deployment config · live at [https://app.acme.test](https://app.acme.test)',
    })
    expect(live.unknowns.join(' ')).not.toMatch(/where it is deployed/i)
    expect(live.unknowns.join(' ')).toContain('accounts and environment variables')
  })
})

describe('cleanHandover', () => {
  const allowed = factUrls(facts)
  const dirty: HandoverOut = {
    summary: 'Receipts bot. See [the docs](https://evil.example/phish) and **read this**.',
    howToRun: ['`npm run dev`', 'python src/__tests__/run.py\n## Injected heading'],
    whereThingsAre: [{ path: 'src/__tests__/bot.ts', what: 'Handlers [click](javascript:alert(1))' }],
    openWork: [
      { title: 'VAT parsed wrong', evidenceUrl: 'https://github.com/acme/app/issues/7' },
      { title: 'Phish [here](https://evil.example)', evidenceUrl: 'https://github.com.evil.example/acme/app/issues/7' },
      { title: 'Script', evidenceUrl: 'javascript:alert(1)' },
      { title: 'Other repo', evidenceUrl: 'https://github.com/someone/else/issues/1' },
      { title: 'Spaced', evidenceUrl: ' https://github.com/acme/app/pull/3 ' },
      { title: '   ' },
    ],
    risks: ['Line one\n- fake bullet'],
    contacts: ['[Maya](mailto:maya@x.test)'],
    unknowns: [],
  }
  const clean = cleanHandover(dirty, allowed)

  it('turns links and emphasis in AI text into plain text', () => {
    expect(clean.summary).toBe('Receipts bot. See the docs and read this.')
    expect(clean.whereThingsAre).toEqual([{ path: 'src/__tests__/bot.ts', what: 'Handlers click' }])
    expect(clean.contacts).toEqual(['Maya'])
  })
  it('keeps one line per item and commands as written', () => {
    expect(clean.howToRun).toEqual(["'npm run dev'", 'python src/__tests__/run.py ## Injected heading'])
    expect(clean.risks).toEqual(['Line one - fake bullet'])
  })
  it('keeps an evidenceUrl only when it is exactly a URL from the facts', () => {
    expect(clean.openWork).toEqual([
      { title: 'VAT parsed wrong', evidenceUrl: 'https://github.com/acme/app/issues/7' },
      { title: 'Phish here' },
      { title: 'Script' },
      { title: 'Other repo' },
      { title: 'Spaced', evidenceUrl: 'https://github.com/acme/app/pull/3' },
    ])
  })
  it('stays schema-valid and never leaves a link in the markdown', () => {
    expect(HandoverOut.safeParse(clean).success).toBe(true)
    expect(JSON.stringify(clean)).not.toMatch(/evil\.example|javascript:|mailto:/)
  })
  it('lists the repo, commit, PR and issue URLs as the allowed set', () => {
    expect([...allowed].sort()).toEqual(['https://github.com/acme/app', 'https://github.com/acme/app/issues/7', 'https://github.com/acme/app/pull/3'])
  })
  it('flattens links in repo-derived text for the facts-only handover', () => {
    const doc = fallbackHandover({ ...facts, pulls: [{ ...facts.pulls[0], title: 'Ship [free gift](https://evil.example)' }] }, [], 'Maya')
    expect(doc.openWork[0]).toEqual({ title: 'PR #3: Ship free gift', evidenceUrl: 'https://github.com/acme/app/pull/3' })
  })
})

describe('withDeploymentEvidence', () => {
  const base: HandoverOut = { summary: 's', howToRun: [], whereThingsAre: [], openWork: [], risks: [], contacts: [], unknowns: [] }
  it('links a plain web address and shows anything stranger as text', () => {
    expect(withDeploymentEvidence(base, { liveUrl: 'https://app.acme.test/x', deployFile: null }).whereThingsAre)
      .toEqual([{ path: 'Live app', what: '[https://app.acme.test/x](https://app.acme.test/x)' }])
    for (const liveUrl of ['https://a.test/x) [boo](https://evil.example', 'javascript:alert(1)', 'https://a.test/ b']) {
      const what = withDeploymentEvidence(base, { liveUrl, deployFile: null }).whereThingsAre[0].what
      expect(what, liveUrl).toMatch(/^`[^`]+`$/)
    }
  })
})
