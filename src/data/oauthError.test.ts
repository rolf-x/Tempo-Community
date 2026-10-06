import { describe, expect, it } from 'vitest'
import { oauthErrorFrom } from './oauthError'

describe('oauthErrorFrom', () => {
  it('returns null when the URL has no OAuth error', () => {
    expect(oauthErrorFrom('')).toBeNull()
    expect(oauthErrorFrom('?code=abc')).toBeNull()
  })
  it('explains an expired sign-in', () => {
    expect(oauthErrorFrom('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired')).toBe(
      'That sign-in took too long and expired. Try again.',
    )
  })
  it('explains a cancelled sign-in', () => {
    expect(oauthErrorFrom('?error=access_denied&error_description=The+user+denied+the+request')).toBe('Sign-in was cancelled.')
  })
  it('names a standard OAuth error code but never echoes the description', () => {
    expect(oauthErrorFrom('?error=server_error&error_description=Something+broke')).toBe('Sign-in failed (server_error). Try again.')
  })
  it('shows only fixed text for an unknown or attacker-supplied error', () => {
    const attack = '?error=Your+account+is+locked.+Call+555-0100&error_description=Visit+https://evil.example+to+unlock'
    expect(oauthErrorFrom(attack)).toBe('Sign-in failed. Try again.')
    expect(oauthErrorFrom('?error=server_error&error_code=x&error_description=Visit+https://evil.example')).not.toContain('evil')
  })
})
