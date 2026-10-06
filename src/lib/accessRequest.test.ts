import { describe, expect, it } from 'vitest'
import { accessRequest } from './accessRequest'

describe('accessRequest', () => {
  it('writes the email and chat message from the supplied facts', () => {
    const request = accessRequest({
      appName: 'Expense bot',
      appUrl: 'https://apps.example.com/expenses',
      ownerName: 'Maya Chen',
      ownerEmail: 'maya@example.com',
    })

    expect(request.subject).toBe('Access to Expense bot')
    expect(request.emailBody).toBe('Hi Maya Chen,\n\nCould I get access to Expense bot?\nhttps://apps.example.com/expenses')
    expect(request.message).toBe('Hi Maya Chen, could I get access to Expense bot? https://apps.example.com/expenses')
    expect(request.mailtoUrl).toBe(
      'mailto:maya%40example.com?subject=Access%20to%20Expense%20bot&body=Hi%20Maya%20Chen%2C%0A%0ACould%20I%20get%20access%20to%20Expense%20bot%3F%0Ahttps%3A%2F%2Fapps.example.com%2Fexpenses',
    )
  })

  it('opens a blank recipient when the owner has no known email', () => {
    expect(accessRequest({ appName: 'Desk booking', appUrl: 'https://desk.example.com', ownerName: 'Sam' }).mailtoUrl)
      .toMatch(/^mailto:\?subject=/)
  })

  it('keeps the mailto below 2,000 characters', () => {
    const request = accessRequest({
      appName: `App ${'name '.repeat(100)}`,
      appUrl: `https://example.com/access?token=${'x'.repeat(3_000)}`,
      ownerName: `Owner ${'name '.repeat(100)}`,
      ownerEmail: 'owner@example.com',
    })
    expect(request.mailtoUrl.length).toBeLessThan(2_000)
  })

  it('keeps an encoded unicode mailto below 2,000 characters', () => {
    const request = accessRequest({
      appName: '🟣'.repeat(300),
      appUrl: `https://example.com/${'🟣'.repeat(300)}`,
      ownerName: 'Maya',
      ownerEmail: 'maya@example.com',
    })
    expect(request.mailtoUrl.length).toBeLessThan(2_000)
  })

  it('removes line breaks from header fields and chat text', () => {
    const request = accessRequest({ appName: 'App\nBcc: x', appUrl: 'https://example.com', ownerName: 'Maya\r\nChen', ownerEmail: null })
    expect(request.subject).toBe('Access to App Bcc: x')
    expect(request.message).toBe('Hi Maya Chen, could I get access to App Bcc: x? https://example.com')
  })
})
