import { useId, useMemo, useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Server } from 'lucide-react'
import claudeLogo from '../../assets/ai/claude.svg'
import geminiLogo from '../../assets/ai/gemini.svg'
import grokLogo from '../../assets/ai/grok.svg'
import ollamaLogo from '../../assets/ai/ollama.svg'
import openaiLogo from '../../assets/ai/openai.svg'
import openrouterLogo from '../../assets/ai/openrouter.svg'
import { aiErrorKind, listModels, testConnection, type AIErrorKind } from '../../ai/client'
import { resolveBaseUrl } from '../../ai/openaiCompatible'
import { redraftFactCards } from '../../ai/redraft'
import { useStore } from '../../store/useStore'
import type { AISettings } from '../../types'
import { Button, Input, Select, cn } from '../ui'
import { PANEL_PRESETS, modelsFor, providerIdFor, recommendedModel, settingsForProvider, type AIProviderId } from './providerSettings'

/** Provider logos (also used by the saved API keys list). */
export const LOGO: Partial<Record<AIProviderId, string>> = {
  claude: claudeLogo,
  openai: openaiLogo,
  gemini: geminiLogo,
  openrouter: openrouterLogo,
  grok: grokLogo,
  ollama: ollamaLogo,
}

interface Issue {
  message: string
  kind: AIErrorKind | 'models'
}

export interface AIConnectionFormProps {
  /** A saved connection to edit; without it the form starts on Claude with nothing filled in. */
  initial?: AISettings
  /** Editing: the provider stays as saved and its tiles are hidden. */
  lockProvider?: boolean
  /**
   * Called with a tested connection; returns whether Tempo now uses it (it is the default). Without it, the form
   * saves the connection as the default (the first-run panel).
   */
  onSave?: (ai: AISettings) => boolean
  onConnected?: () => void
  onSkip?: () => void
  showSkip?: boolean
  className?: string
}

const openNewTab = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

const saveAsDefault = (ai: AISettings) => useStore.getState().saveAIConnection(ai, { makeDefault: true }).isDefault

