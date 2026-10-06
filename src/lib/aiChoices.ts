// The two ways to get app descriptions written, in plain words (VITE_AI_MODE=both). Settings → Connect your AI and the
// picker's "API key" choice both read these, so the two places never disagree. The key is the full-automation choice
// (everything on sync: descriptions and tasks); Claude (MCP) works in its own app.

export interface AIChoice {
  title: string
  /** A short label next to the title, or null. */
  badge: string | null
  /** What it does. */
  body: string
  /** What it costs the person. */
  cost: string
}

/**
 * `app`: the one AI app the picker offers ("Claude"), or null when it offers several. The words stay the same either
 * way; only the name changes.
 */
export function aiChoices(app: string | null): { mcp: AIChoice; key: AIChoice; tasks: string; both: string } {
  const name = app ?? 'Your AI app'
  return {
    mcp: {
      title: `${name} (MCP)`,
      badge: null,
      body: `${name} works in its own app. Send it one message and it writes the descriptions and adds tasks.`,
      cost: app ? `Uses your ${app} plan.` : 'Uses your own AI plan.',
    },
    key: {
      title: 'API key',
      badge: 'Full automation',
      body: 'Tempo does it all itself whenever apps sync: it writes the descriptions and adds tasks. No message to send.',
      cost: 'You pay your AI provider for what it uses.',
    },
    tasks: 'Sync all shows its progress as it goes.',
    both: `Have both? The key does the writing on every sync, and you can still ask ${app ?? 'your AI app'} about your apps.`,
  }
}
