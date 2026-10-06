import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { HealthKind } from '../../ai/tools/health'
import type { AppTask } from '../../types'
import { AppTasks, type AppTasksProps } from './AppTasks'

// Local noon, so the calendar day is the same in every time zone.
const at = (month: number, day: number, year = 2026) => new Date(year, month - 1, day, 12).toISOString()
const NOW = new Date(2026, 9, 7, 12)
const task = (id: string, problem: HealthKind, patch: Partial<AppTask> = {}): AppTask => ({
  id, problem, title: `Task ${id}`, detail: null, createdAt: at(10, 6),
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm1', at: at(10, 6) }, fixedAt: null, ...patch,
})
const flags = (...kinds: HealthKind[]): ReadonlySet<HealthKind> => new Set(kinds)

function render(props: Partial<AppTasksProps> & Pick<AppTasksProps, 'tasks'>) {
  return renderToStaticMarkup(createElement(AppTasks, { flagKinds: flags('no-readme', 'no-owner'), canEdit: true, onRemove: vi.fn(), now: NOW, ...props }))
}

describe('AppTasks', () => {
  it('is hidden when the app has no tasks', () => {
    expect(render({ tasks: undefined })).toBe('')
    expect(render({ tasks: [] })).toBe('')
  })

  it('lists an open task with its detail, its problem, who added it and when', () => {
    const html = render({ tasks: [task('a', 'no-readme', { title: 'Write the README', detail: 'Say how to run it with npm run dev.' })] })
    expect(html).toContain('aria-label="Tasks"')
    expect(html).toContain('Write the README')
    expect(html).toContain('Say how to run it with npm run dev.')
    expect(html).toContain('Add a README')
    expect(html).toContain('Added by Claude Code · 6 Oct')
    expect(html).toContain('text-text-muted')
    expect(html).not.toContain('fixed')
  })

  it('cleans what it shows, whatever was stored: no links, secrets redacted, markup as text', () => {
    const html = render({ tasks: [task('a', 'no-readme', { title: 'Open <b>https://evil.example/x</b> now', detail: 'Key sk_live_abcdefghijklmnopqrstuvwx at www.evil.example' })] })
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('sk_live_abcdefghijklmnopqrstuvwx')
    expect(html).not.toContain('<b>')
    expect(html).toContain('Open now')
  })

  it('gives people who can edit a remove button per open task, named after the task', () => {
    const tasks = [task('a', 'no-readme', { title: 'Write the README' }), task('b', 'no-owner', { title: 'Pick an owner' })]
    const html = render({ tasks })
    expect(html).toContain('aria-label="Remove task Write the README"')
    expect(html).toContain('aria-label="Remove task Pick an owner"')
    expect(render({ tasks, canEdit: false })).not.toContain('Remove task')
  })

  it('shows a task whose flag is gone as fixed straight away, collapsed under "N fixed"', () => {
    const html = render({ tasks: [task('a', 'no-readme'), task('b', 'stale', { title: 'Archive it' })] })
    expect(html).toContain('Task a')
    expect(html).toContain('1 fixed')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Archive it')
    expect(html).not.toContain('Remove task Archive it')
  })

  it('lists the fixed tasks once opened, with the day a sync saved or just "Fixed"', () => {
    const html = render({
      tasks: [task('a', 'no-readme'), task('b', 'stale', { title: 'Archive it' }), task('c', 'secrets', { title: 'Rotate the key', fixedAt: at(10, 5) })],
      defaultFixedOpen: true,
    })
    expect(html).toContain('2 fixed')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Archive it')
    expect(html).toContain('>Fixed</span>')
    expect(html).toContain('Fixed on 5 Oct')
    expect(html).not.toContain('Remove task Rotate the key')
    expect(html.indexOf('Archive it')).toBeLessThan(html.indexOf('Rotate the key'))
  })

  it('keeps a task fixed after its flag comes back', () => {
    const html = render({ tasks: [task('a', 'no-readme', { fixedAt: at(10, 5) })], defaultFixedOpen: true })
    expect(html).toContain('1 fixed')
    expect(html).toContain('No open tasks.')
    expect(html).not.toContain('All done')
    expect(html).not.toContain('Remove task')
  })

  it('hides the block when every task was removed, not fixed', () => {
    expect(render({ tasks: [task('a', 'no-readme', { removedAt: at(10, 5) })] })).toBe('')
  })

  it('names the year for an older day and falls back when the client has no name', () => {
    const html = render({ tasks: [task('a', 'no-readme', { createdAt: at(12, 24, 2025), draftedBy: { client: ' ', clientId: null, memberId: 'm1', at: at(12, 24, 2025) } })] })
    expect(html).toContain('Added by an AI agent · 24 Dec 2025')
  })

  it('renders task text as plain text', () => {
    const html = render({ tasks: [task('a', 'no-readme', { title: 'Open <img src=x onerror=alert(1)> now', detail: '[click](https://evil.example)' })] })
    expect(html).not.toContain('<img')
    expect(html).toContain('Open now') // markup is dropped, as the server drops it
    expect(html).toContain('click')
    expect(html).not.toContain('https://evil.example')
  })
})
