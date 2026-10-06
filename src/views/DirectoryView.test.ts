import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../lib/model'
import { useStore } from '../store/useStore'
import type { Member, Project } from '../types'
import DirectoryView, { accessExplanation, sendByEmailExplanation } from './DirectoryView'

vi.mock('../store/useStore', async (original) => {
  const actual = await original<typeof import('../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})

const project = (id: string, liveUrl: string | null, what = 'An app'): Project => ({
  id, name: `App ${id}`, emoji: '📁', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00.000Z', archived: false,
  ...appDefaults(), liveUrl, appCard: { what, who: 'The team', stage: 'live', status: '', updatedAt: '2026-10-01T00:00:00.000Z', source: 'fallback' },
})

beforeEach(() => useStore.setState({ projects: [], members: [] }))

describe('DirectoryView', () => {
  it('uses the full app count and explains when none can open', () => {
    useStore.setState({ projects: [project('1', null), project('2', null), project('3', null), project('4', null)] })
    const html = renderToStaticMarkup(createElement(DirectoryView))
    expect(html).toContain('4 apps · add an app link to open them from here')
  })

  it('counts openable apps and renders card copy as plain text', () => {
    useStore.setState({ projects: [project('1', 'https://example.com', '**Know every app**'), project('2', null)] })
    const html = renderToStaticMarkup(createElement(DirectoryView))
    expect(html).toContain('2 apps · 1 you can open')
    expect(html).toContain('Know every app')
    expect(html).not.toContain('**Know every app**')
  })

  it('explains the access request and does not ask the owner to request from themselves', () => {
    const owner: Member = { id: 'owner', name: 'Maya', email: 'maya@example.com', avatarUrl: null, githubLogin: 'maya', userId: 'user', role: 'member', active: true }
    useStore.setState({ projects: [{ ...project('1', 'https://example.com'), ownerId: owner.id }], members: [owner], meId: 'someone-else' })
    let html = renderToStaticMarkup(createElement(DirectoryView))
    expect(html).toContain('Ask for access')
    expect(accessExplanation('Maya', 'App 1')).toBe("This asks Maya. They'll see a request for App 1 with its link; Tempo sends nothing itself.")
    expect(sendByEmailExplanation).toBe('Send by email opens your own mail app.')
    useStore.setState({ meId: owner.id })
    html = renderToStaticMarkup(createElement(DirectoryView))
    expect(html).not.toContain('Ask for access')
  })
})
