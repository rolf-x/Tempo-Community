import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { OwnerSuggestion } from '../../ai/tools/matchMember'
import { appDefaults } from '../../lib/model'
import { useStore } from '../../store/useStore'
import type { Member, Project } from '../../types'
import { AssignOwnersBody, appsNeedingOwner, ownerRows, summaryLine } from './AssignOwners'
import { useUI } from '../uiState'

const NOW = new Date('2026-10-06T12:00:00Z')
const person = (id: string, name: string, patch: Partial<Member> = {}): Member => ({
  id, name, email: null, avatarUrl: null, githubLogin: null, userId: `user-${id}`, role: 'member', active: true, ...patch,
})
const app = (id: string, name: string, ownerId: string | null, patch: Partial<Project> = {}): Project => ({
  id, name, emoji: 'A', color: 'blue', description: '', createdAt: '2026-09-01T00:00:00.000Z', archived: false, ...appDefaults(), ownerId, ...patch,
})
const maya = person('maya', 'Maya Chen', { role: 'owner' })
const gone = person('gone', 'Gil Gone', { active: false })
const leaving = person('leaving', 'Lee Leaving', { leavingOn: '2026-10-20' })
const members = [maya, gone, leaving, person('sam', 'Sam Lee')]
const projects = [
  app('zeta', 'Zeta', null),
  app('alpha', 'Alpha', 'gone'),
  app('mine', 'Mine', 'maya'),
  app('soon', 'Soon', 'leaving'),
  app('old', 'Old one', null, { archived: true }),
  app('others', 'Others', 'sam'),
  app('mid', 'Middle', null),
]