export function AIConnectionForm({ initial, lockProvider = false, onSave = saveAsDefault, onConnected, onSkip, showSkip = false, className }: AIConnectionFormProps) {
  const fieldId = useId()
  const initialId = (initial && providerIdFor(initial)) ?? 'claude'
  const [selectedId, setSelectedId] = useState<AIProviderId>(initialId)
  // A saved key is never put back into the page: the key field starts empty and the saved key is used while it stays
  // empty, but only for the same provider and endpoint it was saved for.
  const savedKey = initial && providerIdFor(initial) ? initial.apiKey : null
  const [draft, setDraft] = useState<AISettings>(() => (initial && providerIdFor(initial) ? { ...initial, apiKey: null } : settingsForProvider(initialId)))
  const withKey = (current: AISettings): AISettings =>
    current.apiKey || !savedKey || !initial || providerIdFor(current) !== initialId || current.baseUrl !== initial.baseUrl
      ? current
      : { ...current, apiKey: savedKey }
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [typedModel, setTypedModel] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [issue, setIssue] = useState<Issue | null>(null)
  /** After a save: 'used' when Tempo now uses it, 'saved' when it was kept next to the default. */
  const [connected, setConnected] = useState<'used' | 'saved' | null>(null)

  const preset = useMemo(() => PANEL_PRESETS.find((item) => item.id === selectedId)!, [selectedId])

  const patch = (next: Partial<AISettings>) => {
    setDraft((current) => ({ ...current, ...next }))
    setIssue(null)
    setConnected(null)
  }

  const choose = (id: AIProviderId) => {
    setSelectedId(id)
    setDraft(settingsForProvider(id))
    setModels([])
    setTypedModel(false)
    setIssue(null)
    setConnected(null)
    setShowKey(false)
  }

  const recover = (error: unknown, fallback: string): Issue => {
    const message = error instanceof Error ? error.message : fallback
    const kind = aiErrorKind(message)
    return kind === 'other' ? { message: fallback, kind: 'models' } : { message, kind }
  }

  const loadAccountModels = async (current = draft) => {
    setLoadingModels(true)
    setIssue(null)
    try {
      const list = modelsFor(selectedId, await listModels(withKey(current)))
      setModels(list)
      if (list.length === 0) {
        setIssue({ kind: 'models', message: "Couldn't load models. Type a model name instead." })
        return null
      }
      const model = current.model && list.includes(current.model) ? current.model : recommendedModel(selectedId, list)
      setTypedModel(false)
      setDraft((value) => ({ ...value, model }))
      return { ...current, model }
    } catch (error) {
      setIssue(recover(error, "Couldn't load models. Type a model name instead."))
      return null
    } finally {
      setLoadingModels(false)
    }
  }

  const save = async () => {
    if (preset.needsKey && !withKey(draft).apiKey) {
      setIssue({ kind: 'other', message: `Paste your ${preset.panelLabel} key, then test again.` })
      return
    }
    if (selectedId === 'custom' && !draft.baseUrl) {
      setIssue({ kind: 'other', message: 'Enter the base URL, then test again.' })
      return
    }
    if (selectedId === 'custom') {
      try {
        resolveBaseUrl(draft) // https only (plain http is for this computer): say so now, not as "couldn't load models"
      } catch (error) {
        setIssue({ kind: 'other', message: error instanceof Error ? error.message : 'Check the endpoint address, then test again.' })
        return
      }
    }
    setTesting(true)
    setIssue(null)
    setConnected(null)
    try {
      const loaded = typedModel && draft.model ? draft : await loadAccountModels(draft)
      if (!loaded) return
      const candidate = withKey(loaded)
      const result = await testConnection(candidate)
      if (!result.ok) {
        setIssue({ message: result.error, kind: aiErrorKind(result.error) })
        return
      }
      const used = onSave(candidate)
      setDraft((current) => ({ ...candidate, apiKey: current.apiKey })) // still only what was typed, never the saved key
      setConnected(used ? 'used' : 'saved')
      onConnected?.()
      if (used) void redraftFactCards()
    } finally {
      setTesting(false)
    }
  }

  const errorAction = issue?.kind === 'key-rejected' ? preset.keyUrl : issue?.kind === 'out-of-credit' ? preset.billingUrl : null
  const errorActionLabel = issue?.kind === 'key-rejected' ? 'Create a key' : 'Add credit'
  const keyLabel = selectedId === 'ollama' ? 'Install Ollama' : selectedId === 'custom' ? 'Get a key' : 'Create a key'

  return (
    <div className={cn('space-y-5', className)}>
      {!lockProvider && <div role="group" aria-label="AI providers" className="grid grid-cols-2 gap-2 min-[430px]:grid-cols-3">
        {PANEL_PRESETS.map((item) => {
          const logo = LOGO[item.id]
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selectedId === item.id}
              // A provider switch mid-request would let the old answer land on the new provider.
              disabled={testing || loadingModels}
              onClick={() => choose(item.id)}
              className={cn(
                'focus-ring flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors motion-reduce:transition-none',
                selectedId === item.id ? 'border-accent bg-accent-soft text-text' : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text',
              )}
            >
              {logo ? <img src={logo} alt="" className="size-5 shrink-0 dark:invert" /> : <Server className="size-5 shrink-0" aria-hidden />}
              <span className="truncate">{item.panelLabel}</span>
            </button>
          )
        })}
      </div>}

      <section aria-labelledby={`${fieldId}-guide`} className="rounded-xl border border-border bg-surface-2 p-4">
        <div className="flex items-start gap-3">
          {LOGO[selectedId] ? <img src={LOGO[selectedId]} alt="" className="mt-0.5 size-6 shrink-0 dark:invert" /> : <Server className="mt-0.5 size-6 shrink-0" aria-hidden />}
          <div className="min-w-0">
            <h3 id={`${fieldId}-guide`} className="text-sm font-semibold text-text">{preset.panelLabel}</h3>
            <p className="mt-0.5 text-xs leading-5 text-text-muted">{preset.goodToKnow}</p>
          </div>
        </div>

        <ol className="mt-4 space-y-4">
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
            <StepNumber>1</StepNumber>
            <div>
              <p className="text-sm font-medium text-text">{selectedId === 'ollama' ? 'Install Ollama' : 'Create a key'}</p>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">
                {selectedId === 'custom' ? 'Create a key with your provider.' : selectedId === 'ollama' ? 'Download Ollama and start it on this computer.' : `Name it “Tempo” so you can find it later.`}
              </p>
              {preset.keyUrl && <Button size="sm" icon={ExternalLink} className="mt-2" onClick={() => openNewTab(preset.keyUrl!)}>{keyLabel}</Button>}
            </div>
          </li>
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
            <StepNumber>2</StepNumber>
            <div>
              <p className="text-sm font-medium text-text">{selectedId === 'gemini' ? 'Add credit later' : preset.billingUrl ? 'Add credit' : 'Check billing'}</p>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">
                {selectedId === 'ollama' ? 'Nothing to pay. It runs on your computer.' : selectedId === 'custom' ? 'Use your provider’s billing page if it needs credit.' : selectedId === 'gemini' ? 'The free tier is enough to start. Add credit when you need higher limits.' : 'The API stops answering when the balance runs out.'}
              </p>
              {preset.billingUrl && <Button size="sm" icon={ExternalLink} className="mt-2" onClick={() => openNewTab(preset.billingUrl!)}>Add credit</Button>}
            </div>
          </li>
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
            <StepNumber>3</StepNumber>
            <div className="min-w-0">
              <label htmlFor={`${fieldId}-key`} className="text-sm font-medium text-text">
                {selectedId === 'ollama' ? 'Test the connection' : 'Paste the key'}
              </label>
              {selectedId === 'ollama' ? (
                <p className="mt-0.5 text-xs leading-5 text-text-muted">Set OLLAMA_ORIGINS to Tempo’s address, then test.</p>
              ) : (
                <div className="mt-2 flex min-w-0 gap-2">
                  <Input
                    id={`${fieldId}-key`}
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={savedKey && withKey(draft).apiKey === savedKey ? `Saved key ending ${savedKey.slice(-4)}. Paste a new one to replace it.` : `${preset.panelLabel} key`}
                    value={draft.apiKey ?? ''}
                    onChange={(event) => patch({ apiKey: event.target.value.trim() || null })}
                    invalid={issue?.kind === 'key-rejected'}
                    className="min-w-0"
                  />
                  <Button variant="ghost" icon={showKey ? EyeOff : Eye} onClick={() => setShowKey((value) => !value)} aria-label={showKey ? 'Hide key' : 'Show key'} aria-pressed={showKey} />
                </div>
              )}
              {selectedId === 'custom' && (
                <div className="mt-3">
                  <label htmlFor={`${fieldId}-base`} className="mb-1.5 block text-xs font-medium text-text-muted">Base URL</label>
                  <Input id={`${fieldId}-base`} type="url" spellCheck={false} placeholder="https://provider.example/v1" value={draft.baseUrl ?? ''} onChange={(event) => patch({ baseUrl: event.target.value.trim() || null })} />
                </div>
              )}
            </div>
          </li>
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
            <StepNumber>4</StepNumber>
            <div className="min-w-0">
              <label htmlFor={`${fieldId}-model`} className="text-sm font-medium text-text">Pick a model</label>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">
                {models.length > 0 ? 'Loaded from your account.' : 'Load the models your key can use, or type one. Leave it empty and testing picks a recommended one.'}
              </p>
              <div className="mt-2 flex min-w-0 flex-col gap-2 min-[430px]:flex-row">
                {models.length > 0 ? (
                  <Select id={`${fieldId}-model`} value={draft.model ?? ''} onChange={(event) => patch({ model: event.target.value || null })}>
                    {draft.model && !models.includes(draft.model) && <option value={draft.model}>{draft.model}</option>}
                    {models.map((model) => <option key={model} value={model}>{model}</option>)}
                  </Select>
                ) : (
                  <Input
                    id={`${fieldId}-model`}
                    spellCheck={false}
                    placeholder="Type a model name"
                    value={draft.model ?? ''}
                    onChange={(event) => {
                      setTypedModel(true)
                      patch({ model: event.target.value.trim() || null })
                    }}
                  />
                )}
                <Button loading={loadingModels} onClick={() => void loadAccountModels()}>Load models</Button>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <div aria-live="polite" className="min-h-5">
        {connected && (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <Check className="size-4" strokeWidth={2.5} aria-hidden />
            {connected === 'used' ? 'Connected. Writing your cards now.' : 'Saved. Make it the default to use it.'}
          </p>
        )}
        {issue && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <p>{issue.message}</p>
            {errorAction && <Button size="sm" icon={issue.kind === 'key-rejected' ? KeyRound : ExternalLink} className="mt-2" onClick={() => openNewTab(errorAction)}>{errorActionLabel}</Button>}
          </div>
        )}
        {!connected && !issue && draft.model && models.length > 0 && (
          <p className="text-xs leading-5 text-text-muted">Model: loaded from your account. Recommended one picked for you.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="primary" loading={testing} onClick={() => void save()}>Test and save</Button>
        {showSkip && <Button variant="ghost" onClick={onSkip}>Skip for now</Button>}
      </div>
    </div>
  )
}

function StepNumber({ children }: { children: string }) {
  return <span aria-hidden className="flex size-6 items-center justify-center rounded-full border border-border-strong font-mono text-xs text-text-muted">{children}</span>
}
