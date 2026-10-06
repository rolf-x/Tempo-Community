// Single app-portfolio store. Persisted to IndexedDB.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import type { Activity, AISettings, AppCard, Member, PersistedState, Project, RepoSignals, Settings, Workspace } from '../types'
import { activityId, connectionId, projectId } from '../lib/ids'
import { appDefaults } from '../lib/model'
import { SYNC_NO_CHANGES, withoutRetiredActivity } from '../lib/activityFeed'
import { matchMember } from '../ai/tools/matchMember'
import { makeMember, migrateV1, ME_NAME } from './migrate'
import { makeDefault, migrateConnections, removeConnection, saveConnection } from '../ai/connections'

const memory = new Map<string, string>()
const storage: StateStorage = typeof indexedDB === 'undefined'
  ? { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value), removeItem: (key) => void memory.delete(key) }
  : { getItem: async (key) => (await get<string>(key)) ?? null, setItem: (key, value) => set(key, value), removeItem: (key) => del(key) }

const isDev = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV

export const defaultSettings = (): Settings => ({
  ai: { provider: isDev ? 'local' : 'none', preset: null, baseUrl: null, apiKey: null, model: null },
  aiConnections: [],
  aiDefaultId: null,
  theme: 'dark',
  teamSize: 5,
  onboarded: false,
  demo: false,
})

export interface Undo {
  label: string
  restore: () => void
}

export interface StoreState extends PersistedState {
  undo: Undo | null
  hydrated: boolean
  createProject: (project: Partial<Omit<Project, 'id' | 'createdAt'>> & { name: string }) => Project
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void
  /** Everything but the AI connection, which only the AI actions below change, so the default and settings.ai stay in step. */
  setSettings: (patch: Partial<Omit<Settings, 'ai' | 'aiConnections' | 'aiDefaultId'>>) => void
  /** For providers that aren't saved connections (local, demo, none); a saved default stops being the default. */
  setAI: (patch: Partial<AISettings>) => void
  /** Adds a saved API connection, or replaces the one with `id`; returns its id and whether Tempo now uses it. */
  saveAIConnection: (ai: AISettings, options?: { id?: string; makeDefault?: boolean }) => { id: string; isDefault: boolean }
  setDefaultAIConnection: (id: string) => void
  removeAIConnection: (id: string) => void
  setUndo: (undo: Undo | null) => void
  ensureMember: (name: string) => string
  addMember: (member: Partial<Member> & { name: string }) => Member
  updateMember: (id: string, patch: Partial<Member>) => void
  setMemberLeavingOn: (id: string, leavingOn: string | null) => void
  addActivity: (activity: Omit<Activity, 'id'> | Omit<Activity, 'id'>[]) => void
  setWorkspace: (workspace: Workspace | null) => void
  checkCard: (projectId: string) => void
  checkAllCards: (ids: string[]) => void
  checkHandover: (projectId: string) => void
  editCard: (projectId: string, patch: Partial<Pick<AppCard, 'what' | 'who'>>) => void
  commitSync: (projectId: string, result: { card: Omit<AppCard, 'updatedAt' | 'source'>; signals: RepoSignals; source: AppCard['source'] }, acceptCardDraft?: boolean) => void
  replaceData: (data: Pick<PersistedState, 'projects'> & Partial<Pick<PersistedState, 'members' | 'activity'>>) => void
  resetAll: () => void
}

const freshPeople = (): Pick<PersistedState, 'members' | 'meId'> => {
  const me = makeMember(ME_NAME, { role: 'owner', leavingOn: null })
  return { members: [me], meId: me.id }
}

