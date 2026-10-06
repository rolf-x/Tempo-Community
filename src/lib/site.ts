// Which Tempo this is, from its address: live, staging or a dev server on this machine. One AI app can be connected to
// more than one, and their workspaces can share names (a staging test's drafts could land in live Tempo's workspace of
// the same name). So every name an AI app sees says which Tempo it is. Pure and import-free: the browser and the MCP
// server (api/) both use it.

export interface TempoSite {
  /** What people and AI apps call this Tempo: "Tempo", "Tempo (staging)" or "Tempo (local)". */
  label: string
  /** The one-word server name in AI apps' settings and commands: "tempo", "tempo-staging" or "tempo-local". */
  id: string
  /** Live Tempo: no suffix anywhere. */
  live: boolean
}

const LIVE: TempoSite = { label: 'Tempo', id: 'tempo', live: true }

/** From any address on the site (its origin, the MCP URL, a request URL). Anything unreadable counts as live. */
export function tempoSite(address: string): TempoSite {
  let host: string
  try {
    host = new URL(address).hostname.toLowerCase()
  } catch {
    return LIVE
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) {
    return { label: 'Tempo (local)', id: 'tempo-local', live: false }
  }
  // tempo-staging.vercel.app, or any staging.* / *-staging host.
  if (/(^|[.-])staging([.-]|$)/.test(host)) return { label: 'Tempo (staging)', id: 'tempo-staging', live: false }
  return LIVE
}
