import { health as healthFlags } from '../ai/tools/health'
import { PRESETS } from '../ai/presets'
import { connectLabel } from './mcpSetup'
import { isPersonal } from './model'
import { canEditApp, canManagePeople } from './permissions'
import type { InviteReminder } from './invites'
import { isUncheckedAICard, type Member, type Project, type Settings, type Workspace } from '../types'

export type GuideAction =
  | { kind: 'github' | 'ai' | 'apps' | 'review' | 'invites' }
  | { kind: 'owners'; projectId: string | null }
  | { kind: 'app'; projectId: string }

export interface GuideSnapshot {
  projects: Project[]
  members: Member[]
  settings: Settings
  workspace: Workspace | null
  githubLogin: string | null
  githubConnected: boolean
  me?: Member | null
  /** The most urgent personal invite still waiting (src/lib/invites.ts pendingInviteReminder), admins only. */
  inviteReminder?: InviteReminder | null
  /**
   * `mcp` and `both` modes: the AI apps connected to Tempo by name, or null while not known yet. Left out (legacy), the
   * browser's own AI connection (settings.ai) decides whether "Pick your AI" is done.
   */
  aiApps?: string[] | null
  /**
   * With `aiApps` (`both` mode): an API key is saved and in use, so Tempo writes the descriptions itself and the step
   * is done even with no Claude connected. In `mcp` mode there is no key, so it stays false.
   */
  aiKey?: boolean
}

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
  result: string | null
  action: GuideAction
}

export interface NextStep {
  kind: 'ai' | 'review' | 'secrets' | 'owners' | 'invites'
  text: string
  button: string
  action: GuideAction
  health: { kind: 'secrets' | 'no-owner'; label: string } | null
}

/** Only observed facts complete setup. No draft text. */
export function nextStep(snapshot: GuideSnapshot) {
  const { settings, projects, members, workspace, githubLogin, githubConnected, me = null, aiApps } = snapshot
  const p: string = settings.ai.provider
  const mcp = aiApps !== undefined
  // mcp/both: Claude connected, or (both) a key in use. Legacy: the browser's own connection.
  const keyed = mcp ? snapshot.aiKey === true : p !== 'demo' && p !== 'none'
  const aiConnected = mcp ? !!aiApps?.length || keyed : keyed
  const providerName = mcp ? [...new Set(aiApps ?? []), ...(keyed ? ['API key'] : [])].join(', ')
    : p === 'anthropic' ? 'Claude' : p === 'local' ? 'Claude Code'
      : PRESETS.find((preset) => preset.id === settings.ai.preset)?.label ?? 'Custom endpoint'
  // "Connect Claude" while Claude is the way to go; once a key is in use the step is just "Pick your AI", done.
  const aiLabel = mcp && !keyed ? connectLabel() : 'Pick your AI'
  const personal = isPersonal(workspace)
  const apps = projects.filter((app) => !app.archived)
  const editableApps = !workspace ? apps : apps.filter((app) => canEditApp(me, app))
  const unchecked = editableApps.filter((app) => isUncheckedAICard(app.appCard))
  const checkedCount = editableApps.length - unchecked.length
  const manager = !workspace || canManagePeople(me)
  // The selected flags don't depend on age; a fixed clock keeps this helper pure.
  const flagged = apps.map((app) => ({ app, flags: healthFlags(app, members, new Date(0), { personal, keptAt: app.keptAt }) }))
  const unowned = flagged.filter(({ flags }) => flags.some((flag) => flag.kind === 'no-owner'))
  const secret = flagged.find(({ flags }) => flags.some((flag) => flag.kind === 'secrets'))?.app
  const ownerResult = `${unowned.length} ${unowned.length === 1 ? 'app has' : 'apps have'} no owner`
  const ownerAction: GuideAction = { kind: 'owners', projectId: unowned[0]?.app.id ?? null }
  const checklist: ChecklistItem[] = [
    { id: 'github', label: 'Connect GitHub', done: githubConnected && !!githubLogin, result: githubConnected ? githubLogin : null, action: { kind: 'github' } },
    { id: 'ai', label: aiLabel, done: aiConnected, result: aiConnected ? providerName : null, action: { kind: 'ai' } },
    { id: 'apps', label: 'Find your apps', done: apps.length > 0, result: apps.length ? `${apps.length} ${apps.length === 1 ? 'app' : 'apps'}` : null, action: { kind: 'apps' } },
    ...(manager || editableApps.length ? [{ id: 'review', label: 'Check the cards', done: editableApps.length > 0 && unchecked.length === 0, result: editableApps.length ? `${checkedCount} of ${editableApps.length} checked` : null, action: { kind: 'review' } as GuideAction }] : []),
    ...(!personal && manager ? [{ id: 'owners', label: 'Assign owners', done: apps.length > 0 && unowned.length === 0, result: !apps.length ? null : unowned.length ? ownerResult : 'Every app owned', action: ownerAction }] : []),
  ]

  let next: NextStep | null = null
  // No apps yet: the empty portfolio's own button is the one next step.
  if (!apps.length) next = null
  else if (secret) {
    // A key file is also a secrets flag. Don't call it a .env file without evidence.
    const hasEnv = secret.signals?.secretFiles.some((file) => /(^|\/)\.env(?:\.|$)/.test(file))
    const editable = !workspace || canEditApp(me, secret)
    next = { kind: 'secrets', text: `${hasEnv ? 'A .env file' : 'A secret file'} is committed in ${secret.name}.`, button: editable ? 'See the fix' : 'View details', action: { kind: 'app', projectId: secret.id }, health: { kind: 'secrets', label: 'Committed secret' } }
  // In mcp mode, while the connected apps are still loading, don't suggest connecting one.
  } else if (!aiConnected && aiApps !== null) next = { kind: 'ai', text: 'Your cards show facts only.', button: aiLabel, action: { kind: 'ai' }, health: null }
  else if (unchecked.length) next = {
    kind: 'review',
    text: `Tempo drafted ${unchecked.length} app card${unchecked.length === 1 ? '' : 's'}.`,
    button: 'Check them',
    action: { kind: 'review' },
    health: null,
  }
  else if (manager && unowned.length) next = { kind: 'owners', text: `${ownerResult}.`, button: 'Assign owners', action: ownerAction, health: { kind: 'no-owner', label: 'No owner' } }
  else if (manager && snapshot.inviteReminder) next = { kind: 'invites', text: snapshot.inviteReminder.text, button: snapshot.inviteReminder.kind === 'new-link' ? 'Make a new link' : 'Send it again', action: { kind: 'invites' }, health: null }

  const done = checklist.filter((item) => item.done).length
  return { checklist, done, total: checklist.length, complete: done === checklist.length, next }
}
