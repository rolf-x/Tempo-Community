// Updates on every push, kept quiet: reads the workspace's GitHub App links, and links a workspace that has none when an
// owner or admin is signed in with GitHub connected. It shows nothing and never raises an error; Settings →
// Integrations is the only place the result appears. Mounted once in the app shell, like ClaudeNotices.
import { useEffect, useMemo } from 'react'
import { useSession } from '../data/session'
import { autoLinkInstallations, loadInstallationLinks, useInstallationLinks } from '../data/githubLink'
import { canManagePeople } from '../lib/permissions'
import { isSampleRepo } from '../lib/sampleRepo'
import { useStore } from '../store/useStore'
import { useUI } from './uiState'

export function AutoLinkInstallations() {
  const signedIn = useSession((s) => s.status === 'signed-in')
  const githubConnected = useSession((s) => !!s.githubToken)
  const demo = useStore((s) => s.settings.demo)
  const workspaceId = useStore((s) => s.workspace?.id ?? null)
  const projects = useStore((s) => s.projects)
  const members = useStore((s) => s.members)
  const meId = useStore((s) => s.meId)
  const pickerOpen = useUI((s) => s.repoPickerOpen)
  const entry = useInstallationLinks(workspaceId)

  const active = signedIn && !demo && !!workspaceId
  const canManage = useMemo(() => canManagePeople(members.find((m) => m.id === meId)), [members, meId])
  const hasRepoApp = useMemo(() => projects.some((p) => !p.archived && !!p.repo && !isSampleRepo(p)), [projects])

  useEffect(() => {
    if (active && workspaceId) void loadInstallationLinks(workspaceId)
  }, [active, workspaceId])

  useEffect(() => {
    if (!active || !workspaceId) return
    void autoLinkInstallations(workspaceId, { signedIn, demo, githubConnected, canManage, hasRepoApp, pickerOpen })
  }, [active, workspaceId, signedIn, demo, githubConnected, canManage, hasRepoApp, pickerOpen, entry.status, entry.links.length, entry.recheck])

  return null
}
