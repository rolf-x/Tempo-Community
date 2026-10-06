import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClaudeWriting } from '../data/claudeWriting'
import { useSyncAll, type SyncAppProgress, type SyncSummary } from '../data/syncAll'
import { SyncAllBody, SyncAllFooter, SyncAllPill, SyncAllProgress, nowLine, progressLine, rowStatus } from './SyncAllProgress'

vi.mock('../ai/router', () => ({ aiSyncApp: vi.fn() }))
vi.mock('../ai/keyTasks', () => ({ appWantsTasks: vi.fn(() => false), aiWriteTasks: vi.fn() }))
vi.mock('./ConnectGitHubDialog', () => ({ runGitHubGated: vi.fn() }))
// The server render reads a store's initial state, so read the live one instead (as ClaudeWritingIndicator's test does).
vi.mock('../data/syncAll', async (original) => {
  const actual = await original<typeof import('../data/syncAll')>()
  return { ...actual, useSyncAll: Object.assign((selector: (state: ReturnType<typeof actual.useSyncAll.getState>) => unknown) => selector(actual.useSyncAll.getState()), actual.useSyncAll) }
})
vi.mock('../data/claudeWriting', async (original) => {
  const actual = await original<typeof import('../data/claudeWriting')>()
  return { ...actual, useClaudeWriting: Object.assign((selector: (state: ReturnType<typeof actual.useClaudeWriting.getState>) => unknown) => selector(actual.useClaudeWriting.getState()), actual.useClaudeWriting) }
})

const app = (name: string, step: SyncAppProgress['step'], patch: Partial<SyncAppProgress> = {}): SyncAppProgress => ({ id: name, name, step, wrote: false, tasks: 0, ...patch })
const summary = (patch: Partial<SyncSummary> = {}): SyncSummary => ({ total: 50, failed: 0, wrote: 12, couldnt: 0, taskApps: 9, tasks: 20, couldntTasks: 0, ...patch })
const body = (props: Partial<Parameters<typeof SyncAllBody>[0]>) => renderToStaticMarkup(createElement(SyncAllBody, { apps: [], done: 0, total: 0, summary: null, ...props }))
const footer = (props: Partial<Parameters<typeof SyncAllFooter>[0]>) => renderToStaticMarkup(createElement(SyncAllFooter, { summary: null, onHide: () => {}, onClose: () => {}, onReview: () => {}, ...props }))
const pill = (props: Partial<Parameters<typeof SyncAllPill>[0]>) => renderToStaticMarkup(createElement(SyncAllPill, { done: 0, total: 0, finished: false, onClick: () => {}, ...props }))

afterEach(() => {
  useSyncAll.setState({ running: false, done: 0, total: 0, failed: [], ai: false, apps: [], view: null, summary: null })
  useClaudeWriting.setState({ workspaceId: null, startedAt: null, prompt: '', expected: [], arrived: [], lastArrivalAt: null, phase: null })
})

describe('Sync all progress copy', () => {
  it('says how far along it is, and what is happening to each app', () => {
    expect(progressLine(30, 50)).toBe('Writing descriptions · 30 of 50 apps')
    expect(progressLine(0, 1)).toBe('Writing descriptions · 0 of 1 app')
    expect(nowLine(app('Invoice hub', 'reading'))).toBe('Reading GitHub for Invoice hub…')
    expect(nowLine(app('Invoice hub', 'writing'))).toBe('Writing the description for Invoice hub…')
    expect(nowLine(app('Invoice hub', 'tasks'))).toBe('Adding tasks for Invoice hub…')
  })

  it("gives every app a short status", () => {
    expect(rowStatus(app('a', 'waiting'))).toBe('Waiting')
    expect(rowStatus(app('a', 'reading'))).toBe('Reading GitHub…')
    expect(rowStatus(app('a', 'writing'))).toBe('Writing description…')
    expect(rowStatus(app('a', 'tasks'))).toBe('Adding tasks…')
    expect(rowStatus(app('a', 'failed'))).toBe("Couldn't sync")
    expect(rowStatus(app('a', 'done'))).toBe('Done')
    expect(rowStatus(app('a', 'done', { wrote: true }))).toBe('Done · description written')
    expect(rowStatus(app('a', 'done', { wrote: true, tasks: 3 }))).toBe('Done · description written · 3 tasks')
    expect(rowStatus(app('a', 'done', { tasks: 1 }))).toBe('Done · 1 task')
  })
})

