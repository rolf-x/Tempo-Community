import { useCallback, useEffect, useMemo, useState } from 'react'
import { knownAIApps, useAIApps, useWatchAIApps } from '../../data/aiApps'
import { useSession } from '../../data/session'
import { canWriteCards } from '../../ai/workspaceAI'
import { mcpEnabled } from '../../lib/aiMode'
import { appName } from '../../lib/mcpSetup'
import { useStore } from '../../store/useStore'
import { nextStep } from '../../lib/nextStep'
import { pendingInviteReminder, type WorkspaceInvite } from '../../lib/invites'
import { listInvites } from '../../data/workspace'
import { isPersonal } from '../../lib/model'
import { EMPTY_GUIDE, guideScope, useGuideState } from './guideState'

export function useGuideProgress() {
  const workspaceId = useStore((s) => s.workspace?.id ?? null)
  const demo = useStore((s) => s.settings.demo)
  const userId = useSession((s) => s.user?.id ?? null)
  const scope = guideScope(workspaceId, userId, demo)
  const progress = useGuideState((s) => s.workspaces[scope] ?? EMPTY_GUIDE)
  const collapse = useGuideState((s) => s.setChecklistCollapsed)
  const setCollapsed = useCallback((value: boolean) => collapse(scope, value), [collapse, scope])
  return { ...progress, setCollapsed }
}

export function useGuide(projectIds?: ReadonlySet<string>) {
  const allProjects = useStore((s) => s.projects)
  const members = useStore((s) => s.members)
  const settings = useStore((s) => s.settings)
  const workspace = useStore((s) => s.workspace)
  const me = useStore((s) => s.members.find((member) => member.id === s.meId) ?? null)
  const login = useSession((s) => s.user?.githubLogin ?? null)
  const connected = useSession((s) => !!s.githubToken)
  const signedIn = useSession((s) => s.status === 'signed-in')
  const progress = useGuideProgress()
  const projects = projectIds ? allProjects.filter((project) => projectIds.has(project.id)) : allProjects
  const invites = useManagerInvites(signedIn && !settings.demo && !isPersonal(workspace), members)
  const inviteReminder = useMemo(() => pendingInviteReminder(invites, Date.now()), [invites])
  const aiApps = useConnectedAIApps(signedIn && !settings.demo && mcpEnabled())
  // `both`: a saved key (it writes the descriptions itself) also finishes "Connect Claude". In `mcp` there is none.
  const aiKey = canWriteCards(settings)
  const guide = useMemo(() => nextStep({ projects, members, settings, workspace, githubLogin: login, githubConnected: connected, inviteReminder, me, aiApps, aiKey }),
    [projects, members, settings, workspace, login, connected, inviteReminder, me, aiApps, aiKey])
  return { ...guide, ...progress, visible: signedIn && !settings.demo }
}

/**
 * `mcp` and `both` modes: the AI apps connected to Tempo, by short name, for "Connect Claude". Read when the guide shows, again on
 * coming back to the tab or an Allow in another Tempo tab; Settings → Connect your AI keeps the same list current.
 * Off: undefined, so the guide goes by the browser's own AI connection.
 */
function useConnectedAIApps(enabled: boolean): string[] | null | undefined {
  const userId = useSession((s) => s.user?.id ?? null)
  const clients = useAIApps((s) => knownAIApps(s, userId))
  const on = enabled && !!userId
  useWatchAIApps(userId, on)
  return useMemo(() => (on ? (clients ? clients.map((item) => appName(item.name)) : null) : undefined), [on, clients])
}

/** Invites are listed only for owners and admins (rpc list_invites); everyone else gets none. Refreshes when the members change. */
function useManagerInvites(enabled: boolean, members: { id: string; role: string; isAdmin?: boolean }[]): WorkspaceInvite[] {
  const meId = useStore((s) => s.meId)
  const me = members.find((m) => m.id === meId)
  const manager = enabled && !!me && (me.role === 'owner' || !!me.isAdmin)
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  useEffect(() => {
    if (!manager) return setInvites([])
    let live = true
    listInvites().then((list) => live && setInvites(list), () => live && setInvites([]))
    return () => { live = false }
  }, [manager, members.length])
  return invites
}
