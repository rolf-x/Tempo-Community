import { describe, expect, it } from 'vitest'
import { buildClaudeArgs, isAllowedRequest, parseBridgeRequest, parseClaudeOutput } from './claudeBridge'

const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }

describe('parseBridgeRequest', () => {
  it('accepts a valid body and defaults the model to sonnet', () => {
    const req = parseBridgeRequest({ system: 'sys', user: 'hi', schema })
    expect(req).toEqual({ system: 'sys', user: 'hi', schema, model: 'sonnet' })
  })

  it('only allows known model aliases', () => {
    expect(parseBridgeRequest({ system: 's', user: 'u', schema, model: 'haiku' }).model).toBe('haiku')
    expect(parseBridgeRequest({ system: 's', user: 'u', schema, model: 'rm -rf /' }).model).toBe('sonnet')
  })

  it('rejects missing fields and oversized input', () => {
    expect(() => parseBridgeRequest({ user: 'u', schema })).toThrow(/system/)
    expect(() => parseBridgeRequest({ system: 's', user: '', schema })).toThrow(/user/)
    expect(() => parseBridgeRequest({ system: 's', user: 'u' })).toThrow(/schema/)
    expect(() => parseBridgeRequest({ system: 's', user: 'x'.repeat(50_001), schema })).toThrow(/too long/)
  })
})

describe('buildClaudeArgs', () => {
  it('runs print mode with no tools, no MCP, no settings and the schema', () => {
    const args = buildClaudeArgs({ system: 'sys', user: 'u', schema, model: 'sonnet' })
    expect(args).toContain('-p')
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema))
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('sys')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet')
    expect(args[args.indexOf('--effort') + 1]).toBe('low')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--no-session-persistence')
    // the user text goes in on stdin, never as an argument
    expect(args).not.toContain('u')
  })
})

describe('parseClaudeOutput', () => {
  it('returns structured_output when present', () => {
    const raw = JSON.stringify({ is_error: false, structured_output: { title: 'Email Sam' }, result: '{}' })
    expect(parseClaudeOutput(raw)).toEqual({ title: 'Email Sam' })
  })

  it('falls back to JSON inside result, including fenced JSON', () => {
    const raw = JSON.stringify({ is_error: false, result: '```json\n{"title":"A"}\n```' })
    expect(parseClaudeOutput(raw)).toEqual({ title: 'A' })
  })

  it('throws on CLI errors and unparseable output', () => {
    expect(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: 'Not logged in' }))).toThrow(/Not logged in/)
    expect(() => parseClaudeOutput('not json')).toThrow(/unreadable/)
    expect(() => parseClaudeOutput(JSON.stringify({ is_error: false, result: 'sorry' }))).toThrow(/no JSON/)
  })
})

describe('isAllowedRequest (other websites must not reach the dev bridge)', () => {
  const json = 'application/json'
  it('allows same-origin JSON from localhost', () => {
    expect(isAllowedRequest({ 'content-type': json, origin: 'http://localhost:5180' })).toBe(true)
    expect(isAllowedRequest({ 'content-type': 'application/json; charset=utf-8' })).toBe(true) // no Origin = curl / same-origin GET-less tools
    expect(isAllowedRequest({ 'content-type': json, origin: 'http://127.0.0.1:5173' })).toBe(true)
  })
  it('rejects other origins and non-JSON bodies (simple CORS requests)', () => {
    expect(isAllowedRequest({ 'content-type': json, origin: 'https://evil.example' })).toBe(false)
    expect(isAllowedRequest({ 'content-type': 'text/plain', origin: 'http://localhost:5180' })).toBe(false)
    expect(isAllowedRequest({ origin: 'http://localhost:5180' })).toBe(false)
    expect(isAllowedRequest({ 'content-type': json, origin: 'http://localhost.evil.example' })).toBe(false)
  })
})
