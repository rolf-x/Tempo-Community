import { defaultConnection } from '../../ai/connections'
import { useStore } from '../../store/useStore'
import type { AISettings } from '../../types'
import { Drawer } from '../ui'
import { useUI } from '../uiState'
import { AIConnectionForm } from './AIConnectionForm'
import { providerIdFor } from './providerSettings'

export function AIPanel() {
  const open = useUI((state) => state.aiPanelOpen)
  const setOpen = useUI((state) => state.setAIPanelOpen)
  const close = () => setOpen(false)
  const current = useStore((state) => defaultConnection(state.settings))
  // Opened again after a key is saved, it edits the default key instead of adding a second one; a different provider or
  // endpoint is saved as a new key and becomes the default.
  const save = (ai: AISettings) => {
    const same = current && providerIdFor(current.ai) === providerIdFor(ai) && current.ai.baseUrl === ai.baseUrl
    return useStore.getState().saveAIConnection(ai, { id: same ? current.id : undefined, makeDefault: true }).isDefault
  }

  return (
    <Drawer open={open} onClose={close} width={520} title="Which AI should write your app cards?">
      <div className="mx-auto w-full max-w-[520px] px-4 py-5 sm:px-5">
        <p className="text-sm leading-6 text-text-muted">Use the one you already pay for. Your key stays in this browser.</p>
        <AIConnectionForm key={open ? (current?.id ?? 'new') : 'closed'} className="mt-5" initial={current?.ai} onSave={save} showSkip onSkip={close} />
      </div>
    </Drawer>
  )
}
