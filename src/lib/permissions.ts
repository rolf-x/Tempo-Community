// Who may do what in an organization. The database enforces the same rules (supabase/migrations/0005_roles.sql);
// the UI uses these to hide controls that would only fail.
import type { Member, Project } from '../types'

export const readOnlyAppMessage = (owner: Pick<Member, 'name'> | null | undefined): string =>
  owner ? `Only ${owner.name} or an admin can change this app.` : 'Only an admin can change this app.'

export const canManagePeople = (me: Member | null | undefined) => !!me && me.active && (me.role === 'owner' || !!me.isAdmin)

export const canEditApp = (me: Member | null | undefined, app: Pick<Project, 'ownerId'>) =>
  canManagePeople(me) || (!!me && me.active && app.ownerId === me.id)
