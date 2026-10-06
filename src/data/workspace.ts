// Workspace operations the UI calls. Guest mode: local only. Cloud: Supabase (src/data/cloud.ts, loaded on demand).
import { useStore } from '../store/useStore'
import type { InvitePreview, WorkspaceInvite } from '../lib/invites'
import type { WorkspaceKind } from '../types'
import { inviteListStatus } from '../lib/invites'
import { cloudConfigured, useSession } from './session'

export const isCloud = () => useSession.getState().status === 'signed-in' && !!useStore.getState().workspace
const cloud = () => import('./cloud')

export interface InviteLink {
  url: string
  expiresAt: string
}

/** Returns a join link. Guest mode can't invite (there is no server to join): the UI explains and offers sign-in. */
export async function createInvite(email: string | null, appIds: string[] = []): Promise<InviteLink> {
  if (!isCloud()) throw new Error('Invites need a shared workspace. Sign in to create one.')
  return (await cloud()).createInviteCloud(email, appIds)
}

/** Accept an invite token after sign-in. Returns the workspace name. */
export async function acceptInvite(token: string): Promise<string> {
  if (!cloudConfigured) throw new Error('Sign-in is not set up on this deployment yet.')
  if (useSession.getState().status !== 'signed-in') {
    ;(await cloud()).rememberInvite(token)
    throw new Error('Sign in to accept this invite.')
  }
  return (await cloud()).acceptInviteCloud(token)
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  if (!cloudConfigured) throw new Error('Invite links are not set up on this deployment.')
  return (await cloud()).previewInviteCloud(token)
}

export async function listInvites(): Promise<WorkspaceInvite[]> {
  if (!isCloud()) return []
  return (await cloud()).listInvitesCloud()
}

/** Revokes by the invite's token, its primary key. */
export async function revokeInvite(token: string): Promise<void> {
  if (!isCloud()) return
  return (await cloud()).revokeInviteCloud(token)
}

/** Changes an app owner and clears any now-stale, open, single-app invite made for its placeholder owner. */
export async function changeProjectOwner(projectId: string, ownerId: string | null): Promise<void> {
  const state = useStore.getState()
  const project = state.projects.find((item) => item.id === projectId)
  const previousOwner = state.members.find((member) => member.id === project?.ownerId) ?? null
  const staleInvites = previousOwner && !previousOwner.userId && previousOwner.id !== ownerId && isCloud()
    ? listInvites()
    : Promise.resolve([])

  state.updateProject(projectId, { ownerId })

  // The owner change is already saved; clearing the old link is best effort.
  try {
    const invites = await staleInvites
    const open = invites.filter((invite) => invite.appIds.length === 1
      && invite.appIds[0] === projectId
      && inviteListStatus(invite, Date.now()) === 'Sent')
    await Promise.all(open.map((invite) => revokeInvite(invite.token)))
  } catch {
    throw new Error('The owner changed, but the old invite link is still open. Revoke it in Settings.')
  }
}

export async function acceptInviteApps(token: string, confirmed: string[], note: string | null = null): Promise<string> {
  if (!cloudConfigured) throw new Error('Sign-in is not set up on this deployment yet.')
  if (useSession.getState().status !== 'signed-in') {
    ;(await cloud()).rememberInvite(token)
    throw new Error('Sign in to confirm these apps.')
  }
  return (await cloud()).acceptInviteAppsCloud(token, confirmed, note)
}

export async function renameWorkspace(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 80)
  if (!trimmed) return
  if (isCloud()) return (await cloud()).renameWorkspaceCloud(trimmed)
  const ws = useStore.getState().workspace
  if (ws) useStore.getState().setWorkspace({ ...ws, name: trimmed })
}

export async function removeMember(id: string): Promise<void> {
  useStore.getState().updateMember(id, { active: false }) // synced like any other change in cloud mode
}

/** First sign-in: create an organization or a personal workspace (#/setup). */
export async function setupWorkspace(kind: WorkspaceKind, name: string, githubOrg?: string): Promise<void> {
  return (await cloud()).setupWorkspaceCloud(kind, name, githubOrg)
}

/** Save an organization discovered by this browser for every member and device. */
export async function setWorkspaceGitHubOrg(githubOrg: string): Promise<boolean> {
  if (!isCloud()) return false
  return (await cloud()).setWorkspaceGitHubOrgCloud(githubOrg)
}

/** Personal → organization (owner only, one way). */
export async function upgradeToOrg(name: string): Promise<void> {
  if (!isCloud()) throw new Error('Sign in first.')
  return (await cloud()).upgradeToOrgCloud(name)
}

/** Owner only: give or take admin rights (invite/remove people, edit every app). */
export async function setMemberAdmin(memberId: string, admin: boolean): Promise<void> {
  if (!isCloud()) throw new Error('Sign in first.')
  return (await cloud()).setMemberAdminCloud(memberId, admin)
}
