// The AI apps the Connect your AI card offers, how each one gets Tempo, and the connected-clients list. Pure.
import { formatCalendarDate, todayISO } from './dates'
import { tempoSite } from './site'

/** The address an AI client connects to: this site's own origin plus /api/mcp. */
export const mcpUrl = (origin: string): string => `${origin.replace(/\/+$/, '')}/api/mcp`

/** The AI brands in the picker. Each one has one or more ways in (its app, its terminal tool, its editor). */
export type AiBrandId = 'claude' | 'chatgpt' | 'gemini' | 'copilot' | 'cursor' | 'perplexity' | 'le-chat' | 'grok' | 'any'

/**
 * Set in localStorage by Tempo's consent page when someone clicks Allow, so an open Settings tab hears it through the
 * `storage` event at once. Timers in a background tab are slowed to about once a minute, so polling alone lags.
 */
export const ALLOWED_KEY = 'tempo.mcp.allowed'

/**
 * How a way in gets Tempo: a link that opens the app prefilled, one line to paste in a terminal, the address, or
 * nothing (a cloud app can't reach a local site).
 */
export type ConnectMethod =
  | { kind: 'link'; href: string; /** an https page (new tab), not an app's own link scheme */ web: boolean }
  | { kind: 'command'; command: string }
  | { kind: 'address' }
  | { kind: 'unavailable' }

export interface AiWay {
  id: string
  /** Short, for the switch between ways: "Claude app", "Claude Code". */
  name: string
  method: ConnectMethod
  /** What the person does, in order. Every working path ends on Tempo's Allow page. */
  steps: string[]
}

export interface AiBrand {
  id: AiBrandId
  name: string
  /** A few words under the name in the picker. */
  hint: string
  /** The first way is the one shown when the brand is picked. */
  ways: AiWay[]
}

const ALLOW = 'Your browser opens Tempo: click Allow.'
const ASK = "Then, in a repo that is in Tempo, ask it to draft the app's Tempo card."
const signIn = (app: string) => `Sign in to Tempo when ${app} asks, and click Allow.`

/** Base64 of UTF-8 text, as Cursor's install links expect. */
function base64(text: string): string {
  let bytes = ''
  for (const byte of new TextEncoder().encode(text)) bytes += String.fromCharCode(byte)
  return btoa(bytes)
}

/** The address as one shell word: left bare when it is plain, single-quoted otherwise (zsh globs "[::1]"). */
const shellWord = (text: string): string => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`)

/**
 * A chat app that runs in its maker's cloud: it connects from their servers, so it needs Tempo's public https address.
 * On a local site it gets no way in, only the reason.
 */
function cloudWay(id: string, name: string, https: boolean, steps: string[]): AiWay {
  return https
    ? { id, name, method: { kind: 'address' }, steps }
    : { id, name, method: { kind: 'unavailable' }, steps: [`${name} connects from its own servers, so it can only reach Tempo's public address. This works on the live or staging site, not on localhost.`] }
}

/**
 * The AI brands Tempo offers, most used first, each with its ways in, then one way that works for any MCP app. Checked against each maker's docs on 5 Oct 2026:
 * - Claude: claude.ai's "Add custom connector" dialog, prefilled (claude.com/docs/connectors/building/directory-vs-custom).
 * - Cursor: cursor://anysphere.cursor-deeplink/mcp/install with the server config as base64 JSON (cursor.com/docs).
 * - VS Code: vscode:mcp/install with the server config as URL-encoded JSON (code.visualstudio.com/api).
 * - ChatGPT (help.openai.com 12584461), the Gemini app (support.google.com/gemini 17209137), Perplexity, Le Chat and
 *   Grok take the address in their own settings; none has a prefill link.
 * - Claude Code, Codex, Antigravity, Gemini CLI and Copilot CLI add Tempo with one pasted line.
 * Microsoft's consumer Copilot takes no custom MCP servers, so it is not offered.
 */
