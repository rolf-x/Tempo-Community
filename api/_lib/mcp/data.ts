// The MCP server's only way into the database: the five mcp_* functions (migrations 0017 and 0018), called with the signed-in
// person's own token so every membership and role rule applies. Never the service key.
import { createClient } from '@supabase/supabase-js'
import type { Activity, Member, Project, WorkspaceKind } from '../../../src/types'
import type { HandoverOut, ToolOutput } from '../../../src/ai/schemas'
import type { TaskDraft } from '../../../src/ai/tools/mcpDrafts'

export interface WorkspaceRef { id: string; name: string; kind: WorkspaceKind }
export interface WorkspaceApps { workspace: WorkspaceRef; me: string; members: Member[]; apps: Project[] }
export interface AppDetail { workspace: WorkspaceRef; me: string; members: Member[]; app: Project; activity: Activity[] }
export type CardDraft = ToolOutput<'sync_app'>['card']
export type { TaskDraft }

export interface TempoData {
  listApps(): Promise<WorkspaceApps[]>
  getApp(appId: string): Promise<AppDetail>
  submitCard(appId: string, card: CardDraft, client: string): Promise<void>
  submitHandover(appId: string, doc: HandoverOut, client: string): Promise<void>
  /** Replaces the app's open tasks with these (an empty list clears them); tasks already fixed stay. */
  submitTasks(appId: string, tasks: TaskDraft[], client: string): Promise<void>
}

/** A refusal or failure worded for the person reading the agent's answer. */
export class ToolError extends Error {
  /** The database's error code when the refusal came from it: 54000 is the 30-writes-a-minute limit. */
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

// The functions raise these codes with messages written for people; anything else stays vague.
const PLAIN = new Set(['P0002', '42501', '54000', '22023', '28000', 'PT403'])

export function toToolError(error: { code?: string; message?: string }): ToolError {
  return new ToolError(error.code && PLAIN.has(error.code) && error.message ? error.message : 'Tempo could not do that right now. Try again shortly.', error.code)
}

export function supabaseData(supabaseUrl: string, anonKey: string, token: string): TempoData {
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args)
    if (error) throw toToolError(error)
    return data as T
  }
  return {
    listApps: () => call<WorkspaceApps[]>('mcp_list_apps', {}),
    getApp: (appId) => call<AppDetail>('mcp_get_app', { p_app: appId }),
    submitCard: async (appId, card, client) => { await call('mcp_submit_card', { p_app: appId, p_card: card, p_client: client }) },
    submitHandover: async (appId, doc, client) => { await call('mcp_submit_handover', { p_app: appId, p_doc: doc, p_client: client }) },
    submitTasks: async (appId, tasks, client) => { await call('mcp_submit_tasks', { p_app: appId, p_tasks: tasks, p_client: client }) },
  }
}
