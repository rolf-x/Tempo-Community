import { afterEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_APP_MISSING, githubAppInstallUrl, githubAppMode, githubAppSlug, githubSignInPlan } from './githubApp'

afterEach(() => vi.unstubAllEnvs())

describe('GitHub App mode', () => {
  it('is off for an unset or empty slug', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    expect(githubAppSlug()).toBe('')
    expect(githubAppMode()).toBe(false)
  })

  it('trims the slug and builds the installation URL', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', ' tempo-acme-staging ')
    expect(githubAppSlug()).toBe('tempo-acme-staging')
    expect(githubAppMode()).toBe(true)
    expect(githubAppInstallUrl()).toBe('https://github.com/apps/tempo-acme-staging/installations/new')
  })
})

describe('GitHub sign-in scopes', () => {
  it('asks for no scopes when the GitHub App is configured, in production too', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    expect(githubSignInPlan()).toEqual({ ok: true })
    vi.stubEnv('PROD', true)
    expect(githubSignInPlan()).toEqual({ ok: true })
  })

  it('falls back to the broad OAuth scopes in a dev build only', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    vi.stubEnv('PROD', false)
    expect(githubSignInPlan()).toEqual({ ok: true, scopes: 'repo read:user user:email read:org' })
  })

  it('fails closed in production when the GitHub App slug is missing', () => {
    vi.stubEnv('PROD', true)
    for (const slug of ['', '   ']) {
      vi.stubEnv('VITE_GITHUB_APP_SLUG', slug)
      expect(githubSignInPlan()).toEqual({ ok: false, error: GITHUB_APP_MISSING })
    }
  })
})
