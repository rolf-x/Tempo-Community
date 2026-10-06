import { describe, expect, it } from 'vitest'
import { contactEmail } from './contact'

describe('contactEmail', () => {
  it('uses the configured address, trimmed', () => {
    expect(contactEmail(' privacy@acme.example ')).toBe('privacy@acme.example')
  })

  it('is null when unset or not an email, so pages fall back to plain words', () => {
    for (const value of [undefined, '', '   ', 'nobody', 'a@b', 'x@y.z"><script>', 'you @acme.example']) {
      expect(contactEmail(value), String(value)).toBeNull()
    }
  })
})
