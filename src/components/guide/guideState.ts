import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface GuideProgress {
  checklistCollapsed: boolean
  /** "Let Claude write your cards" has been shown after a first repo scan (first visit only). */
  claudeStepShown?: boolean
}

export const EMPTY_GUIDE: GuideProgress = { checklistCollapsed: false }
export const guideScope = (workspaceId: string | null, userId: string | null, demo = false) =>
  JSON.stringify([demo ? 'sample' : 'workspace', workspaceId, userId])

/**
 * Per person, by sign-in (`SessionUser.lastSignInAt`): Claude isn't connected → one pop-up per sign-in, and the top
 * banner stays hidden until the next sign-in once closed.
 */
export interface ClaudeNotice {
  /** The sign-in the pop-up check already ran for (shown or not), so it never comes back in the same sign-in. */
  remindedFor?: string
  /** The sign-in the banner was closed in. */
  bannerHiddenFor?: string
}

interface GuideState {
  workspaces: Record<string, GuideProgress>
  claude: Record<string, ClaudeNotice>
  setChecklistCollapsed: (scope: string, collapsed: boolean) => void
  setClaudeStepShown: (scope: string) => void
  setClaudeNotice: (userId: string, patch: ClaudeNotice) => void
}

export const useGuideState = create<GuideState>()(persist((set) => ({
  workspaces: {},
  claude: {},
  setChecklistCollapsed: (scope, checklistCollapsed) => set((state) => ({
    workspaces: { ...state.workspaces, [scope]: { ...(state.workspaces[scope] ?? EMPTY_GUIDE), checklistCollapsed } },
  })),
  setClaudeStepShown: (scope) => set((state) => ({
    workspaces: { ...state.workspaces, [scope]: { ...(state.workspaces[scope] ?? EMPTY_GUIDE), claudeStepShown: true } },
  })),
  setClaudeNotice: (userId, patch) => set((state) => ({ claude: { ...state.claude, [userId]: { ...state.claude[userId], ...patch } } })),
}), {
  name: 'tempo-guide',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ workspaces: state.workspaces, claude: state.claude }),
}))
