/** 'removed': the signed-in person was removed from the workspace after this link was made (0015). */
export type InviteStatus = 'ok' | 'expired' | 'used' | 'missing' | 'removed'

export const isInviteToken = (token: string): boolean => token.length === 32 && /^[a-f0-9]{32}$/.test(token)

export interface InviteApp {
  id: string
  name: string
  repo?: string | null
}

export interface InvitePreview {
  status: InviteStatus
  inviterName: string | null
  workspaceName: string | null
  apps: InviteApp[]
}

export interface WorkspaceInvite {
  id: string
  token: string
  email: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
  declinedAt: string | null
  declineNote: string | null
  appIds: string[]
  apps: InviteApp[]
  inviterName: string
  inviteeName: string | null
  joinedMemberName: string | null
  url: string
}

export type InviteListStatus = 'Sent' | 'Joined' | 'Declined' | 'Expired'

export interface InviteReminder {
  inviteId: string
  kind: 'send-again' | 'new-link'
  text: string
}

const DAY = 86_400_000
const time = (value: string): number => Date.parse(value)

export function inviteListStatus(invite: Pick<WorkspaceInvite, 'usedAt' | 'declinedAt' | 'expiresAt'>, now: number): InviteListStatus {
  if (invite.declinedAt) return 'Declined'
  if (invite.usedAt) return 'Joined'
  const expiresAt = time(invite.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= now ? 'Expired' : 'Sent'
}

export function inviteDeadCopy(status: Exclude<InviteStatus, 'ok'>, inviterName: string | null, workspaceName: string | null = null): { title: string; body: string } {
  const ask = inviterName ? `Ask ${inviterName} for a new one.` : 'Ask the person who sent it for a new one.'
  if (status === 'removed') {
    return {
      title: `You were removed from ${workspaceName || 'this workspace'}`,
      body: "This link was made before you were removed, so it can't bring you back. Ask an owner or admin for a new invite.",
    }
  }
  if (status === 'used') return { title: 'This invite was already answered', body: `This invite was already answered. ${ask}` }
  if (status === 'expired') return { title: 'This invite link has expired', body: `This invite link has expired. ${ask}` }
  return { title: "This invite link doesn't work", body: `This invite link doesn't exist. ${ask}` }
}

export function inviteAnswerToast(confirmed: number, offered: number, workspaceName: string): string {
  if (offered === 0) return `Joined ${workspaceName}`
  if (confirmed === 0) return "You said these apps aren't yours. The workspace admin can review your answer."
  if (confirmed < offered) return 'Your app choices were saved. The workspace admin can review the apps you declined.'
  return `You confirmed ${offered === 1 ? 'this app is' : 'these apps are'} yours.`
}

/** Short public name for consumers that do not need to distinguish link preflight status. */
export const inviteStatus = inviteListStatus

export interface InviteAnswerSummary {
  label: string
  declinedApps: string[]
  derivable: boolean
}

/** Derives a partial answer from present ownership; older schemas do not retain declined app ids. */
export function inviteAnswerSummary(
  invite: Pick<WorkspaceInvite, 'appIds' | 'apps' | 'usedAt' | 'declinedAt' | 'joinedMemberName' | 'email'>,
  projects: { id: string; ownerId: string | null; name: string }[],
  members: { id: string; name: string; email: string | null; userId: string | null }[],
): InviteAnswerSummary | null {
  if (!invite.declinedAt) return null
  const offered = invite.appIds.length
  const names = new Map(invite.apps.map((app) => [app.id, app.name]))
  const candidates = members.filter((member) => !!member.userId && (
    (!!invite.joinedMemberName && member.name.trim().toLowerCase() === invite.joinedMemberName.trim().toLowerCase())
    || (!!invite.email && !!member.email && member.email.trim().toLowerCase() === invite.email.trim().toLowerCase())
  ))
  const unique = [...new Map(candidates.map((member) => [member.id, member])).values()]
  if (offered === 0 || unique.length !== 1) return { label: 'Answered', declinedApps: [], derivable: false }

  const acceptedBy = unique[0].id
  const confirmed = invite.appIds.filter((id) => projects.find((project) => project.id === id)?.ownerId === acceptedBy)
  const declined = invite.appIds.filter((id) => !confirmed.includes(id))
  const declinedApps = declined.map((id) => names.get(id) ?? projects.find((project) => project.id === id)?.name).filter((name): name is string => !!name)
  if (confirmed.length === 0) return { label: 'Declined', declinedApps, derivable: true }
  return { label: `Answered · ${confirmed.length} of ${offered} confirmed`, declinedApps, derivable: true }
}

export function invitePersonName(invite: Pick<WorkspaceInvite, 'inviteeName' | 'joinedMemberName' | 'email'> & Partial<Pick<WorkspaceInvite, 'appIds'>>): string {
  // A plain link (no email, no apps) is the reusable team link, not one person's invite.
  const teamLink = !invite.email && !invite.inviteeName && !invite.joinedMemberName && !(invite.appIds?.length)
  if (teamLink) return 'Team link'
  const value = invite.joinedMemberName || invite.inviteeName || invite.email?.split('@')[0] || 'This person'
  return value.trim() || 'This person'
}

/** Returns only actionable copy. Answered and expired invites do not get pending reminders. */
export function inviteReminderText(invite: WorkspaceInvite, now: number): string | null {
  if (inviteListStatus(invite, now) !== 'Sent') return null
  const name = invitePersonName(invite)
  const expiresAt = time(invite.expiresAt)
  const createdAt = time(invite.createdAt)
  const remaining = expiresAt - now

  if (Number.isFinite(remaining) && remaining > 0 && remaining <= DAY) {
    return `${name}'s link expires tomorrow.`
  }
  if (Number.isFinite(createdAt) && now - createdAt >= 2 * DAY) {
    return `${name} hasn't joined yet.`
  }
  return null
}

export const reminderText = inviteReminderText

/** Expiry wins because it has the nearest hard deadline; otherwise the oldest unanswered invite wins. */
export function pendingInviteReminder(invites: WorkspaceInvite[], now: number): InviteReminder | null {
  const pending = invites
    // A plain team link stays reusable (never marked used), so only personal links (email or apps) get reminders.
    .filter((invite) => (!!invite.email || invite.appIds.length > 0) && inviteListStatus(invite, now) === 'Sent')
    .map((invite) => {
      const text = inviteReminderText(invite, now)
      if (!text) return null
      const expiresAt = time(invite.expiresAt)
      const urgent = Number.isFinite(expiresAt) && expiresAt > now && expiresAt - now <= DAY
      return {
        invite,
        reminder: {
          inviteId: invite.id,
          kind: urgent ? 'new-link' as const : 'send-again' as const,
          text,
        },
        urgent,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
      return time(a.invite.createdAt) - time(b.invite.createdAt)
    })

  return pending[0]?.reminder ?? null
}
