import { describe, expect, it } from 'vitest'
import { CONSENT_CAN, CONSENT_CANNOT, consentErrorText, describeRedirect, isConsentPath, parseAuthorizationId, safeRedirectUrl, scopeLines, signInRedirectTo, withoutSignInError } from './oauthConsent'

describe('isConsentPath', () => {
  it('matches the consent path with or without a trailing slash', () => {
    expect(isConsentPath('/oauth/consent')).toBe(true)
    expect(isConsentPath('/oauth/consent/')).toBe(true)
  })

  it('leaves every other page to the hash router', () => {
    for (const path of ['/', '/oauth', '/oauth/consent/extra', '/oauth/consents', '/api/mcp']) expect(isConsentPath(path)).toBe(false)
  })
})

describe('parseAuthorizationId', () => {
  it('reads authorization_id', () => {
    expect(parseAuthorizationId('?authorization_id=abc-123')).toBe('abc-123')
    expect(parseAuthorizationId('?foo=1&authorization_id=7f9c2e&bar=2')).toBe('7f9c2e')
  })

  it('is null when it is missing, empty or blank', () => {
    for (const search of ['', '?', '?authorization_id=', '?authorization_id=%20%20', '?id=abc']) expect(parseAuthorizationId(search)).toBeNull()
  })

  it('refuses ids with spaces or control characters, and absurd lengths', () => {
    expect(parseAuthorizationId('?authorization_id=a%20b')).toBeNull()
    expect(parseAuthorizationId('?authorization_id=a%0Ab')).toBeNull()
    expect(parseAuthorizationId(`?authorization_id=${'a'.repeat(513)}`)).toBeNull()
    expect(parseAuthorizationId(`?authorization_id=${'a'.repeat(512)}`)).toHaveLength(512)
  })
})

describe('signInRedirectTo', () => {
  const origin = 'https://tempo.example'

  it('sends the consent page back to its full address, so the request survives sign-in', () => {
    expect(signInRedirectTo({ origin, pathname: '/oauth/consent', search: '?authorization_id=abc' })).toBe(`${origin}/oauth/consent?authorization_id=abc`)
  })

  it('sends every other sign-in to the site root, as before', () => {
    expect(signInRedirectTo({ origin, pathname: '/', search: '' })).toBe(`${origin}/`)
    expect(signInRedirectTo({ origin, pathname: '/anything', search: '?x=1' })).toBe(`${origin}/`)
  })
})

describe('withoutSignInError', () => {
  it('drops the error parts and keeps the request id', () => {
    expect(withoutSignInError('?authorization_id=abc&error=access_denied&error_code=x&error_description=nope')).toBe('?authorization_id=abc')
    expect(withoutSignInError('?error=access_denied')).toBe('')
  })
})

describe('describeRedirect', () => {
  it('shows the host of a web address, with its port', () => {
    expect(describeRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ display: 'claude.ai', local: false, insecure: false })
  })

  it('marks addresses on this computer, which desktop tools use', () => {
    expect(describeRedirect('http://localhost:54321/callback')).toEqual({ display: 'localhost:54321', local: true, insecure: false })
    expect(describeRedirect('http://127.0.0.1:8080/cb')).toMatchObject({ display: '127.0.0.1:8080', local: true, insecure: false })
    expect(describeRedirect('http://[::1]:9000/cb')).toMatchObject({ local: true })
  })

  it('flags plain http to another host', () => {
    expect(describeRedirect('http://example.com/cb')).toEqual({ display: 'example.com', local: false, insecure: true })
  })

  it('shows the host or scheme of an app link such as cursor://', () => {
    expect(describeRedirect('cursor://anysphere.cursor-mcp/oauth/callback')).toMatchObject({ display: 'anysphere.cursor-mcp' })
    expect(describeRedirect('myapp:/callback')).toMatchObject({ display: 'myapp' })
  })

  it('is null for something that is not an address', () => {
    expect(describeRedirect('')).toBeNull()
    expect(describeRedirect('not a url')).toBeNull()
  })
})

describe('safeRedirectUrl', () => {
  it('lets web, localhost and app-link addresses through', () => {
    for (const url of ['https://claude.ai/cb?code=1&state=2', 'http://localhost:1234/cb?code=1', 'cursor://x/cb?code=1']) expect(safeRedirectUrl(url)).toBe(url)
  })

  it('refuses script-like and non-address values', () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'blob:https://x/1', 'nope', '', undefined, null, 5]) {
      expect(safeRedirectUrl(url), String(url)).toBeNull()
    }
  })
})

describe('consent copy', () => {
  it('says what the client can and cannot do, in plain words', () => {
    expect(CONSENT_CAN).toEqual([
      'Read your apps, their health, owners and recent activity',
      'Write draft app cards and handover packs that a person checks before they count',
      'Add tasks for the problems Tempo flags on an app',
    ])
    expect(CONSENT_CANNOT).toEqual(["It can't change owners, members, invites, keys or settings"])
  })
})

describe('consentErrorText', () => {
  it('keeps one short line', () => {
    expect(consentErrorText('  bad \n thing ')).toBe('bad thing')
    expect(consentErrorText('x'.repeat(500))).toHaveLength(200)
    expect(consentErrorText(null)).toBe('Something went wrong.')
  })
})

describe('scopeLines', () => {
  it('says what each requested scope grants, once each', () => {
    expect(scopeLines('openid email profile email')).toEqual(['Know which Tempo account you are', 'See your email address', 'See your name and profile picture'])
  })
  it('shows an unknown scope by a clean name instead of hiding it', () => {
    expect(scopeLines('admin<script>')).toEqual(['Use the "adminscript" permission'])
    expect(scopeLines('')).toEqual([])
    expect(scopeLines(undefined)).toEqual([])
  })
})

