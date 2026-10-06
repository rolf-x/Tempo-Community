import { describe, expect, it } from 'vitest'
import { explainAIError } from './errors'

describe('explainAIError', () => {
  it.each([
    ["The AI answer didn't match the expected shape (card.what: Invalid input: expected string)", 'format Tempo could not use'],
    ['could not start claude: spawn claude ENOENT', 'local AI bridge is unavailable'],
    ['TypeError: fetch failed to localhost:5173/api/claude', 'local AI bridge is unavailable'],
    ['connect ECONNREFUSED 127.0.0.1:5173', 'local AI bridge is unavailable'],
    ['claude -p timed out', 'took too long'],
    ['HTTP 401 Unauthorized', 'rejected the API key'],
    ['Provider returned 403', 'rejected the API key'],
    ['HTTP 429 Too Many Requests', 'rate-limiting requests'],
  ])('maps %s', (raw, expected) => {
    const copy = explainAIError(raw)
    expect(copy.message).toContain(expected)
    expect(copy.message).toMatch(/[.!?]$/)
    expect(copy.details).toBe(raw)
  })

  it('uses provider context for a browser fetch failure from the local bridge', () => {
    expect(explainAIError(new TypeError('Failed to fetch'), 'local')).toMatchObject({
      message: expect.stringContaining('local AI bridge'),
      details: 'Failed to fetch',
    })
  })

  it('does not expose an unknown diagnostic as the visible message', () => {
    const copy = explainAIError('Unexpected token at worker.js:42')
    expect(copy.message).toBe('The AI request failed; try again or check the connection in Settings.')
    expect(copy.details).toBe('Unexpected token at worker.js:42')
  })
})