export const useStore = create<StoreState>()(
  persist(
    (setState, getState) => ({
      version: 3,
      projects: [],
      ...freshPeople(),
      activity: [],
      workspace: null,
      settings: defaultSettings(),
      undo: null,
      hydrated: false,

      createProject: (input) => {
        const project: Project = {
          id: projectId(), emoji: '📁', color: 'violet', description: '', archived: false, ...appDefaults(),
          ...input, createdAt: new Date().toISOString(),
        }
        setState((state) => ({ projects: [...state.projects, project] }))
        return project
      },
      updateProject: (id, patch) => setState((state) => ({ projects: state.projects.map((project) => project.id === id ? { ...project, ...patch, id } : project) })),
      deleteProject: (id) => {
        const project = getState().projects.find((item) => item.id === id)
        if (!project) return
        setState((state) => ({
          projects: state.projects.filter((item) => item.id !== id),
          undo: { label: `Deleted “${project.name}”`, restore: () => setState((current) => ({ projects: [...current.projects, project], undo: null })) },
        }))
      },
      setSettings: (patch) => setState((state) => {
        const { ai: _ai, aiConnections: _list, aiDefaultId: _id, ...rest } = patch as Partial<Settings>
        return { settings: { ...state.settings, ...rest } }
      }),
      // Not a saved connection, so no saved one is the default any more (a saved key is chosen with setDefaultAIConnection).
      setAI: (patch) => setState((state) => ({ settings: { ...state.settings, ai: { ...state.settings.ai, ...patch }, aiDefaultId: null } })),
      saveAIConnection: (ai, options = {}) => {
        const next = saveConnection(getState().settings, ai, { ...options, newId: connectionId, now: new Date().toISOString() })
        const { id, ...connections } = next
        setState((state) => ({ settings: { ...state.settings, ...connections } }))
        return { id, isDefault: connections.aiDefaultId === id }
      },
      setDefaultAIConnection: (id) => setState((state) => ({ settings: { ...state.settings, ...makeDefault(state.settings, id) } })),
      removeAIConnection: (id) => setState((state) => ({ settings: { ...state.settings, ...removeConnection(state.settings, id) } })),
      setUndo: (undo) => setState({ undo }),
      ensureMember: (name) => matchMember(name, getState().members) ?? getState().addMember({ name: name.trim().replace(/^@/, '') }).id,
      addMember: (input) => {
        const member = makeMember(input.name, { leavingOn: null, ...input })
        setState((state) => ({ members: [...state.members, member] }))
        return member
      },
      updateMember: (id, patch) => setState((state) => ({ members: state.members.map((member) => member.id === id ? { ...member, ...patch, id } : member) })),
      setMemberLeavingOn: (id, leavingOn) => setState((state) => ({ members: state.members.map((member) => member.id === id ? { ...member, leavingOn } : member) })),
      addActivity: (input) => {
        const items = (Array.isArray(input) ? input : [input]).map((item) => ({ ...item, id: activityId() }))
        setState((state) => ({ activity: [...items, ...state.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500) }))
      },
      setWorkspace: (workspace) => setState({ workspace }),
      checkCard: (id) => {
        const now = new Date().toISOString()
        setState((state) => ({ projects: state.projects.map((project) => project.id === id && project.appCard
          ? { ...project, appCard: { ...project.appCard, checkedAt: now, checkedBy: state.meId } }
          : project) }))
      },
      checkAllCards: (ids) => {
        const wanted = new Set(ids)
        const now = new Date().toISOString()
        setState((state) => ({ projects: state.projects.map((project) => wanted.has(project.id) && project.appCard
          ? { ...project, appCard: { ...project.appCard, checkedAt: now, checkedBy: state.meId } }
          : project) }))
      },
      checkHandover: (id) => {
        const now = new Date().toISOString()
        setState((state) => ({ projects: state.projects.map((project) => project.id === id && project.handover
          ? { ...project, handover: { ...project.handover, checkedAt: now, checkedBy: state.meId } }
          : project) }))
      },
      editCard: (id, patch) => {
        const fields = (['what', 'who'] as const).filter((field) => patch[field] !== undefined)
        if (!fields.length) return
        const now = new Date().toISOString()
        setState((state) => ({ projects: state.projects.map((project) => {
          if (project.id !== id || !project.appCard) return project
          const editedFields = [...new Set([...(project.appCard.editedFields ?? []), ...fields])]
          return { ...project, appCard: { ...project.appCard, ...patch, editedFields, checkedAt: now, checkedBy: state.meId, updatedAt: now } }
        }) }))
      },
      commitSync: (id, { card, signals, source }, acceptCardDraft = false) => {
        const now = new Date().toISOString()
        const current = getState().projects.find((project) => project.id === id)?.appCard
        const keepAICard = source === 'fallback' && current?.source === 'ai'
        const edited = acceptCardDraft ? [] : (current?.editedFields ?? [])
        const nextCard = {
          ...card,
          ...(edited.includes('what') && current ? { what: current.what } : {}),
          ...(edited.includes('who') && current ? { who: current.who } : {}),
        }
        const unchanged = !!current && current.what === nextCard.what && current.who === nextCard.who && current.stage === nextCard.stage && current.status === nextCard.status
        const keepApproval = source === 'ai' && unchanged && !!current?.checkedAt
        const protectedCard = keepAICard ? current : {
          ...nextCard,
          editedFields: edited.length ? edited : undefined,
          checkedAt: source === 'ai' ? (keepApproval ? current.checkedAt : null) : (card.checkedAt ?? now),
          checkedBy: source === 'ai' ? (keepApproval ? current.checkedBy : null) : card.checkedBy,
          updatedAt: now,
          source,
        }
        getState().updateProject(id, { appCard: protectedCard, signals })
        getState().addActivity({ projectId: id, kind: 'sync', actor: 'Tempo', url: null, at: now, title: SYNC_NO_CHANGES })
      },
      replaceData: ({ projects, members, activity }) => setState((state) => ({ projects, members: members ?? state.members, activity: activity ?? state.activity, undo: null })),
      resetAll: () => setState({ projects: [], ...freshPeople(), activity: [], workspace: null, settings: defaultSettings(), undo: null }),
    }),
    {
      name: 'tempo',
      version: 6,
      storage: createJSONStorage(() => storage),
      migrate: (old, version) => {
        let state = (version < 2 ? migrateV1(old as never) : old) as StoreState & { tasks?: unknown; today?: unknown }
        const { tasks: _tasks, today: _today, ...withoutTasks } = state
        state = { ...withoutTasks, version: 3 } as StoreState
        if (version < 4 && state.settings?.theme === 'light') state = { ...state, settings: { ...state.settings, theme: 'dark' } }
        if (!state.settings?.demo && state.settings?.ai?.provider === 'demo') {
          state = { ...state, settings: { ...state.settings, ai: { ...state.settings.ai, provider: 'none' as const } } }
        }
        // v6: one AI connection became a list of saved ones with a default; the old one becomes the first.
        if (version < 6) {
          // Fill anything an old copy lacks (even settings.ai) before moving its connection into the list; the list
          // itself comes from migrateConnections, not from the defaults, or the old connection would be skipped.
          const { aiConnections: _list, aiDefaultId: _id, ...defaults } = defaultSettings()
          const settings = { ...defaults, ...state.settings }
          state = { ...state, settings: { ...settings, ...migrateConnections(settings, connectionId, new Date().toISOString()) } }
        }
        return state
      },
      // On every load, not once: an old tab can still save entries of a kind that no longer exists (coding-agent updates).
      merge: (saved, current) => {
        const copy = saved as Partial<StoreState> | undefined
        return { ...current, ...copy, ...(Array.isArray(copy?.activity) ? { activity: withoutRetiredActivity(copy.activity) } : {}) }
      },
      partialize: (state) => ({
        version: state.version, projects: state.projects, members: state.members, activity: state.activity,
        meId: state.meId, workspace: state.workspace, settings: state.settings,
      }),
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
)
