import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../data/session'
import RemovedWorkspaceView from './RemovedWorkspaceView'

vi.mock('../data/session', async (original) => {
  const actual = await original<typeof import('../data/session')>()
  return { ...actual, useSession: Object.assign((selector: (state: ReturnType<typeof actual.useSession.getState>) => unknown) => selector(actual.useSession.getState()), actual.useSession) }
})

beforeEach(() => {
  useSession.setState({ removedFrom: { name: 'Halden Freight' }, needsSetup: false })
})

describe('RemovedWorkspaceView', () => {
  it('explains the removal and makes sign out the primary action', () => {
    const html = renderToStaticMarkup(createElement(RemovedWorkspaceView))

    expect(html).toContain('You were removed from Halden Freight.')
    expect(html).toContain('Ask an admin there for a new invite.')
    expect(html).toMatch(/data-variant="primary"[^>]*>Sign out/)
    expect(html).toMatch(/data-variant="ghost"[^>]*>Start my own workspace/)
  })
})
