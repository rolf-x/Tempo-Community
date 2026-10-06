// Mount point for the overlays. Each one reads its own open state from useUI():
//
//   <AIPanel />     uiState.aiPanelOpen     → setAIPanelOpen(false)
//   <CommandBar />  uiState.commandOpen     → setCommandOpen(false)
//   <ClaudeStep />  uiState.claudeWindow  → setClaudeWindow(null)
//   <AssignOwners /> uiState.assignOwnersOpen → setAssignOwnersOpen(false)
// Heavy overlays are code-split. Each mounts the first time it is opened and stays mounted
// afterwards so its exit animation can run; their chunks are warmed up when the browser is idle.
import { Suspense, lazy, useEffect, useState } from 'react'
import { whenIdle } from '../lib/idle'
import { useUI } from './uiState'

const load = {
  commandBar: () => import('./CommandBar').then((m) => ({ default: m.CommandBar })),
  repoPicker: () => import('./app/RepoPicker').then((m) => ({ default: m.RepoPicker })),
  aiPanel: () => import('./ai/AIPanel').then((m) => ({ default: m.AIPanel })),
  claudeStep: () => import('./onboarding/ClaudeStep').then((m) => ({ default: m.ClaudeStep })),
  assignOwners: () => import('./people/AssignOwners').then((m) => ({ default: m.AssignOwners })),
}
const CommandBar = lazy(load.commandBar)
const RepoPicker = lazy(load.repoPicker)
const AIPanel = lazy(load.aiPanel)
const ClaudeStep = lazy(load.claudeStep)
const AssignOwners = lazy(load.assignOwners)

/** True once `open` has ever been true. */
function useEverOpen(open: boolean) {
  const [ever, setEver] = useState(open)
  useEffect(() => {
    if (open) setEver(true)
  }, [open])
  return ever || open
}

export function OverlaySlots() {
  const commandBar = useEverOpen(useUI((s) => s.commandOpen))
  const repoPicker = useEverOpen(useUI((s) => s.repoPickerOpen))
  const aiPanel = useEverOpen(useUI((s) => s.aiPanelOpen))
  const claudeStep = useEverOpen(useUI((s) => s.claudeWindow !== null))
  const assignOwners = useEverOpen(useUI((s) => s.assignOwnersOpen))

  useEffect(() => whenIdle(() => Object.values(load).forEach((l) => void l()), 2000), [])

  return (
    <>
      {/* One boundary per overlay so a chunk still loading never hides a sibling that is open. */}
      <Suspense fallback={null}>{commandBar && <CommandBar />}</Suspense>
      <Suspense fallback={null}>{repoPicker && <RepoPicker />}</Suspense>
      <Suspense fallback={null}>{aiPanel && <AIPanel />}</Suspense>
      <Suspense fallback={null}>{claudeStep && <ClaudeStep />}</Suspense>
      <Suspense fallback={null}>{assignOwners && <AssignOwners />}</Suspense>
    </>
  )
}
