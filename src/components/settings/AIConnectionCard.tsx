// Settings → API keys. Tempo calls the AI itself with the person's own key. Several keys can be saved; the default
// one writes every app card and handover pack (it is copied into Settings.ai, which every AI call reads). Each key
// stays in this browser. The Connect your AI picker's "API key" choice scrolls here.
import { useEffect, useState } from 'react'
import { Check, KeyRound, Plus, Server } from 'lucide-react'
import { testConnection } from '../../ai/client'
import { connectionName, savedConnections } from '../../ai/connections'
import { useStore } from '../../store/useStore'
import type { AISettings, SavedAIConnection } from '../../types'
import { AIErrorNotice } from '../ai/AIErrorNotice'
import { AIConnectionForm, LOGO } from '../ai/AIConnectionForm'
import { providerIdFor } from '../ai/providerSettings'
import { Button, EmptyState, Modal } from '../ui'
import { useUI } from '../uiState'
import { Section } from './Section'

const DEV = import.meta.env.DEV

/** The card's anchor: the Connect your AI picker's "API key" choice scrolls here. */
export const AI_CONNECTION_ID = 'ai-connection'

/** Sent on window by the picker's "Set up an API key": the card opens its Add dialog. */
export const ADD_API_KEY_EVENT = 'tempo:add-api-key'

const LOCAL: AISettings = { provider: 'local', preset: null, baseUrl: null, apiKey: null, model: null }

export function AIConnectionCard() {
  const settings = useStore((state) => state.settings)
  const setAI = useStore((state) => state.setAI)
  const saveAIConnection = useStore((state) => state.saveAIConnection)
  const setDefaultAIConnection = useStore((state) => state.setDefaultAIConnection)
  const removeAIConnection = useStore((state) => state.removeAIConnection)
  const [editing, setEditing] = useState<SavedAIConnection | 'new' | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const connections = savedConnections(settings)
  const notify = useUI.getState().notify

  useEffect(() => {
    const open = () => setEditing('new')
    window.addEventListener(ADD_API_KEY_EVENT, open)
    return () => window.removeEventListener(ADD_API_KEY_EVENT, open)
  }, [])

  const save = (ai: AISettings) => {
    const id = editing && editing !== 'new' ? editing.id : undefined
    const { isDefault } = saveAIConnection(ai, { id })
    setEditing(null)
    notify(isDefault ? `${connectionName(ai)} saved. Tempo uses it for every app card.` : `${connectionName(ai)} saved. Make it the default to use it.`, 'success')
    return isDefault
  }

  const makeDefault = (item: SavedAIConnection) => {
    setDefaultAIConnection(item.id)
    notify(`${connectionName(item.ai)} is now the default.`, 'success')
  }

  const remove = (item: SavedAIConnection) => {
    removeAIConnection(item.id)
    setConfirmId(null)
    notify(`${connectionName(item.ai)} removed. Its key is deleted from this browser.`, 'success')
  }

  return (
    <Section
      id={AI_CONNECTION_ID}
      title="API keys"
      description="Tempo calls the AI itself with your own key. Save as many as you like; the default one writes every app card and handover."
    >
      {settings.demo && settings.ai.provider === 'demo' && (
        <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-text-muted">Sample mode is on, so the sample apps use canned results and make no network calls.</p>
      )}
      <SavedConnectionsList
        connections={connections}
        defaultId={settings.aiDefaultId ?? null}
        confirmId={confirmId}
        onMakeDefault={makeDefault}
        onEdit={(item) => setEditing(item)}
        onAskRemove={setConfirmId}
        onCancelRemove={() => setConfirmId(null)}
        onRemove={remove}
      />
      <Button variant={connections.length ? 'secondary' : 'primary'} icon={Plus} onClick={() => setEditing('new')}>Add an API key</Button>
      {DEV && <LocalConnection active={settings.ai.provider === 'local'} onUse={() => setAI(LOCAL)} />}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing === 'new' ? 'Add an API key' : editing ? `Edit ${connectionName(editing.ai)}` : ''}
        description={editing === 'new' ? 'Pick the provider, paste a key and choose the model. Your key stays in this browser.' : 'Change the key or the model.'}
      >
        {editing && (
          <AIConnectionForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? undefined : editing.ai}
            lockProvider={editing !== 'new'}
            onSave={save}
          />
        )}
      </Modal>
    </Section>
  )
}

