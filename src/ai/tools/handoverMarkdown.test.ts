import { describe, expect, it } from 'vitest'
import { handoverMarkdown, isEvidenceUrl } from './handoverMarkdown'
import type { HandoverOut } from '../schemas'

const doc: HandoverOut = {
  summary: 'Slack bot that files receipts.',
  howToRun: ['npm install', 'npm run dev'],
  whereThingsAre: [{ path: 'src/bot.ts', what: 'Slack handlers' }],
  openWork: [{ title: 'VAT parsed wrong', evidenceUrl: 'https://github.com/acme/app/issues/7' }, { title: 'Weekly summary' }],
  risks: ['Secret file committed: .env'],
  contacts: [],
  unknowns: ['Unknown — ask Maya: who owns the Slack app'],
}

describe('handoverMarkdown', () => {
  const md = handoverMarkdown(doc, 'Expense bot')
  it('titles the doc and has a heading per section', () => {
    expect(md.startsWith('# Handover: Expense bot\n')).toBe(true)
    for (const h of ['## Summary', '## How to run', '## Where things are', '## Open work', '## Risks', '## Contacts', '## Unknowns']) expect(md).toContain(h)
  })
  it('renders lists, code paths and links', () => {
    expect(md).toContain('- `npm run dev`')
    expect(md).toContain('- `src/bot.ts`: Slack handlers')
    expect(md).toContain('- [VAT parsed wrong](https://github.com/acme/app/issues/7)')
    expect(md).toContain('- Weekly summary\n')
  })
  it('says so when a section is empty instead of dropping it', () => {
    expect(md).toMatch(/## Contacts\n\nNone found in the repo\./)
  })
  it('ends with a single newline', () => {
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })
})

describe('handoverMarkdown links', () => {
  const withWork = (openWork: HandoverOut['openWork']) => handoverMarkdown({ ...doc, openWork }, 'App')
  it('writes a link only for a github.com https address', () => {
    expect(isEvidenceUrl('https://github.com/acme/app/pull/3')).toBe(true)
    for (const url of ['http://github.com/acme/app', 'https://evil.example/x', 'https://github.com.evil.example/x', 'https://user:pw@github.com/x', 'javascript:alert(1)', 'https://github.com/a b', 'https://github.com/a)b', 'not a url', '']) {
      expect(isEvidenceUrl(url), url).toBe(false)
    }
  })
  it('shows the title as text when the URL is not allowed', () => {
    const md = withWork([{ title: 'Phish', evidenceUrl: 'https://evil.example/x' }, { title: 'Script', evidenceUrl: 'javascript:alert(1)' }])
    expect(md).toContain('- Phish\n')
    expect(md).toContain('- Script\n')
    expect(md).not.toMatch(/evil\.example|javascript:/)
  })
  it('keeps brackets in a title from closing the link early', () => {
    expect(withWork([{ title: 'Fix [urgent] bug', evidenceUrl: 'https://github.com/acme/app/issues/9' }])).toContain('- [Fix urgent bug](https://github.com/acme/app/issues/9)')
  })
  it('keeps a line break in an item from starting a heading', () => {
    const md = handoverMarkdown({ ...doc, risks: ['one\n## Fake heading'] }, 'App')
    expect(md).toContain('- one ## Fake heading')
    expect(md.match(/^## /gm)).toHaveLength(7)
  })
})
