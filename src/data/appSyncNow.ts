// The app page's "Sync now": read the repo, refresh the card (saved at once with auto-apply, otherwise shown for review),
// then, when the person's own AI key writes for them (canWriteCards), add tasks for the problems no open task covers
// (src/ai/keyTasks.ts). A tasks failure never undoes the synced card.
import { useStore } from '../store/useStore'
import { aiSyncApp, type SyncOutcome } from '../ai/router'
import { aiWriteTasks, appWantsTasks } from '../ai/keyTasks'
import { canWriteCards } from '../ai/workspaceAI'
import { useUI } from '../components/uiState'

export interface SyncNowIO {
  /** Runs the sync behind the GitHub connection gate; undefined when the person didn't connect. */
  run: (action: () => Promise<SyncOutcome>) => Promise<SyncOutcome | undefined>
  /** The repo's issues, pulls and commits as just read. */
  onFacts: (out: SyncOutcome) => void
  /** The card is waiting for the person to apply it (auto-apply is off). */
  onReview: (out: SyncOutcome) => void
  /** The tasks step is running (true) or over (false): the button reads "Adding tasks…". */
  onAddingTasks: (adding: boolean) => void
}

const tasksNotice = (n: number) => `Added ${n} task${n === 1 ? '' : 's'}`

/** Throws when the sync itself fails; the card step is done and shown before the tasks step starts. */
export async function syncAppNow(projectId: string, io: SyncNowIO): Promise<void> {
  const out = await io.run(() => aiSyncApp(projectId))
  if (!out) return
  io.onFacts(out)
  const store = useStore.getState()
  const current = store.projects.find((p) => p.id === projectId)
  // A repo made private on GitHub clears its flag on this sync, as the fix panel promises.
  if (current?.repo && current.repo.fullName === out.facts.meta.fullName && current.repo.private !== out.facts.meta.private) {
    store.updateProject(projectId, { repo: { ...current.repo, private: out.facts.meta.private } })
  }
  let applied = false
  if (useStore.getState().projects.find((p) => p.id === projectId)?.autoApply) {
    useStore.getState().commitSync(projectId, { card: out.card, signals: out.signals, source: out.source })
    applied = true
  } else {
    io.onReview(out)
  }

  // With a key Tempo writes the tasks too, once the card step worked (an AI that just failed would fail again).
  const after = useStore.getState()
  const mine = after.projects.find((p) => p.id === projectId)
  const writes = !out.error && !!mine && canWriteCards(after.settings) && appWantsTasks(mine, after.members)
  const card = applied ? 'Card refreshed' : null
  if (!writes) {
    if (card) useUI.getState().notify(card, 'success')
    return
  }
  io.onAddingTasks(true)
  let written = 0
  let failed = false
  try {
    written = (await aiWriteTasks(projectId)).written
  } catch {
    failed = true
  } finally {
    io.onAddingTasks(false)
  }
  if (failed) useUI.getState().notify(card ? "Card refreshed, but Tempo couldn't add tasks this time." : "Synced, but Tempo couldn't add tasks this time.")
  else if (written) useUI.getState().notify([card, tasksNotice(written)].filter(Boolean).join(' · '), 'success')
  else if (card) useUI.getState().notify(card, 'success')
}
