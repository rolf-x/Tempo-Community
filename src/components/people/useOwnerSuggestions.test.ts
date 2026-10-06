import { describe, expect, it } from 'vitest'
import { appDefaults } from '../../lib/model'
import type { Activity, Member, Project } from '../../types'
import { activityCommits, suggestionsFor } from './useOwnerSuggestions'

const since = new Date('2026-07-01T00:00:00Z')
const person = (id: string, name: string, patch: Partial<Member> = {}): Member => ({
  id, name, email: null, avatarUrl: null, githubLogin: id, userId: `user-${id}`, role: 'member', active: true, ...patch,
})
const app = (id: string, ownerId: string | null): Project => ({
  id, name: id, emoji: 'A', color: 'blue', description: '', createdAt: '2026-09-01T00:00:00.000Z', archived: false, ...appDefaults(), ownerId,
})
const commit = (projectId: string, actor: string, at = '2026-09-10T00:00:00Z'): Activity => ({
  id: `${projectId}-${actor}-${at}-${Math.random()}`, projectId, kind: 'commit', actor, title: 'work', url: null, at,
})
const sam = person('sam', 'Sam Lee')
const nadia = person('nadia', 'Nadia Kim')
const gone = person('gone', 'Gil Gone', { active: false })

describe('suggestionsFor', () => {
  it('suggests the top committer for an app with no owner', () => {
    const activity = [commit('a', 'sam'), commit('a', 'sam'), commit('a', 'nadia')]
    const out = suggestionsFor([app('a', null)], [sam, nadia], activity, {}, since)
    expect(out.a).toMatchObject({ name: 'Sam Lee', memberId: 'sam', share: 67 })
  })

  it('reads only that app’s commits, and only commit events', () => {
    const activity = [commit('a', 'sam'), commit('b', 'nadia'), { ...commit('a', 'nadia'), kind: 'pr' as const }]
    expect(activityCommits(activity, 'a')).toEqual([{ author: 'sam', date: '2026-09-10T00:00:00Z' }])
    expect(suggestionsFor([app('a', null), app('b', null)], [sam, nadia], activity, {}, since)).toMatchObject({ a: { memberId: 'sam' }, b: { memberId: 'nadia' } })
  })

  it('prefers the commits read from GitHub when there are some', () => {
    const activity = [commit('a', 'sam')]
    const fetched = { a: [{ author: 'nadia', date: '2026-09-11T00:00:00Z' }, { author: 'nadia', date: '2026-09-12T00:00:00Z' }] }
    expect(suggestionsFor([app('a', null)], [sam, nadia], activity, fetched, since).a?.memberId).toBe('nadia')
  })

  it('has nothing to suggest with no commits, a tie, or when the owner who left is the one who committed most', () => {
    expect(suggestionsFor([app('a', null)], [sam], [], {}, since).a).toBeNull()
    expect(suggestionsFor([app('a', null)], [sam, nadia], [commit('a', 'sam'), commit('a', 'nadia')], {}, since).a).toBeNull()
    expect(suggestionsFor([app('a', 'gone')], [sam, gone], [commit('a', 'gone'), commit('a', 'gone')], {}, since).a).toBeNull()
  })

  it('does not suggest the person who already owns the app', () => {
    expect(suggestionsFor([app('a', 'gone')], [sam, gone], [commit('a', 'sam')], {}, since).a?.memberId).toBe('sam')
  })
})
