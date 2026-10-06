// mcp and both modes: when Tempo tells a person Claude isn't connected. The top banner shows while it isn't (until closed for this
// sign-in); the pop-up comes once per sign-in, decided as soon as the workspace and the connection list are in.
import type { ClaudeNotice } from '../components/guide/guideState'

/**
 * Are the notices on at all? Claude (MCP) is on (`mcp` and `both`), the person is signed in to a real workspace (not the
 * demo), and no API key writes the descriptions: with a key (`both`) Claude is optional, for the tasks it adds, so
 * Tempo doesn't nag; Settings → Connect your AI is where to connect it.
 */
export const claudeNoticeOn = (input: { mcp: boolean; keyed: boolean; signedIn: boolean; demo: boolean; userId: string | null }): boolean =>
  input.mcp && !input.keyed && input.signedIn && !input.demo && !!input.userId

export interface ClaudeNoticeInput {
  /** mcp mode, signed in, not the demo, the workspace loaded. */
  on: boolean
  /** claudeConnected(): null until a read of the connected apps comes back. */
  connected: boolean | null
  /** The workspace has a real app. Before that, the first visit asks for apps first, then Claude. */
  hasApps: boolean
  /** SessionUser.lastSignInAt: a new value is a new sign-in. */
  signIn: string | null
  notice: ClaudeNotice | undefined
}

export interface ClaudeNoticeView {
  banner: boolean
  /** Open the pop-up now. */
  remind: boolean
  /** The pop-up check is settled for this sign-in (shown or not): remember it, so it never comes later in the same sign-in. */
  settle: boolean
}

export function claudeNotice({ on, connected, hasApps, signIn, notice }: ClaudeNoticeInput): ClaudeNoticeView {
  if (!on || connected === null) return { banner: false, remind: false, settle: false }
  const missing = !connected && hasApps
  const fresh = !!signIn && notice?.remindedFor !== signIn
  return {
    banner: missing && (!signIn || notice?.bannerHiddenFor !== signIn),
    remind: missing && fresh,
    settle: fresh,
  }
}