describe('appsNeedingOwner', () => {
  it('lists every app with no owner or whose owner left, A to Z, whoever is looking and whatever the scope', () => {
    expect(appsNeedingOwner(projects, members, false, NOW).map((a) => a.id)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('leaves out owned apps, an owner who is only leaving soon, and archived apps', () => {
    const ids = appsNeedingOwner(projects, members, false, NOW).map((a) => a.id)
    for (const id of ['mine', 'soon', 'old', 'others']) expect(ids).not.toContain(id)
  })

  it('counts an owner whose last day has passed as left', () => {
    const past = person('past', 'Pat Past', { leavingOn: '2026-10-05' })
    expect(appsNeedingOwner([app('x', 'X', 'past')], [past], false, NOW).map((a) => a.id)).toEqual(['x'])
  })

  it('has nothing to list in a personal workspace, where apps have no owners to show', () => {
    expect(appsNeedingOwner(projects, members, true, NOW)).toEqual([])
  })
})

describe('ownerRows', () => {
  const ids = ['alpha', 'mid', 'zeta']

  it('marks a row done once it has an owner, and keeps it in the list', () => {
    const before = ownerRows(ids, projects, members, false, {}, NOW)
    expect(before.map((row) => [row.project.id, row.assigned])).toEqual([['alpha', false], ['mid', false], ['zeta', false]])
    expect(before[0].owner?.name).toBe('Gil Gone')

    const after = projects.map((p) => (p.id === 'mid' ? { ...p, ownerId: 'sam' } : p))
    const rows = ownerRows(ids, after, members, false, {}, NOW)
    expect(rows.map((row) => row.project.id)).toEqual(ids)
    expect(rows[1]).toMatchObject({ assigned: true, owner: { name: 'Sam Lee' } })
    expect(rows[0].assigned).toBe(false)
  })

  it('counts a person who has not joined Tempo yet as an owner too (their invite link is in the picker)', () => {
    const pat = person('pat', 'Pat Doe', { userId: null })
    const rows = ownerRows(['mid'], projects.map((p) => (p.id === 'mid' ? { ...p, ownerId: 'pat' } : p)), [...members, pat], false, {}, NOW)
    expect(rows[0]).toMatchObject({ assigned: true, owner: { name: 'Pat Doe' } })
  })

  it('keeps the suggestion only for rows still waiting, and drops apps that went away or were archived', () => {
    const suggestion: OwnerSuggestion = { name: 'Sam Lee', login: null, email: null, memberId: 'sam', commits: 8, totalCommits: 10, share: 80, since: '2026-07-01T00:00:00.000Z' }
    const after = projects.map((p) => (p.id === 'mid' ? { ...p, ownerId: 'sam' } : p.id === 'zeta' ? { ...p, archived: true } : p))
    const rows = ownerRows([...ids, 'missing'], after, members, false, { alpha: suggestion, mid: suggestion }, NOW)
    expect(rows.map((row) => row.project.id)).toEqual(['alpha', 'mid'])
    expect(rows[0].suggestion).toBe(suggestion)
    expect(rows[1].suggestion).toBeNull()
  })
})

describe('summaryLine', () => {
  const row = (assigned: boolean) => ({ project: projects[0], owner: null, assigned, suggestion: null })
  it('says how many are left, then that every app has an owner', () => {
    expect(summaryLine([row(false), row(false), row(true)])).toBe('2 of 3 apps still need an owner.')
    expect(summaryLine([row(false), row(true)])).toBe('1 of 2 apps still needs an owner.')
    expect(summaryLine([row(true), row(true)])).toBe('Every app has an owner.')
    expect(summaryLine([])).toBeNull()
  })
})

describe('AssignOwnersBody', () => {
  const body = (rows = ownerRows(['alpha', 'mid', 'zeta'], projects, members, false, {}, NOW)) =>
    renderToStaticMarkup(createElement(AssignOwnersBody, { rows }))

  it('gives each app a row: its name as a link, who left, and a Pick owner button', () => {
    const html = body()
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html).toContain('href="#/p/alpha/app"')
    expect(html).toContain('>Alpha<')
    expect(html).toContain('Gil Gone has left')
    expect(html.match(/>Pick owner</g)).toHaveLength(3)
    expect(html).not.toContain('Change')
  })

  it('shows the commit-share suggestion when there is one', () => {
    const suggestion: OwnerSuggestion = { name: 'Sam Lee', login: null, email: null, memberId: 'sam', commits: 8, totalCommits: 10, share: 80, since: '2026-07-01T00:00:00.000Z' }
    const html = body(ownerRows(['mid'], projects, members, false, { mid: suggestion }, NOW))
    expect(html).toContain('Suggested:')
    expect(html).toContain('Sam Lee')
    expect(html).toContain('80')
    expect(html).toContain('of commits since July')
  })

  it('shows the new owner with a check, and a Change button, once one is picked', () => {
    const after = projects.map((p) => (p.id === 'mid' ? { ...p, ownerId: 'sam' } : p))
    const html = body(ownerRows(['alpha', 'mid', 'zeta'], after, members, false, {}, NOW))
    expect(html).toContain('Sam Lee</span> is the owner')
    expect(html).toContain('lucide-check')
    expect(html.match(/>Change</g)).toHaveLength(1)
    expect(html.match(/>Pick owner</g)).toHaveLength(2)
  })

  it('says every app has an owner when nothing needs one', () => {
    const html = body([])
    expect(html).toContain('Every app has an owner.')
    expect(html).not.toContain('<li')
  })
})

describe('the Assign owners window state', () => {
  beforeEach(() => useUI.setState({ assignOwnersOpen: false }))
  it('counts as a modal, so shortcuts stand down', () => {
    expect(useUI.getState().anyModalOpen()).toBe(false)
    useUI.getState().setAssignOwnersOpen(true)
    expect(useUI.getState().anyModalOpen()).toBe(true)
    useUI.getState().setAssignOwnersOpen(false)
    expect(useUI.getState().anyModalOpen()).toBe(false)
  })

  it('reads the live store, so an owner picked in the picker shows in the row', () => {
    useStore.getState().resetAll()
    useStore.setState({ members, projects, workspace: { id: 'team', name: 'Acme' } })
    useStore.getState().updateProject('zeta', { ownerId: 'sam' })
    const rows = ownerRows(['zeta'], useStore.getState().projects, useStore.getState().members, false, {}, NOW)
    expect(rows[0]).toMatchObject({ assigned: true, owner: { id: 'sam' } })
  })
})