export interface SavedConnectionsListProps {
  connections: SavedAIConnection[]
  defaultId: string | null
  confirmId: string | null
  onMakeDefault: (item: SavedAIConnection) => void
  onEdit: (item: SavedAIConnection) => void
  onAskRemove: (id: string) => void
  onCancelRemove: () => void
  onRemove: (item: SavedAIConnection) => void
}

/** The saved keys: provider, model, which one is the default, and Make default / Edit / Remove. */
export function SavedConnectionsList({ connections, defaultId, confirmId, onMakeDefault, onEdit, onAskRemove, onCancelRemove, onRemove }: SavedConnectionsListProps) {
  if (!connections.length) {
    return <EmptyState compact icon={KeyRound} title="No API key saved" body="App cards show repo facts only until you add a key or connect an AI app." className="rounded-lg border border-dashed border-border" />
  }
  return (
    <ul aria-label="Saved API keys">
      {connections.map((item) => {
        const isDefault = item.id === defaultId
        const confirming = confirmId === item.id
        const name = connectionName(item.ai)
        const logo = LOGO[providerIdFor(item.ai) ?? 'custom']
        return (
          <li key={item.id} className="border-b border-border py-2.5 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text">
                  {logo ? <img src={logo} alt="" className="size-4 dark:invert" /> : <Server className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                    {name}
                    {isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                        <Check className="size-3" strokeWidth={2.5} aria-hidden />Default
                      </span>
                    )}
                  </p>
                  <p className="break-all font-mono text-xs text-text-muted">{item.ai.model ?? 'Recommended model'}</p>
                </div>
              </div>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="danger" onClick={() => onRemove(item)}>Remove key</Button>
                  <Button size="sm" variant="ghost" onClick={onCancelRemove}>Cancel</Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {!isDefault && <Button size="sm" variant="secondary" onClick={() => onMakeDefault(item)}>Make default</Button>}
                  <Button size="sm" variant="ghost" onClick={() => onEdit(item)} aria-label={`Edit ${name}`}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => onAskRemove(item.id)} aria-label={`Remove ${name}`}>Remove</Button>
                </div>
              )}
            </div>
            {confirming && (
              <p className="mt-2 text-xs text-text-muted">
                Its key is deleted from this browser.{isDefault && connections.length > 1 ? ' The next key becomes the default.' : isDefault ? ' App cards go back to repo facts only.' : ''}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Dev only: Claude Code on this machine through the local bridge, no key. Using it takes over from the default key. */
function LocalConnection({ active, onUse }: { active: boolean; onUse: () => void }) {
  const [testing, setTesting] = useState(false)
  const [connectedMs, setConnectedMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const test = async () => {
    setTesting(true)
    setConnectedMs(null)
    setError(null)
    const result = await testConnection(LOCAL)
    if (result.ok) setConnectedMs(result.ms)
    else setError(result.details ?? result.error)
    setTesting(false)
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-sm text-text-muted">
        Dev only: Claude Code through the local bridge on this machine. No key needed.{active ? ' Tempo uses it now; make a saved key the default to switch back.' : ''}
      </p>
      {connectedMs !== null && (
        <p aria-live="polite" className="text-sm font-medium text-success">
          Connected. Claude Code answered in {connectedMs < 1000 ? `${connectedMs} ms` : `${(connectedMs / 1000).toFixed(1)} s`}.
        </p>
      )}
      {error && <AIErrorNotice error={error} provider="local" className="text-danger" />}
      <div className="flex flex-wrap gap-2">
        {!active && <Button size="sm" onClick={onUse}>Use Claude Code (local)</Button>}
        <Button size="sm" variant="primary" loading={testing} onClick={() => void test()}>Test connection</Button>
      </div>
    </div>
  )
}
