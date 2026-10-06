import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import PrivacyView from './PrivacyView'
import { aiMode } from '../lib/aiMode'

const page = () => renderToStaticMarkup(createElement(PrivacyView)).replace(/&#x27;/g, "'").replace(/&gt;/g, '>')

describe('Privacy page', () => {
  it('explains updates on every push in plain words', () => {
    const html = page()

    expect(html).toContain('Updates on every push')
    expect(html).toContain("When someone pushes to a repo that's in a linked workspace, GitHub tells Tempo, and Tempo's server checks that repo with Tempo's own read-only GitHub App.")
    expect(html).toContain('It looks only at file names, dates and counts, and never opens a file, not even the README.')
    expect(html).toContain("the names of committed secret files, when the last commit was, how many pull requests and issues are open, and the live link")
    expect(html).toContain('It never reads or stores code, and no AI runs.')
    expect(html).toContain('Only an owner or admin can turn it on.')
    expect(html).toContain("Installing or removing Tempo's GitHub App on GitHub controls it.")
  })

  it('says when a sign-in ends (migration 0023)', () => {
    expect(page()).toContain('Your sign-in. It ends after 14 days without using Tempo, and 30 days after you signed in at the latest. Then you sign in with GitHub again. The same limits apply to a connected AI app.')
  })

  it('says the message for Claude is kept briefly while connecting (not in legacy mode, which has no Claude window)', () => {
    const line = 'While you connect Claude, the message to send it (your workspace and app names), for up to 30 minutes, so Allow can copy it for you.'
    if (aiMode() === 'legacy') expect(page()).not.toContain(line)
    else expect(page()).toContain(line)
  })

  it('gives the contact email this Tempo is built with, or plain words without one', () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', 'privacy@acme.example')
    expect(page()).toContain('To delete your account or a workspace, email <a href="mailto:privacy@acme.example"')
    vi.stubEnv('VITE_CONTACT_EMAIL', '')
    expect(page()).toContain('To delete your account or a workspace, ask the person who runs this Tempo.')
    expect(page()).not.toContain('mailto:')
    vi.unstubAllEnvs()
  })

  it('keeps the other sections and the date', () => {
    const html = page()

    expect(html).toContain('Last updated 6 October 2026.')
    for (const title of ["Stored in Tempo's database (Supabase)", 'Kept only in this browser', 'GitHub access', 'Services involved', 'Your data']) {
      expect(html).toContain(title)
    }
    expect(html.indexOf('GitHub access')).toBeLessThan(html.indexOf('Updates on every push'))
    expect(html.indexOf('Updates on every push')).toBeLessThan(html.indexOf('Services involved'))
  })
})
