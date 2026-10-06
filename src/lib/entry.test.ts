import { describe, expect, it } from 'vitest'
import { authReturnHash, canEnterApp, gateRedirect, shouldWipeOnBoot } from './entry'

describe('canEnterApp', () => {
  it('lets a signed-in user in', () => {
    expect(canEnterApp({ status: 'signed-in', demo: false, onboarded: false })).toBe(true)
  })
  it('no longer lets a demo visitor in: the demo was removed', () => {
    expect(canEnterApp({ status: 'signed-out', demo: true, onboarded: true })).toBe(false)
  })
  it('keeps an old local-only browser out once sign-in exists', () => {
    expect(canEnterApp({ status: 'signed-out', demo: false, onboarded: true })).toBe(false)
  })
  it('keeps everyone out while the session is loading', () => {
    expect(canEnterApp({ status: 'loading', demo: false, onboarded: true })).toBe(false)
  })
  it('allows local guest mode only when sign-in is not configured (dev)', () => {
    expect(canEnterApp({ status: 'off', demo: false, onboarded: true })).toBe(true)
    expect(canEnterApp({ status: 'off', demo: false, onboarded: false })).toBe(false)
  })
})

describe('shouldWipeOnBoot', () => {
  it('wipes the Acme sample when a real session arrives', () => {
    expect(shouldWipeOnBoot({ hasSession: true, demo: true, hasWorkspace: false })).toBe(true)
  })
  it('wipes a team workspace copy left behind after the session expired', () => {
    expect(shouldWipeOnBoot({ hasSession: false, demo: false, hasWorkspace: true })).toBe(true)
  })
  it('wipes leftover demo data for a signed-out visitor too', () => {
    expect(shouldWipeOnBoot({ hasSession: false, demo: true, hasWorkspace: false })).toBe(true)
  })
  it('keeps a signed-in workspace', () => {
    expect(shouldWipeOnBoot({ hasSession: true, demo: false, hasWorkspace: true })).toBe(false)
  })
})

describe('gateRedirect', () => {
  const base = { entered: true, signedIn: true, needsSetup: false, hasWorkspace: true }
  it('sends a signed-in person without a workspace to setup from any app page', () => {
    expect(gateRedirect('portfolio', { ...base, needsSetup: true, hasWorkspace: false })).toBe('setup')
    expect(gateRedirect('settings', { ...base, needsSetup: true, hasWorkspace: false })).toBe('setup')
  })
  it('lets them see the public pages and join links while setting up', () => {
    expect(gateRedirect('home', { ...base, needsSetup: true, hasWorkspace: false })).toBeNull()
    expect(gateRedirect('join', { ...base, needsSetup: true, hasWorkspace: false })).toBeNull()
  })
  it('keeps setup closed once a workspace exists, or when signed out', () => {
    expect(gateRedirect('setup', base)).toBe('portfolio')
    expect(gateRedirect('setup', { entered: false, signedIn: false, needsSetup: false, hasWorkspace: false })).toBe('home')
  })
  it('sends visitors who have not entered to the homepage', () => {
    expect(gateRedirect('portfolio', { entered: false, signedIn: false, needsSetup: false, hasWorkspace: false })).toBe('home')
    expect(gateRedirect('login', { entered: false, signedIn: false, needsSetup: false, hasWorkspace: false })).toBeNull()
  })
  it('lets entered people through', () => {
    expect(gateRedirect('portfolio', base)).toBeNull()
  })
  it('keeps the 404 public, including before workspace setup', () => {
    expect(gateRedirect('notFound', { entered: false, signedIn: false, needsSetup: false, hasWorkspace: false })).toBeNull()
    expect(gateRedirect('notFound', { ...base, needsSetup: true, hasWorkspace: false })).toBeNull()
    expect(gateRedirect('notFound', base)).toBeNull()
  })
  it('keeps privacy public in every session state', () => {
    expect(gateRedirect('privacy', { entered: false, signedIn: false, needsSetup: false, hasWorkspace: false })).toBeNull()
    expect(gateRedirect('privacy', base)).toBeNull()
    expect(gateRedirect('privacy', { ...base, needsSetup: true, hasWorkspace: false })).toBeNull()
  })
  it('keeps settings open when hydration finds a workspace despite a stale setup flag', () => {
    expect(gateRedirect('settings', { ...base, needsSetup: true })).toBeNull()
    expect(gateRedirect('portfolio', { ...base, needsSetup: true })).toBeNull()
  })
})

describe('authReturnHash', () => {
  it.each(['#/portfolio', '#/today', '#/settings', '#/p/app_1/app'])('keeps an app deep link: %s', (hash) => {
    expect(authReturnHash(hash)).toBe(hash)
  })

  it.each(['', '#/', '#/login', '#/welcome', '#/setup', '#/join/token', '#//evil.example'])('drops a public or unsafe destination: %s', (hash) => {
    expect(authReturnHash(hash)).toBeNull()
  })
})
