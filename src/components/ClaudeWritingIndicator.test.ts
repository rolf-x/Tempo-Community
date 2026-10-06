import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClaudeWriting } from '../data/claudeWriting'
import { useUI } from './uiState'
import { ClaudeWritingIndicator, copyMessageAgain } from './ClaudeWritingIndicator'

// The server render reads a store's initial state, so read the live one instead (as PendingSaveIndicator's test does).
vi.mock('../data/claudeWriting', async (original) => {
  const actual = await original<typeof import('../data/claudeWriting')>()
  return { ...actual, useClaudeWriting: Object.assign((selector: (state: ReturnType<typeof actual.useClaudeWriting.getState>) => unknown) => selector(actual.useClaudeWriting.getState()), actual.useClaudeWriting) }
})

const show = (patch: Partial<ReturnType<typeof useClaudeWriting.getState>>) => {
  useClaudeWriting.setState({ workspaceId: 'w', startedAt: 1, prompt: 'Use Tempo to draft the cards.', expected: ['a', 'b', 'c', 'd', 'e'], arrived: [], lastArrivalAt: null, phase: 'waiting', ...patch })
  return renderToStaticMarkup(createElement(ClaudeWritingIndicator))
}

afterEach(() => {
  useClaudeWriting.setState({ workspaceId: null, startedAt: null, prompt: '', expected: [], arrived: [], lastArrivalAt: null, phase: null })
  useUI.setState({ toast: null })
  vi.unstubAllGlobals()
})

describe('ClaudeWritingIndicator', () => {
  it('shows nothing unless Tempo is waiting on Claude', () => {
    expect(show({ phase: null })).toBe('')
  })

  it('is a polite status', () => {
    const html = show({ phase: 'waiting' })
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  it('says it is waiting, and what to do', () => {
    const html = show({ phase: 'waiting' })
    expect(html).toContain('Waiting for Claude…')
    expect(html).toContain('Send Claude the message to start')
    expect(html).toContain('animate-spin')
    expect(html).toContain('motion-reduce:animate-none')
    expect(html).not.toContain('Review')
  })

  it('counts the descriptions and links to Review once one has arrived', () => {
    expect(show({ phase: 'writing', arrived: ['a', 'b'], lastArrivalAt: 2 })).toMatch(/Claude is writing descriptions · 2 of 5.*<a href="#\/review"[^>]*>Review<\/a>/)
  })

  it('offers to copy the message again, or to stop waiting, when nothing has come', () => {
    const html = show({ phase: 'stalled' })
    expect(html).toContain('Nothing from Claude yet')
    expect(html).toContain('Copy message again')
    expect(html).toContain('Stop waiting')
    expect(html).not.toContain('animate-spin')
  })

  it("offers to connect Claude again while waiting, since Tempo can't see Tempo removed inside Claude", () => {
    for (const phase of ['waiting', 'stalled'] as const) expect(show({ phase })).toContain('Claude can&#x27;t find Tempo?')
    expect(show({ phase: 'writing', arrived: ['a'], lastArrivalAt: 2 })).not.toContain('find Tempo')
  })

  it('sits above the toasts and the changes-waiting notice, and lets clicks through around the pill', () => {
    const html = show({ phase: 'waiting' })
    expect(html).toContain('bottom-[7.5rem]')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('pointer-events-auto')
    expect(html).toContain('max-w-full')
  })
})

describe('copyMessageAgain', () => {
  it('copies the message and says so', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyMessageAgain('Use Tempo to draft the cards.')
    expect(writeText).toHaveBeenCalledWith('Use Tempo to draft the cards.')
    expect(useUI.getState().toast).toMatchObject({ message: 'Copied', tone: 'success' })
  })

  it('says so when the browser will not copy', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    await copyMessageAgain('x')
    expect(useUI.getState().toast?.tone).toBe('danger')
  })
})