export function aiBrands(url: string): AiBrand[] {
  const https = url.startsWith('https://')
  const at = shellWord(url)
  // Named after this Tempo ("Tempo (staging)", tempo-staging), so an AI app connected to live and staging can tell them apart.
  const { label, id: name } = tempoSite(url)
  return [
    {
      id: 'claude',
      name: 'Claude',
      hint: 'App or Claude Code',
      ways: [
        https
          ? {
              id: 'claude-app',
              name: 'Claude app',
              method: { kind: 'link', web: true, href: `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(label)}&connectorUrl=${encodeURIComponent(url)}` },
              steps: [
                `Claude opens with ${label} filled in. Click Add.`,
                `Click Connect next to ${label}. Tempo's Allow page opens: click Allow.`,
                'Claude takes you back to Claude, where Tempo shows as connected on the web, Desktop and phone. This page shows it too.',
              ],
            }
          : cloudWay('claude-app', 'Claude app', false, []),
        {
          id: 'claude-code',
          name: 'Claude Code',
          method: { kind: 'command', command: `claude mcp add --transport http ${name} ${at} && claude mcp login ${name}` },
          steps: [
            `Paste it in your terminal. ${ALLOW}`,
            // The names Claude Code gives Tempo's MCP prompts (checked in Claude Code 2.1, 5 Oct 2026).
            `Then, in a repo that is in Tempo, type /${name}:sync_app to draft its card, or /${name}:handover for a handover pack.`,
          ],
        },
      ],
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hint: 'ChatGPT or Codex',
      ways: [
        cloudWay('chatgpt', 'ChatGPT', https, [
          'In ChatGPT, open Settings, then Apps, then Advanced settings, and turn on Developer mode.',
          'In Apps, click Create and paste this address.',
          signIn('ChatGPT'),
          'Business, Enterprise and Edu plans can save drafts to Tempo. On Pro, ChatGPT can only read it.',
        ]),
        {
          id: 'codex',
          name: 'Codex',
          method: { kind: 'command', command: `codex mcp add ${name} --url ${at} && codex mcp login ${name}` },
          steps: [`Paste it in your terminal. ${ALLOW}`, ASK],
        },
      ],
    },
    {
      id: 'gemini',
      name: 'Gemini',
      hint: 'App, Antigravity or CLI',
      ways: [
        cloudWay('gemini-app', 'Gemini app', https, [
          'In Gemini, open Settings, then Connected apps, then Custom apps, and click Add a custom app. Paste this address.',
          signIn('Gemini'),
          'Google offers custom apps on personal accounts in some countries only.',
        ]),
        {
          id: 'antigravity',
          name: 'Antigravity',
          method: { kind: 'command', command: `agy mcp add ${name} ${at}` },
          steps: ['Paste it in your terminal.', signIn('Antigravity'), ASK],
        },
        {
          id: 'gemini-cli',
          name: 'Gemini CLI',
          method: { kind: 'command', command: `gemini mcp add --transport http ${name} ${at}` },
          steps: ['Paste it in your terminal.', `In Gemini CLI, type /mcp auth ${name}. ${ALLOW}`, ASK],
        },
      ],
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      hint: 'VS Code or CLI',
      ways: [
        {
          id: 'vscode',
          name: 'VS Code',
          method: { kind: 'link', web: false, href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: 'http', url }))}` },
          steps: [`VS Code opens with ${label} filled in. Click Install.`, `When Copilot first uses Tempo, it asks you to sign in. ${ALLOW}`],
        },
        {
          id: 'copilot-cli',
          name: 'Copilot CLI',
          method: { kind: 'command', command: `copilot mcp add --transport http ${name} ${at}` },
          steps: ['Paste it in your terminal.', `When Copilot first uses Tempo, it asks you to sign in. ${ALLOW}`, ASK],
        },
      ],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      hint: 'Opens Cursor',
      ways: [
        {
          id: 'cursor',
          name: 'Cursor',
          method: { kind: 'link', web: false, href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${encodeURIComponent(base64(JSON.stringify({ url })))}` },
          steps: [`Cursor opens with ${label} filled in. Click Install.`, `In Cursor's MCP settings, click Connect next to ${label}. ${ALLOW}`],
        },
      ],
    },
    {
      id: 'perplexity',
      name: 'Perplexity',
      hint: 'Pro and Enterprise',
      ways: [
        cloudWay('perplexity', 'Perplexity', https, [
          'In Perplexity, open Account settings, then Connectors, and add a custom connector. Choose Remote and paste this address.',
          signIn('Perplexity'),
        ]),
      ],
    },
    {
      id: 'le-chat',
      name: 'Le Chat',
      hint: 'By Mistral',
      ways: [
        cloudWay('le-chat', 'Le Chat', https, [
          'In Le Chat, open Connectors, click Add Connector, then Custom MCP Connector, and paste this address.',
          signIn('Le Chat'),
        ]),
      ],
    },
    {
      id: 'grok',
      name: 'Grok',
      hint: 'By xAI',
      ways: [
        cloudWay('grok', 'Grok', https, [
          'In Grok, open Connectors, click New Connector, choose Custom and paste this address.',
          signIn('Grok'),
        ]),
      ],
    },
    {
      id: 'any',
      name: 'Any AI app',
      hint: 'Works with every app that supports MCP',
      ways: [
        {
          id: 'other',
          name: 'Any app',
          method: { kind: 'address' },
          steps: ['Paste this address where your app adds a remote MCP server or custom connector.', signIn('the app')],
        },
        {
          id: 'windsurf',
          name: 'Windsurf',
          method: { kind: 'address' },
          steps: ["In Windsurf's MCP settings, add a server with this address as its serverUrl.", signIn('Windsurf')],
        },
        {
          id: 'zed',
          name: 'Zed',
          method: { kind: 'address' },
          steps: ["In Zed's settings, add Tempo under context_servers with this address as its url.", signIn('Zed')],
        },
      ],
    },
  ]
}

