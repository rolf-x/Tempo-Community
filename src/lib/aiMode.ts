// How AI reaches Tempo. `VITE_AI_MODE` picks it at build time:
//   legacy  the user's own AI key in the browser (today's behaviour)
//   both    the key stays, and the Connect AI card shows the MCP setup too
//   mcp     no key and no AI calls from the browser; the user's AI client writes drafts through /api/mcp
// Anything else, or nothing, is legacy, so a typo never turns the key off.
// Two questions, two checks: `mcpEnabled()` asks "is the Claude (MCP) path on?" (both and mcp), and `aiMode() === 'mcp'`
// asks "does the browser make no AI calls at all?" (mcp only). Use the first for the Claude banner, window, guide step
// and wording; keep the second for the places that really mean "no key, no browser AI".

export type AIMode = 'legacy' | 'both' | 'mcp'

export function parseAIMode(value: unknown): AIMode {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return mode === 'both' || mode === 'mcp' ? mode : 'legacy'
}

export const aiMode = (): AIMode => parseAIMode(import.meta.env.VITE_AI_MODE)

/** The Claude (MCP) way is on: `both` and `mcp`. In `mcp` it is the only way; in `both` the API key sits next to it. */
export const mcpEnabled = (): boolean => aiMode() !== 'legacy'
