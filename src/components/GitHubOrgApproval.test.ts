import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_ORG_APPROVAL_DOCS_URL, GITHUB_ORG_APPROVAL_URL, githubOrgApprovalUrl, GitHubAppInstallActions, GitHubOrgApproval } from './GitHubOrgApproval'

describe('GitHubOrgApproval', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('links to the approval action and keeps the guidance secondary', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', '')
    const html = renderToStaticMarkup(createElement(GitHubOrgApproval))
    expect(html).toContain("Don&#x27;t see your organisation?")
    expect(html).toContain('An organisation owner has to approve Tempo.')
    expect(html).toContain(`href="${GITHUB_ORG_APPROVAL_URL}"`)
    expect(html).toContain(`href="${GITHUB_ORG_APPROVAL_DOCS_URL}"`)
    expect(html).toContain('How this works')
  })

  it('links to GitHub App installation in app mode', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    const html = renderToStaticMarkup(createElement(GitHubOrgApproval))
    expect(html).toContain("Don&#x27;t see an account or organisation?")
    expect(html).toContain('Install Tempo on it')
    expect(html).toContain('An organisation owner has to approve the install.')
    expect(html).toContain('href="https://github.com/apps/tempo-acme-staging/installations/new"')
    expect(html).not.toContain('target="_blank"')
    expect(html).not.toContain('rel="noreferrer"')
    expect(html).not.toContain('Check GitHub approval')
  })

  it('keeps the primary GitHub App install action in the Tempo tab', () => {
    vi.stubEnv('VITE_GITHUB_APP_SLUG', 'tempo-acme-staging')
    const html = renderToStaticMarkup(createElement(GitHubAppInstallActions, { onRefresh: vi.fn() }))
    expect(html).toContain('href="https://github.com/apps/tempo-acme-staging/installations/new"')
    expect(html).not.toContain('target="_blank"')
    expect(html).not.toContain('rel="noreferrer"')
  })

  it('opens this OAuth app directly when its client id is configured', () => {
    expect(githubOrgApprovalUrl()).toBe('https://github.com/settings/applications')
    expect(githubOrgApprovalUrl('client/id')).toBe('https://github.com/settings/connections/applications/client%2Fid')
  })
})
