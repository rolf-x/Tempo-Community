import type { GuideAction } from '../../lib/nextStep'
import { mcpEnabled } from '../../lib/aiMode'
import { navigate, toHash } from '../../lib/router'
import { openAIPanel, openAssignOwners, openClaudeWindow, useUI } from '../uiState'

export function guideHref(action: GuideAction) {
  switch (action.kind) {
    case 'app': return toHash({ name: 'project', projectId: action.projectId, view: 'app' })
    case 'owners': return action.projectId ? toHash({ name: 'project', projectId: action.projectId, view: 'app' }) : toHash({ name: 'portfolio' })
    case 'apps': return toHash({ name: 'portfolio' })
    case 'review': return toHash({ name: 'review' })
    default: return toHash({ name: 'settings' })
  }
}

export function followGuide(action: GuideAction) {
  useUI.getState().setSidebarOpen(false)
  // mcp and both: picking an AI means connecting Claude, in the Claude window (connect, then the message). Only
  // legacy, where Claude isn't offered, opens the API key panel.
  if (action.kind === 'ai') mcpEnabled() ? openClaudeWindow('reconnect') : openAIPanel()
  else if (action.kind === 'apps') {
    navigate({ name: 'portfolio' })
    useUI.getState().setRepoPickerOpen(true)
  } else if (action.kind === 'owners') openAssignOwners()
  else window.location.hash = guideHref(action)
}
