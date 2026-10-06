import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Link previews need absolute addresses, and each copy of Tempo has its own. Vite fills %VITE_SITE_URL% in index.html
// at build time, so the page never names one particular site.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('index.html link previews', () => {
  it('take the site address from VITE_SITE_URL', () => {
    expect(html).toContain('<meta property="og:url" content="%VITE_SITE_URL%/" />')
    expect(html).toContain('<meta property="og:image" content="%VITE_SITE_URL%/og.jpg" />')
    expect(html).toContain('<meta name="twitter:image" content="%VITE_SITE_URL%/og.jpg" />')
  })

  it('name no fixed site', () => {
    expect(html).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/)
  })
})
