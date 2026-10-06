import { describe, expect, it } from 'vitest'
import { safeRedirectUrl, parseAuthorizationId } from './oauthConsent'

describe('edge cases - consent page helpers', () => {
  it('safeRedirectUrl blocks JAVASCRIPT:', () => {
    expect(safeRedirectUrl('JAVASCRIPT:alert(1)')).toBeNull()
  })
  it('safeRedirectUrl blocks leading spaces before scheme', () => {
    expect(safeRedirectUrl(' javascript:alert(1)')).toBeNull()
  })
  it('safeRedirectUrl blocks tabs in scheme', () => {
    expect(safeRedirectUrl('java\tscript:alert(1)')).toBeNull()
  })
  it('safeRedirectUrl blocks encoded characters in scheme', () => {
    expect(safeRedirectUrl('jav&#x61;script:alert(1)')).toBeNull()
  })
  it('safeRedirectUrl blocks obfuscated schemes', () => {
    expect(safeRedirectUrl('data:text/html,<script>')).toBeNull()
    expect(safeRedirectUrl('vbscript:alert(1)')).toBeNull()
  })
  it('safeRedirectUrl handles relative URLs by rejecting or throwing', () => {
    expect(safeRedirectUrl('/relative/path')).toBeNull()
  })

  it('parseAuthorizationId rejects unicode', () => {
    expect(parseAuthorizationId('?authorization_id=abc🌟')).toBeNull()
  })
  it('parseAuthorizationId rejects very long ids', () => {
    expect(parseAuthorizationId('?authorization_id=' + 'a'.repeat(513))).toBeNull()
  })
  it('parseAuthorizationId rejects encoded newlines', () => {
    expect(parseAuthorizationId('?authorization_id=abc%0Adef')).toBeNull()
  })
})
