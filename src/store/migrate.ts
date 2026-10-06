// Persisted-state migrations. v1 (single user, assignee = free-text name) → v2 (members, apps, activity).
import type { Member, PersistedState, Project } from '../types'
import { appDefaults } from '../lib/model'
import { memberId } from '../lib/ids'

export const ME_NAME = 'You'

export function makeMember(name: string, over: Partial<Member> = {}): Member {
  return { id: memberId(), name, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: true, ...over }
}

type V1 = { projects?: Omit<Project, keyof ReturnType<typeof appDefaults>>[]; [k: string]: unknown }

/** Old local copies become app-only portfolios. Stored tasks are intentionally discarded. */
export function migrateV1(old: V1): Partial<PersistedState> {
  const me = makeMember(ME_NAME, { role: 'owner' })
  const projects: Project[] = (old.projects ?? []).map((p) => ({ ...appDefaults(), ...p }))
  const { tasks: _tasks, today: _today, ...rest } = old
  return { ...rest, version: 3, projects, members: [me], activity: [], meId: me.id, workspace: null } as Partial<PersistedState>
}
