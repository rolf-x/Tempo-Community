// Transient UI state for overlays and notices. Not persisted. Import as `useUI`.
import { create } from 'zustand'
import { navigate } from '../lib/router'

export type ToastTone = 'neutral' | 'success' | 'danger'

/**
 * Why the Claude window is open (mcp mode): `first` after the first apps are in, `reconnect` when Claude isn't
 * connected (the top banner, or signing in again after a revoke), `sync` after Sync all to ask Claude for the cards.
 */
/** `again`: connect Claude again, though Tempo still sees it connected (a connector removed inside Claude). */
export type ClaudeWindowReason = 'first' | 'reconnect' | 'sync' | 'again'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface UIState {
  /** "Add apps from GitHub" repo picker */
  repoPickerOpen: boolean
  /** First-run and on-demand AI provider guide */
  aiPanelOpen: boolean
  commandOpen: boolean
  /** Mobile sidebar (below md). On desktop the sidebar is always visible. */
  sidebarOpen: boolean
  /** Settings → Connect your AI opens its picker when it shows, then clears this (openConnectAI). */
  connectAIRequested: boolean
  /** The Claude window (mcp mode): connect Claude, then the message to paste into it. null = closed. */
  claudeWindow: ClaudeWindowReason | null
  /** Sync all's progress window is open (its state lives in useSyncAll; SyncAllProgress mirrors it here). */
  syncWindowOpen: boolean
  /** The "Assign owners" window: every app with no owner, or whose owner left (openAssignOwners). */
  assignOwnersOpen: boolean
  /** One-off notice (not the undo toast; that lives in useStore().undo) */
  toast: Toast | null
  setRepoPickerOpen: (open: boolean) => void
  setAIPanelOpen: (open: boolean) => void
  setCommandOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setAssignOwnersOpen: (open: boolean) => void
  /** Opens the Claude window for a reason, or closes it with null. */
  setClaudeWindow: (reason: ClaudeWindowReason | null) => void
  /** Show a short notice for 4 s, e.g. notify('Copied', 'success') */
  notify: (message: string, tone?: ToastTone) => void
  dismissToast: () => void
  /** True when a modal-type overlay is open */
  anyModalOpen: () => boolean
  /** Esc: closes every overlay, the drawer and the mobile sidebar */
  closeAll: () => void
}

let toastSeq = 0

const NO_OVERLAYS = { repoPickerOpen: false, aiPanelOpen: false, commandOpen: false, claudeWindow: null as ClaudeWindowReason | null, assignOwnersOpen: false }

export const useUI = create<UIState>()((set, get) => ({
  repoPickerOpen: false,
  aiPanelOpen: false,
  commandOpen: false,
  sidebarOpen: false,
  connectAIRequested: false,
  claudeWindow: null,
  syncWindowOpen: false,
  assignOwnersOpen: false,
  toast: null,

  // Modals are exclusive, so overlays never stack.
  setRepoPickerOpen: (repoPickerOpen) => set(repoPickerOpen ? { ...NO_OVERLAYS, repoPickerOpen } : { repoPickerOpen }),
  // A side panel can sit over a running repo scan; modal overlays still close it through NO_OVERLAYS.
  setAIPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),
  setCommandOpen: (commandOpen) => set(commandOpen ? { ...NO_OVERLAYS, commandOpen } : { commandOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setAssignOwnersOpen: (assignOwnersOpen) => set(assignOwnersOpen ? { ...NO_OVERLAYS, assignOwnersOpen } : { assignOwnersOpen }),
  setClaudeWindow: (claudeWindow) => set(claudeWindow ? { ...NO_OVERLAYS, claudeWindow } : { claudeWindow }),
  notify: (message, tone = 'neutral') => set({ toast: { id: ++toastSeq, message, tone } }),
  dismissToast: () => set({ toast: null }),
  anyModalOpen: () => {
    const s = get()
    return s.repoPickerOpen || s.aiPanelOpen || s.commandOpen || s.claudeWindow !== null || s.syncWindowOpen || s.assignOwnersOpen
  },
  closeAll: () => set({ repoPickerOpen: false, aiPanelOpen: false, commandOpen: false, claudeWindow: null, assignOwnersOpen: false, sidebarOpen: false }),
}))

export const openAIPanel = () => useUI.getState().setAIPanelOpen(true)

/** Opens the Assign owners window (the next-step bar and the setup checklist). */
export const openAssignOwners = () => useUI.getState().setAssignOwnersOpen(true)

/** Opens the Claude window (mcp and both modes). */
export const openClaudeWindow = (reason: ClaudeWindowReason) => useUI.getState().setClaudeWindow(reason)

/** In `mcp` mode (and `both`, from the places that don't offer the API key), "Connect Claude" anywhere: go to Settings, where the Connect your AI picker opens. */
export function openConnectAI() {
  useUI.setState({ connectAIRequested: true, sidebarOpen: false })
  navigate({ name: 'settings' })
}