describe('the window while it runs', () => {
  const running = () => body({
    done: 30, total: 50,
    apps: [app('Shop', 'done', { wrote: true }), app('Invoice hub', 'writing'), app('Blog', 'tasks'), app('Docs', 'waiting'), app('API', 'failed')],
  })

  it('shows the big line, what is happening now, a bar and a row for each app', () => {
    const html = running()
    expect(html).toContain('Writing descriptions · 30 of 50 apps')
    expect(html).toContain('Writing the description for Invoice hub…')
    expect(html).toContain('Adding tasks for Blog…')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="60"')
    expect(html).toContain('aria-label="Apps"')
    for (const status of ['Done · description written', 'Writing description…', 'Adding tasks…', 'Waiting', 'Couldn&#x27;t sync']) expect(html).toContain(status)
    expect(html).not.toContain('Reading GitHub for Shop') // only the apps working now
    expect(html).not.toContain('Reading GitHub for Docs')
  })

  it('says it can be closed, and where the progress goes', () => {
    expect(running()).toContain('You can close this. Tempo keeps going and shows its progress at the bottom of the screen.')
  })

  it('says it is starting before the first app is in', () => {
    expect(body({ done: 0, total: 3, apps: [app('A', 'waiting')] })).toContain('Starting…')
    expect(body({ done: 3, total: 3, apps: [app('A', 'done')] })).toContain('Finishing up…')
  })

  it('has one button: Hide', () => {
    const html = footer({})
    expect(html).toContain('Hide')
    expect(html).not.toContain('Open Review')
    expect(html).not.toContain('Close')
  })

  it('does not break on no apps', () => {
    expect(body({})).toContain('aria-valuenow="0"')
  })
})

describe('the window when it is done', () => {
  const done = (patch: Partial<SyncSummary> = {}) => body({ done: 50, total: 50, summary: summary(patch), apps: [app('Shop', 'done', { wrote: true, tasks: 2 })] })

  it('shows the summary and a full bar instead of the progress line', () => {
    const html = done()
    expect(html).toContain('Done. Synced 50 apps. Wrote 12 descriptions. Added tasks to 9 apps.')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('Done · description written · 2 tasks')
    expect(html).not.toContain('Writing descriptions ·')
    expect(html).not.toContain('You can close this')
  })

  it('says what could not be done', () => {
    expect(done({ failed: 2, wrote: 0, taskApps: 0 })).toContain('Done. Synced 48 of 50 apps. 2 couldn&#x27;t sync.')
  })

  it('offers Open Review only when descriptions were written', () => {
    expect(footer({ summary: summary() })).toContain('Open Review')
    expect(footer({ summary: summary() })).toContain('Close')
    expect(footer({ summary: summary({ wrote: 0 }) })).not.toContain('Open Review')
    expect(footer({ summary: summary({ wrote: 0 }) })).toContain('Close')
    expect(footer({ summary: summary() })).not.toContain('Hide')
  })
})

describe('the pill', () => {
  it('shows the count, with a spinner, while it runs', () => {
    const html = pill({ done: 30, total: 50 })
    expect(html).toContain('Syncing 30 of 50')
    expect(html).toContain('animate-spin')
    expect(html).toContain('aria-label="Syncing 30 of 50 apps. Show progress"')
    expect(html).toContain('<button')
  })

  it('says it is done, and where to look, when the run ends', () => {
    const html = pill({ done: 50, total: 50, finished: true })
    expect(html).toContain('Sync done')
    expect(html).toContain('See what changed')
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('Syncing 50')
  })

  it('stacks above the "Claude is writing" pill', () => {
    expect(pill({ lifted: true })).toContain('bottom-[13rem]')
    expect(pill({})).toContain('bottom-[7.5rem]')
  })
})

describe('SyncAllProgress', () => {
  const render = () => renderToStaticMarkup(createElement(SyncAllProgress))

  it('shows nothing when there is no window', () => {
    expect(render()).toBe('')
  })

  it('shows only the pill when the window is minimised', () => {
    useSyncAll.setState({ running: true, ai: true, view: 'mini', done: 30, total: 50, apps: [app('Shop', 'writing')] })
    const html = render()
    expect(html).toContain('Syncing 30 of 50')
    expect(html).not.toContain('Syncing your apps')
    expect(html).not.toContain('role="dialog"')
  })

  it('turns the pill into "Sync done" when the run ends while it is minimised', () => {
    useSyncAll.setState({ running: false, ai: true, view: 'mini', done: 50, total: 50, summary: summary() })
    const html = render()
    expect(html).toContain('Sync done')
    expect(html).toContain('See what changed')
  })

  it('sits above the "Claude is writing" pill when both are showing', () => {
    useSyncAll.setState({ running: true, ai: true, view: 'mini', done: 1, total: 5 })
    useClaudeWriting.setState({ phase: 'writing', expected: ['a'], arrived: [] })
    expect(render()).toContain('bottom-[13rem]')
  })
})
