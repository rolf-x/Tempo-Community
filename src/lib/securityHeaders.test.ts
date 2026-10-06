import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The page's security headers live in vercel.json. The CSP allows index.html's inline <script> by hash, so editing that
// script without updating the hash would silently stop it running in production. These tests make that fail here instead.

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
const html = read('index.html')

interface HeaderRule { source: string; headers: { key: string; value: string }[]; has?: unknown[]; missing?: { type: string; key: string }[] }
const rules = (JSON.parse(read('vercel.json')) as { headers: HeaderRule[] }).headers
const catchAll = rules.filter((rule) => rule.source === '/(.*)')
const header = (key: string) => catchAll.flatMap((rule) => rule.headers).find((h) => h.key.toLowerCase() === key.toLowerCase())?.value

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/** Inline classic scripts: the ones a CSP has to allow by hash. JSON data blocks are not executed. */
function inlineScripts(source: string): string[] {
  const found: string[] = []
  for (const [, attrs, body] of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attrs)) continue
    if (/\btype\s*=\s*["']?(?:application\/(?:ld\+)?json|importmap|speculationrules)/i.test(attrs)) continue
    found.push(body)
  }
  return found
}

const directive = (csp: string, name: string): string[] =>
  (csp.split(';').map((part) => part.trim().split(/\s+/)).find(([n]) => n === name) ?? []).slice(1)

describe('Content-Security-Policy', () => {
  const csp = header('Content-Security-Policy') ?? ''

  it('is sent on every page', () => {
    expect(csp).not.toBe('')
  })

  it('allows every inline script in index.html by hash, and no hash that matches nothing', () => {
    const scripts = inlineScripts(html)
    expect(scripts.length).toBeGreaterThan(0)
    const allowed = directive(csp, 'script-src')
    for (const script of scripts) {
      expect(allowed, `inline script starting "${script.trim().slice(0, 60)}" has no matching sha256 in script-src (vercel.json)`).toContain(sha256(script))
    }
    const hashes = allowed.filter((source) => source.startsWith("'sha256-"))
    expect(hashes.sort()).toEqual(scripts.map(sha256).sort())
  })

  it('keeps script-src strict', () => {
    const scripts = directive(csp, 'script-src')
    expect(scripts[0]).toBe("'self'")
    for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'data:', 'blob:']) expect(scripts).not.toContain(unsafe)
  })

  it('has no inline event handlers or javascript: URLs that the CSP would block', () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('locks down plugins, base tags, framing and form targets', () => {
    expect(directive(csp, 'object-src')).toEqual(["'none'"])
    expect(directive(csp, 'base-uri')).toEqual(["'none'"])
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"])
    expect(directive(csp, 'form-action')).toEqual(["'self'"])
    expect(directive(csp, 'default-src')).toEqual(["'self'"])
  })

  it('lets people point the AI at any https endpoint or a local model, and reach Supabase realtime', () => {
    const connect = directive(csp, 'connect-src')
    for (const source of ["'self'", 'https:', 'wss://*.supabase.co', 'http://localhost:*', 'http://127.0.0.1:*']) expect(connect).toContain(source)
  })

  it('allows the third-party hosts index.html loads', () => {
    const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(https:\/\/[^"]+)"[^>]*>/gis)].map(([, href]) => new URL(href).origin)
    expect(stylesheets.length).toBeGreaterThan(0)
    for (const origin of stylesheets) expect(directive(csp, 'style-src'), `${origin} is loaded by index.html but missing from style-src`).toContain(origin)
    // Fonts those stylesheets pull in, and the GitHub avatars shown next to people.
    expect(directive(csp, 'font-src')).toEqual(expect.arrayContaining(['https://fonts.gstatic.com', 'https://cdn.jsdelivr.net']))
    expect(directive(csp, 'img-src')).toContain('https://avatars.githubusercontent.com')
  })
})

describe('index.html third-party stylesheet', () => {
  it('pins the jsDelivr font to an exact version with an integrity hash', () => {
    const tag = html.match(/<link\b[^>]*cdn\.jsdelivr\.net[^>]*>/is)?.[0] ?? ''
    expect(tag).toMatch(/inter-ui@\d+\.\d+\.\d+\//)
    expect(tag).toMatch(/integrity="sha384-[A-Za-z0-9+/]{64}"/)
    expect(tag).toMatch(/crossorigin="anonymous"/)
  })
})

describe('Other security headers', () => {
  it('sends HSTS for two years including subdomains', () => {
    expect(header('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains')
  })

  it('keeps sign-in popups working: same-origin-allow-popups, never on the popup callback page', () => {
    const coop = catchAll.filter((rule) => rule.headers.some((h) => h.key === 'Cross-Origin-Opener-Policy'))
    expect(coop).toHaveLength(1)
    expect(coop[0].headers).toEqual([{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' }])
    // The GitHub connect popup returns to /?github_popup=1; the opener polls popup.closed, which a COOP switch would break.
    expect(coop[0].missing).toEqual([{ type: 'query', key: 'github_popup' }])
  })

  it('keeps the existing headers', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('Referrer-Policy')).toBe('no-referrer')
  })
})
