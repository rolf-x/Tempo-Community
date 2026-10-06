import { describe, expect, it } from 'vitest'
import { cleanCardDraft, cleanHandoverDraft } from './mcpDrafts'
import { handoverMarkdown } from './handoverMarkdown'

describe('edge cases - sanitising of drafts', () => {
  it('markdown links in every field', () => {
    const card = cleanCardDraft({
      what: '[Link](https://example.com)',
      who: '[Link](https://example.com)',
      stage: 'idea',
      status: '[Link](https://example.com)'
    })
    expect(card.what).not.toContain('[Link]')
    expect(card.what).not.toContain('https://example.com')
  })

  it('nested/escaped brackets, reference-style links, autolinks <https://evil>, raw HTML, javascript:/data: URLs', () => {
    const card = cleanCardDraft({
      what: '[\\[nested\\]](javascript:alert(1)) <https://evil.com> [ref][1]',
      who: '<script>alert(1)</script>',
      stage: 'idea',
      status: 'data:text/html,<html>'
    })
    expect(card.what).not.toContain('javascript:')
    expect(card.what).not.toContain('<https://evil.com>')
    expect(card.who).not.toContain('<script>')
  })

  it('backticks breaking out of code spans in howToRun/whereThingsAre.path', () => {
    const handover = cleanHandoverDraft({
      summary: 'summary',
      howToRun: ['` && rm -rf / `'],
      whereThingsAre: [{ path: 'src/`bad`', what: 'thing' }],
      openWork: [], risks: [], contacts: [], unknowns: []
    }, 'acme/repo')
    const md = handoverMarkdown(handover, 'App')
    expect(md).not.toContain('` && rm -rf / `')
  })

  it('newlines that start a heading or list item', () => {
    const handover = cleanHandoverDraft({
      summary: 'summary',
      howToRun: ['run\n# Heading'],
      whereThingsAre: [{ path: 'path', what: 'what\n- List' }],
      openWork: [], risks: [], contacts: [], unknowns: []
    }, 'acme/repo')
    const md = handoverMarkdown(handover, 'App')
    expect(md).not.toMatch(/\n# Heading/)
    expect(md).not.toMatch(/\n- List/)
  })

  it('zero-width and bidi characters', () => {
    const card = cleanCardDraft({
      what: 'hello\u200Bworld',
      who: '\u202Ereversed\u202C',
      stage: 'idea',
      status: 'status'
    })
    expect(card.what).not.toContain('\u200B')
    expect(card.who).not.toContain('\u202E')
  })

  it('look-alike GitHub URLs', () => {
    const urls = [
      'https://github.com.evil.com/acme/repo/issues/1',
      'https://attacker@github.com/acme/repo/issues/1',
      'https://github.com/acme/repo/issues/1?query=1',
      'https://github.com/acme/repo/issues/1#frag',
      'http://github.com/acme/repo/issues/1',
      'HTTPS://GITHUB.COM/acme/repo/issues/1',
      'https://github.com/acme/repo/issues/1/',
      'https://github.com/acme/repo/issues/../../evil/issues/1'
    ]
    const handover = cleanHandoverDraft({
      summary: 'summary',
      howToRun: [],
      whereThingsAre: [],
      openWork: urls.map((u, i) => ({ title: `Task ${i}`, evidenceUrl: u })),
      risks: [], contacts: [], unknowns: []
    }, 'acme/repo')
    const md = handoverMarkdown(handover, 'App')
    for (const url of urls) {
      expect(md).not.toContain(url)
    }
  })

  it('very long strings', () => {
    const longStr = 'a'.repeat(5000)
    const card = cleanCardDraft({
      what: longStr,
      who: longStr,
      stage: 'idea',
      status: longStr
    })
    expect(card.what.length).toBeLessThanOrEqual(240)
    expect(card.who.length).toBeLessThanOrEqual(160)
    expect(card.status.length).toBeLessThanOrEqual(400)
  })

  it('secrets in every field', () => {
    const card = cleanCardDraft({
      what: 'Key sk-ant-123456789012345678901234567890',
      who: 'postgres://user:pass@host',
      stage: 'idea',
      status: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIi.SflKxwRJSMe'
    })
    expect(card.what).not.toContain('sk-ant')
    expect(card.who).not.toContain('pass@')
    expect(card.status).not.toContain('eyJhbGci')
  })
})