/**
 * The brands the picker offers: Claude only, for ease; the others stay written above,
 * hidden, and come back by adding their id here. With one brand the picker opens straight on it.
 */
export const SHOWN_BRANDS: readonly AiBrandId[] = ['claude']

/** The brands to offer, in catalogue order. */
export const shownBrands = (url: string, shown: readonly AiBrandId[] = SHOWN_BRANDS): AiBrand[] =>
  aiBrands(url).filter((brand) => shown.includes(brand.id))

/** "Claude" while the picker offers one brand, else "your AI". Names don't depend on the address. */
export function aiAppName(shown: readonly AiBrandId[] = SHOWN_BRANDS): string {
  return (shown.length === 1 && shownBrands('', shown)[0]?.name) || 'your AI'
}

/** "Connect Claude" while the picker offers one brand, else "Connect your AI". */
export const connectLabel = (shown: readonly AiBrandId[] = SHOWN_BRANDS): string => `Connect ${aiAppName(shown)}`

/**
 * Which way in a connected client is, from the name it registered with, in order (Claude Code before Claude, Codex
 * before ChatGPT, VS Code before Copilot). A client names itself, so this only picks a check mark and a logo; it proves
 * nothing. Names seen: claude.ai "Claude", Claude Code "Claude Code (<server>)", Gemini CLI "Gemini CLI MCP Client".
 * A name that matches nothing is still listed and can be revoked; it just gets no brand.
 */
// Anchored to the start of the name and to a whole word, so "Cursor helper" or "My ChatGPT tool" stay unknown: a wrong
// match would hide that app's way in.
const CLIENT_NAMES: [RegExp, string, AiBrandId][] = [
  [/^claude code( \([^)]*\))?$/i, 'claude-code', 'claude'],
  [/^claude(\.ai| desktop| for desktop)?$/i, 'claude-app', 'claude'],
  [/^(openai )?codex( cli)?$/i, 'codex', 'chatgpt'],
  [/^chatgpt$/i, 'chatgpt', 'chatgpt'],
  [/^(google )?antigravity( cli)?$/i, 'antigravity', 'gemini'],
  [/^gemini cli( mcp client)?$/i, 'gemini-cli', 'gemini'],
  [/^(google )?gemini$/i, 'gemini-app', 'gemini'],
  [/^(visual studio code|vs ?code)( - insiders)?$/i, 'vscode', 'copilot'],
  [/^(github )?copilot( cli)?$/i, 'copilot-cli', 'copilot'],
  [/^cursor$/i, 'cursor', 'cursor'],
  [/^perplexity$/i, 'perplexity', 'perplexity'],
  [/^(le chat|mistral( le chat)?)$/i, 'le-chat', 'le-chat'],
  [/^grok$/i, 'grok', 'grok'],
  [/^windsurf$/i, 'windsurf', 'any'],
  [/^zed$/i, 'zed', 'any'],
]

/** The way in and brand a connected client looks like, or null. */
export function matchClient(name: string): { way: string; brand: AiBrandId } | null {
  const hit = CLIENT_NAMES.find(([pattern]) => pattern.test(name.trim()))
  return hit ? { way: hit[1], brand: hit[2] } : null
}

/** A connected client's short name for lists: its way in ("Claude app", "Claude Code") when known, else its own name. */
export function appName(name: string): string {
  const way = matchClient(name)?.way
  return (way && aiBrands('').flatMap((brand) => brand.ways).find((item) => item.id === way)?.name) || name
}

