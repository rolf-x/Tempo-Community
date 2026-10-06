// Small persisted state for health-flag decisions that do not belong in the shared Project type yet.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

const memory = new Map<string, string>()
const fallback: StateStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
}

interface FlagState {
  keptAt: Record<string, string>
  keepQuiet: (projectId: string, at?: string) => void
  clearQuiet: (projectId: string) => void
}

export const useFlagState = create<FlagState>()(
  persist(
    (set) => ({
      keptAt: {},
      keepQuiet: (projectId, at = new Date().toISOString()) => set((state) => ({ keptAt: { ...state.keptAt, [projectId]: at } })),
      clearQuiet: (projectId) => set((state) => {
        const keptAt = { ...state.keptAt }
        delete keptAt[projectId]
        return { keptAt }
      }),
    }),
    {
      name: 'tempo-flags',
      storage: createJSONStorage(() => (typeof localStorage === 'undefined' ? fallback : localStorage)),
      partialize: (state) => ({ keptAt: state.keptAt }),
    },
  ),
)
