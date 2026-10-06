import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../data/session'
import { pendingSaveCopy, PendingSaveIndicator } from './PendingSaveIndicator'

vi.mock('../data/session', async (original) => {
  const actual = await original<typeof import('../data/session')>()
  return { ...actual, useSession: Object.assign((selector: (state: ReturnType<typeof actual.useSession.getState>) => unknown) => selector(actual.useSession.getState()), actual.useSession) }
})

afterEach(() => useSession.setState({ status: 'off', pendingSave: false }))

describe('PendingSaveIndicator', () => {
  it('distinguishes offline saves from retryable online failures', () => {
    expect(pendingSaveCopy(false)).toBe('Offline · changes waiting')
    expect(pendingSaveCopy(true)).toBe('Saving again · changes waiting')
  })

  it('stays visible while a signed-in save is waiting', () => {
    useSession.setState({ status: 'signed-in', pendingSave: true })
    expect(renderToStaticMarkup(createElement(PendingSaveIndicator))).toContain('Offline · changes waiting')
  })

  it('is hidden when there is no signed-in queue', () => {
    useSession.setState({ status: 'signed-in', pendingSave: false })
    expect(renderToStaticMarkup(createElement(PendingSaveIndicator))).toBe('')
    useSession.setState({ status: 'signed-out', pendingSave: true })
    expect(renderToStaticMarkup(createElement(PendingSaveIndicator))).toBe('')
  })
})
