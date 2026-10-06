import { describe, expect, it } from 'vitest'
import { isGitHubPopup } from './githubPopup'

describe('GitHub popup boot', () => {
  it('selects popup mode instead of the app', () => {
    expect(isGitHubPopup('?github_popup=1&code=abc')).toBe(true)
    expect(isGitHubPopup('?code=abc')).toBe(false)
  })
})
