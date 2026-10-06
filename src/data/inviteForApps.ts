// Invite made when an owner who isn't in Tempo yet is assigned to apps.
// Contract between the owner picker and the invites backend: callers pass the app ids they assigned; the backend
// attaches them to the invite so the invitee lands on "Maya asked you to own 2 apps".
import { createInvite, type InviteLink } from './workspace'

export interface AppInvite extends InviteLink {
  appIds: string[]
}

export async function createInviteForApps(appIds: string[], email: string | null = null): Promise<AppInvite> {
  const scoped = [...new Set(appIds.map((id) => id.trim()).filter(Boolean))]
  const link = await createInvite(email, scoped)
  return { ...link, appIds: scoped }
}
