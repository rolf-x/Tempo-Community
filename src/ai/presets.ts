import type { Preset } from '../types'

export type AIProviderId = Preset | 'claude'

export interface ProviderPreset {
  id: AIProviderId
  label: string
  /** Short name used on the logo picker. */
  panelLabel: string
  provider: 'anthropic' | 'openai-compatible'
  baseUrl: string
  needsKey: boolean
  /** Where to get a key; null when there's nothing to sign up for. */
  keyUrl: string | null
  /** Where to add API credit; null for local or user-supplied providers. */
  billingUrl: string | null
  goodToKnow: string
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'openai', label: 'OpenAI', panelLabel: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys', billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    goodToKnow: 'Prepaid credit, separate from ChatGPT. The smallest top-up is $5.',
  },
  {
    id: 'claude', label: 'Claude', panelLabel: 'Claude', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true,
    keyUrl: 'https://platform.claude.com/settings/keys', billingUrl: 'https://platform.claude.com/settings/billing',
    goodToKnow: 'API credit is separate from a Claude subscription.',
  },
  {
    id: 'gemini', label: 'Google Gemini', panelLabel: 'Gemini', provider: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true,
    keyUrl: 'https://aistudio.google.com/api-keys', billingUrl: 'https://aistudio.google.com/projects',
    goodToKnow: 'Has a free tier, so you can start without paying.',
  },
  {
    id: 'openrouter', label: 'OpenRouter', panelLabel: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true,
    keyUrl: 'https://openrouter.ai/keys', billingUrl: 'https://openrouter.ai/settings/credits',
    goodToKnow: 'One key reaches models from many companies. Set a credit limit on the key.',
  },
  {
    // xAI's own API (api.x.ai) sends no CORS headers, so a browser can't call it (checked 4 Oct 2026).
    // OpenRouter serves the Grok models and allows browser calls, and the key still goes only to the provider picked.
    id: 'grok', label: 'Grok (through OpenRouter)', panelLabel: 'Grok', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true,
    keyUrl: 'https://openrouter.ai/keys', billingUrl: 'https://openrouter.ai/settings/credits',
    goodToKnow: 'xAI\u2019s own API doesn\u2019t accept calls from a browser, so Grok runs through OpenRouter. Use an OpenRouter key.',
  },
  {
    id: 'groq', label: 'Groq', panelLabel: 'Groq', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true,
    keyUrl: 'https://console.groq.com/keys', billingUrl: 'https://console.groq.com/settings/billing',
    goodToKnow: 'Free tier to start. Adding a card raises the limits.',
  },
  {
    id: 'ollama', label: 'Ollama (local)', panelLabel: 'Ollama', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', needsKey: false,
    keyUrl: 'https://ollama.com/download', billingUrl: null,
    goodToKnow: 'Runs on your own computer. Set OLLAMA_ORIGINS to Tempo\u2019s address.',
  },
  {
    id: 'custom', label: 'Custom endpoint', panelLabel: 'Custom', provider: 'openai-compatible', baseUrl: '', needsKey: true,
    keyUrl: null, billingUrl: null,
    goodToKnow: 'Any OpenAI-compatible endpoint: its base URL plus a key.',
  },
]

/** The first-run picker order from the key guide. Groq stays a preset for saved settings but leaves the picker:
 * people confused it with Grok, and OpenRouter serves the same open models. */
export const PANEL_PRESETS = ['claude', 'openai', 'gemini', 'grok', 'openrouter', 'ollama', 'custom']
  .map((id) => PRESETS.find((preset) => preset.id === id)!)