/** The connected clients that look like this brand's apps. */
export const brandClients = (brand: AiBrandId, clients: readonly ConnectedClient[]): ConnectedClient[] =>
  clients.filter((item) => matchClient(item.name)?.brand === brand)

/** The connected clients by way id, so the picker can mark those ways connected and offer to revoke them. */
export function clientsByWay(clients: readonly ConnectedClient[]): Map<string, ConnectedClient[]> {
  const byWay = new Map<string, ConnectedClient[]>()
  for (const item of clients) {
    const way = matchClient(item.name)?.way
    if (way) byWay.set(way, [...(byWay.get(way) ?? []), item])
  }
  return byWay
}

/** What the copy button puts on the clipboard: the command, or the address. */
export const copyText = (way: AiWay, url: string): string => (way.method.kind === 'command' ? way.method.command : url)

/** The shape of a Supabase OAuth grant that this card reads. */
export interface GrantLike {
  client: { id: string; name?: string | null }
  granted_at?: string | null
}

export interface ConnectedClient {
  clientId: string
  name: string
  /** "5 Oct 2026", or '' when the grant carries no usable date. */
  grantedOn: string
}

const NAME_MAX = 60

/** A client names itself when it registers, so this is a label to read, not proof of who it is. */
export const clientLabel = (raw: string | null | undefined): string => {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim()
  return name ? name.slice(0, NAME_MAX) : 'Unnamed AI client'
}

/** Grant date in the viewer's own calendar, so a late-evening grant is not shown a day off. */
function grantedOn(iso: string | null | undefined): string {
  const at = iso ? new Date(iso) : null
  return at && !Number.isNaN(at.getTime()) ? formatCalendarDate(todayISO(at)) : ''
}

/** Newest grant first, one row per client. */
export function connectedClients(grants: readonly GrantLike[]): ConnectedClient[] {
  const seen = new Set<string>()
  return [...grants]
    .sort((a, b) => Date.parse(b.granted_at ?? '') - Date.parse(a.granted_at ?? '') || 0)
    .filter((grant) => (seen.has(grant.client.id) ? false : (seen.add(grant.client.id), true)))
    .map((grant) => ({ clientId: grant.client.id, name: clientLabel(grant.client.name), grantedOn: grantedOn(grant.granted_at) }))
}

/** Clients connected since the picker opened: the new ones in `now` that were not in `before`. */
export const newClients = (before: ReadonlySet<string>, now: readonly ConnectedClient[]): ConnectedClient[] =>
  now.filter((item) => !before.has(item.clientId))


export type ClientsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; clients: ConnectedClient[] }

/** A poll joins a request started this recently instead of sending another. */
const JOIN_MS = 2000

export interface GrantsFeed {
  /**
   * The connected clients, or null when Supabase didn't answer. `quiet` keeps the list on screen while it loads.
   * `join` (polling) shares a recent quiet request; everything else (opening the picker, coming back to the tab, an
   * Allow in another tab) asks afresh, so it never waits on a request a background tab started long ago.
   */
  load: (options?: { quiet?: boolean; join?: boolean }) => Promise<ConnectedClient[] | null>
  /** Drop every answer still on its way, e.g. after a revoke, so an older list can't bring a revoked app back. */
  invalidate: () => void
}

/** Loads the connected clients into `set`; the newest request started is the one that sets the list. */
export function grantsFeed(fetchList: () => Promise<ConnectedClient[]>, set: (next: (now: ClientsState) => ClientsState) => void, now: () => number = Date.now): GrantsFeed {
  let run = 0
  let inFlight: { request: Promise<ConnectedClient[] | null>; at: number } | null = null

  const load: GrantsFeed['load'] = ({ quiet = false, join = false } = {}) => {
    if (join && inFlight && now() - inFlight.at < JOIN_MS) return inFlight.request
    const id = ++run
    if (!quiet) set(() => ({ status: 'loading' }))
    const request = (async () => {
      try {
        const list = await fetchList()
        if (id === run) set(() => ({ status: 'ready', clients: list }))
        return list
      } catch {
        // A quiet failure keeps the list on screen, unless there is no list yet to keep.
        if (id === run) set((current) => (quiet && current.status !== 'loading' ? current : { status: 'error' }))
        return null
      }
    })()
    if (quiet) {
      const entry = { request, at: now() }
      inFlight = entry
      void request.finally(() => { if (inFlight === entry) inFlight = null })
    }
    return request
  }

  return { load, invalidate: () => { run++; inFlight = null } }
}
