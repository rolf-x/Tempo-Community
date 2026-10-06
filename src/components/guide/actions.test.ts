import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUI } from '../uiState'
import { followGuide, guideHref } from './actions'

beforeEach(() => {
  vi.stubGlobal('window', { location: { hash: '#/portfolio' } })
  useUI.setState({ sidebarOpen: true, repoPickerOpen: false, assignOwnersOpen: false })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('opens the affected app for the fix', () => {
  expect(guideHref({ kind: 'app', projectId: 'secret' })).toBe('#/p/secret/app')
  followGuide({ kind: 'app', projectId: 'secret' })
  expect(window.location.hash).toBe('#/p/secret/app')
  expect(useUI.getState().sidebarOpen).toBe(false)
})
it('keeps a link to the first unowned app for opening in a new tab', () => {
  expect(guideHref({ kind: 'owners', projectId: 'unowned' })).toBe('#/p/unowned/app')
  expect(guideHref({ kind: 'owners', projectId: null })).toBe('#/portfolio')
})
it.each([{ kind: 'owners', projectId: 'first' }, { kind: 'owners', projectId: null }] as const)('opens the Assign owners window for owners (%o), wherever it is followed from', (action) => {
  followGuide(action)
  expect(useUI.getState().assignOwnersOpen).toBe(true)
  expect(useUI.getState().anyModalOpen()).toBe(true)
  expect(useUI.getState().sidebarOpen).toBe(false)
  // No page change and no portfolio filter: the window is the whole job.
  expect(window.location.hash).toBe('#/portfolio')
})
it('closes the other windows when Assign owners opens, and is closed by closeAll', () => {
  useUI.setState({ repoPickerOpen: true })
  followGuide({ kind: 'owners', projectId: null })
  expect(useUI.getState().repoPickerOpen).toBe(false)
  useUI.getState().closeAll()
  expect(useUI.getState().assignOwnersOpen).toBe(false)
})
it('opens the repo picker for finding apps', () => {
  followGuide({ kind: 'apps' })
  expect(useUI.getState().repoPickerOpen).toBe(true)
  expect(window.location.hash).toBe('#/portfolio')
})
it('opens the card review queue', () => {
  followGuide({ kind: 'review' })
  expect(window.location.hash).toBe('#/review')
})
it('opens the Pick your AI panel in place for ai, where Claude is not offered (legacy)', () => {
  vi.stubEnv('VITE_AI_MODE', 'legacy')
  useUI.setState({ aiPanelOpen: false, claudeWindow: null })
  followGuide({ kind: 'ai' })
  expect(useUI.getState().aiPanelOpen).toBe(true)
  expect(useUI.getState().claudeWindow).toBeNull()
  expect(window.location.hash).toBe('#/portfolio')
})
it.each(['both', 'mcp'])('opens the Claude window for ai in %s mode', (mode) => {
  vi.stubEnv('VITE_AI_MODE', mode)
  useUI.setState({ aiPanelOpen: false, claudeWindow: null })
  followGuide({ kind: 'ai' })
  expect(useUI.getState().claudeWindow).toBe('reconnect')
  expect(useUI.getState().aiPanelOpen).toBe(false)
})
it.each(['github'] as const)('opens Settings for %s', (kind) => {
  followGuide({ kind })
  expect(window.location.hash).toBe('#/settings')
})
