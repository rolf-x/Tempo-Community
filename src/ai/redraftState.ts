import { create } from 'zustand'

interface RedraftState {
  writingIds: Set<string>
  startWriting: (ids: string[]) => void
  finishWriting: (id: string) => void
  reset: () => void
}

/** Transient card-writing state. The app cards themselves stay in the persisted workspace store. */
export const useRedraftState = create<RedraftState>()((set) => ({
  writingIds: new Set(),
  startWriting: (ids) => set((state) => ({ writingIds: new Set([...state.writingIds, ...ids]) })),
  finishWriting: (id) => set((state) => {
    const writingIds = new Set(state.writingIds)
    writingIds.delete(id)
    return { writingIds }
  }),
  reset: () => set({ writingIds: new Set() }),
}))
