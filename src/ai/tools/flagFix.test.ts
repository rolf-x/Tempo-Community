import { describe, expect, it } from 'vitest'
import { flagFixHeading, githubSettingsUrl, noRepoFixText, ownerFixText, publicRepoFixText, readmeDraft, repoFileUrl, secretCommitUrl, secretFixText, staleFixText } from './flagFix'

const signals = {
  hasReadme: false,
  secretFiles: ['.env'],
  lastCommitAt: '2026-10-01T12:00:00.000Z',
  openIssues: 2,
  openPrs: 1,
  syncedAt: '2026-10-04T12:00:00.000Z',
  liveUrl: 'https://app.example.com',
}

describe('flag fix copy', () => {
  it('gives every flag a short heading and direct next step', () => {
    expect(flagFixHeading('secrets')).toBe('Remove the secret file')
    expect(secretFixText(['.env'])).toBe('1 secret file found. Rotate the key, remove the file. Tempo checks again on the next sync.')
    expect(publicRepoFixText()).toContain('Make the repo private')
    expect(staleFixText()).toContain('Archive')
    expect(ownerFixText('no-owner')).toContain('Pick the person')
    expect(ownerFixText('owner-left')).toContain('handover pack')
    expect(noRepoFixText()).toContain('Connect the GitHub repo')
  })

  it('builds safe GitHub file and settings links', () => {
    expect(githubSettingsUrl('acme/route planner')).toBe('https://github.com/acme/route%20planner/settings')
    expect(githubSettingsUrl('not-a-full-name')).toBeNull()
    expect(repoFileUrl('https://github.com/acme/app', 'main', 'config/key file.pem')).toBe('https://github.com/acme/app/blob/main/config/key%20file.pem')
    expect(repoFileUrl('https://example.com/acme/app', 'main', '.env')).toBeNull()
  })

  it('links a commit only when its title names a flagged file', () => {
    const commits = [
      { title: 'docs: update setup', url: 'https://github.com/acme/app/commit/1' },
      { title: 'remove config/key.pem', url: 'https://github.com/acme/app/commit/2' },
    ]
    expect(secretCommitUrl(['config/key.pem'], commits)).toBe('https://github.com/acme/app/commit/2')
    expect(secretCommitUrl(['.env'], commits)).toBeNull()
  })
})

describe('readmeDraft', () => {
  const input = { projectName: 'Route planner', description: 'Plans depot routes.', repoFullName: 'acme/routes', repoUrl: 'https://github.com/acme/routes', signals }

  it('uses repo facts only when AI is not connected', () => {
    const draft = readmeDraft(input)
    expect(draft.source).toBe('facts')
    expect(draft.markdown).toContain('Plans depot routes.')
    expect(draft.markdown).toContain('Last commit: 1 Oct 2026')
    expect(draft.markdown).not.toContain('2026-10-01T12:00:00.000Z')
    expect(draft.markdown).toContain('Open issues: 2')
    expect(draft.markdown).toContain('Not stated in the repo.')
  })

  it('uses an existing AI-written card only when AI is connected', () => {
    const appCard = { what: 'Routes deliveries.', who: 'Dispatch team.', status: 'Live.', stage: 'live' as const, updatedAt: signals.syncedAt, source: 'ai' as const }
    expect(readmeDraft({ ...input, appCard, aiConnected: false }).markdown).not.toContain('Dispatch team.')
    const draft = readmeDraft({ ...input, appCard, aiConnected: true })
    expect(draft.source).toBe('ai')
    expect(draft.markdown).toContain('Dispatch team.')
    expect(draft.markdown).toContain('Live URL: https://app.example.com')
  })
})
