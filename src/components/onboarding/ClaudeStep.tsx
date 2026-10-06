// The Claude window (mcp and both modes). Connect Claude the same ways as Settings (Claude app or Claude Code), then copy one
// message to paste into Claude, which writes the app descriptions (cards) and adds tasks for the problems Tempo flags.
// Opened for a reason (uiState.claudeWindow):
//   first      after the first apps are in: apps first, then Claude, so one trip to Claude both
//              connects it and starts the drafts. Shown once per workspace and person.
//   reconnect  Claude isn't connected: the top banner's button, or once per sign-in (ClaudeNotices).
//   sync       after Sync all (no API key saved), or from an "Out of date" chip, to ask Claude for the descriptions.
// Copying the message or opening Claude starts the "Claude is writing" indicator for the apps the message names.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, CircleCheck } from 'lucide-react'
import { fetchGrants, publishAIApps } from '../../data/aiApps'
import { startClaudeWriting } from '../../data/claudeWriting'
import { clearPendingMessage, savePendingMessage } from '../../data/claudeHandoff'
import { useSession } from '../../data/session'
import { useStore } from '../../store/useStore'
import { appsNeedingCard, draftPrompt } from '../../lib/claudeWork'
import { canEditApp } from '../../lib/permissions'
import { tempoSite } from '../../lib/site'
import { guideScope, useGuideState } from '../guide/guideState'
import { ALLOWED_KEY, aiBrands, appName, brandClients, grantsFeed, matchClient, mcpUrl, newClients, type ClientsState, type ConnectedClient } from '../../lib/mcpSetup'
import { AiBrandDetail, CopyButton, POLL_FOR_MS, POLL_MS, type Watch } from '../settings/ConnectAICard'
import { Button, Modal, Spinner } from '../ui'
import { useUI, type ClaudeWindowReason } from '../uiState'

const COPY: Record<ClaudeWindowReason, { title: string; description: string; skip: string; done: string }> = {
  first: {
    title: 'Let Claude write your cards',
    description: 'Your apps are in. Claude reads each one, writes its description and adds tasks when something needs fixing. It works in its own app: you connect it once, then send it one message.',
    skip: 'Later',
    done: 'Go to my apps',
  },
  reconnect: {
    title: "Claude isn't connected",
    description: 'Claude writes your app descriptions and adds tasks when an app has a problem. It works in its own app: connect it here, then send it one message.',
    skip: 'Close',
    done: 'Done',
  },
  again: {
    title: 'Connect Claude again',
    description: "Tempo can't see changes made inside Claude. If you removed Tempo there, or Claude says it can't find Tempo, add it again here, then send the message.",
    skip: 'Close',
    done: 'Done',
  },
  sync: {
    title: 'Last step: send Claude one message',
    description: 'Claude writes the descriptions that are missing or out of date, and adds tasks for the problems Tempo found. It works in its own app, not inside Tempo, so it starts when you send it the message below.',
    skip: 'Not now',
    done: 'Done',
  },
}

const PILL = 'focus-ring inline-flex h-8 items-center gap-2 rounded-full bg-pill-bg px-3.5 text-[14px] font-medium text-pill-ink'

export function ClaudeStep() {
  const reason = useUI((s) => s.claudeWindow)
  const open = reason !== null
  // Keeps the last reason's words while the window animates out.
  const [shown, setShown] = useState<ClaudeWindowReason>('first')
  useEffect(() => { if (reason) setShown(reason) }, [reason])
  const copy = COPY[reason ?? shown]
  const status = useSession((s) => s.status)
  const userId = useSession((s) => s.user?.id ?? null)
  const signIn = useSession((s) => s.user?.lastSignInAt ?? null)
  const workspace = useStore((s) => s.workspace)
  const demo = useStore((s) => s.settings.demo)
  const scope = guideScope(workspace?.id ?? null, userId, demo)
  const url = mcpUrl(window.location.origin)
  const claude = useMemo(() => aiBrands(url).find((brand) => brand.id === 'claude')!, [url])
  const [clients, setClients] = useState<ClientsState>({ status: 'loading' })
  const feed = useMemo(() => grantsFeed(fetchGrants, setClients), [])
  const [wayId, setWayId] = useState(claude.ways[0].id)
  const [stopped, setStopped] = useState(false)
  const [missed, setMissed] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  // "Connect Claude again": removing Tempo inside Claude leaves Tempo's grant in place (Supabase gives Claude no way to
  // say so). So this view counts only a Claude that connects after it opened (a new client), or the person saying
  // it's done.
  const again = reason === 'again'
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null)
  const [againDone, setAgainDone] = useState(false)
  useEffect(() => { setBefore(null); setAgainDone(false) }, [reason])
  const close = () => useUI.getState().setClaudeWindow(null)

  // The setup checklist ticks "Connect Claude" from the same list.
  useEffect(() => {
    if (clients.status === 'ready' && userId) publishAIApps(userId, clients.clients)
  }, [clients, userId])

  // Shown once it has actually opened (not when the scan asked for it), so a reload in between doesn't lose it. Any
  // reason counts: whoever has seen this window doesn't get the first-visit one or this sign-in's reminder after it.
  useEffect(() => {
    if (!open) return
    useGuideState.getState().setClaudeStepShown(scope)
    if (userId && signIn) useGuideState.getState().setClaudeNotice(userId, { remindedFor: signIn })
  }, [open, scope, userId, signIn])

  // The apps the message names, fixed when the window opens so the list doesn't shift under a copy.
  const [needing, setNeeding] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] })
  useEffect(() => {
    if (!open) return
    // Only apps this person may edit: Claude writes as them, and Tempo refuses the rest.
    const { projects, members, meId } = useStore.getState()
    const me = members.find((member) => member.id === meId)
    const apps = appsNeedingCard(projects).filter((project) => canEditApp(me, project))
    setNeeding({ ids: apps.map((p) => p.id), names: apps.map((p) => p.name) })
    // Read once per opening, not subscribed: a draft arriving while it's open must not change a message already copied.
  }, [open, reason])
  const prompt = draftPrompt(workspace?.name, needing.names, tempoSite(window.location.origin).label)
  const started = () => {
    clearPendingMessage()
    if (workspace) startClaudeWriting({ workspaceId: workspace.id, projectIds: needing.ids, prompt })
  }

  // Reads the connections on opening, and again on coming back to the tab or an Allow in another Tempo tab.
  // Each opening starts afresh: the first way, no stale list (load() shows "Checking…" until it answers).
  useEffect(() => {
    if (!open || status !== 'signed-in') return
    setWayId(claude.ways[0].id)
    setStopped(false)
    setMissed(false)
    void feed.load()
    const onReturn = () => { if (document.visibilityState === 'visible') void feed.load({ quiet: true }) }
    const onAllowed = (event: StorageEvent) => { if (event.key === ALLOWED_KEY) void feed.load({ quiet: true }) }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('storage', onAllowed)
    return () => {
      feed.invalidate()
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('storage', onAllowed)
    }
  }, [open, status, feed, claude])

  const ready = clients.status === 'ready' ? clients.clients : null
  const connected = useMemo(() => brandClients('claude', ready ?? []), [ready])
  useEffect(() => {
    if (again && before === null && ready !== null) setBefore(new Set(connected.map((item) => item.clientId)))
  }, [again, before, ready, connected])
  const usable = useMemo(
    () => (!again || againDone ? connected : before ? newClients(before, connected) : []),
    [again, againDone, before, connected],
  )
  const way = claude.ways.find((item) => item.id === wayId) ?? claude.ways[0]
  const waiting = open && ready !== null && usable.length === 0 && way.method.kind !== 'unavailable'

  // While someone signs in to Claude elsewhere, ask quietly every few seconds, for POLL_FOR_MS.
  useEffect(() => {
    if (!waiting || stopped) return
    const until = Date.now() + POLL_FOR_MS
    const timer = window.setInterval(() => {
      if (Date.now() > until) setStopped(true)
      else void feed.load({ quiet: true, join: true }).then((list) => setMissed(list === null))
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [waiting, stopped, feed, wayId])

  // Once Claude is connected the view changes under the person's focus, so move focus to the new message.
  const isConnected = usable.length > 0
  const wasConnected = useRef<boolean | null>(null)
  useEffect(() => {
    if (!open || ready === null) { wasConnected.current = null; return }
    const before = wasConnected.current
    wasConnected.current = isConnected
    if (before === false && isConnected) requestAnimationFrame(() => body.current?.focus({ preventScroll: true }))
  }, [open, ready, isConnected])

  // While Claude isn't connected, keep the message for Tempo's Allow page: clicking Allow there copies it, so the person
  // pastes it in Claude without coming back here (claudeHandoff.ts).
  const workspaceId = workspace?.id ?? null
  useEffect(() => {
    if (open && ready !== null && !isConnected && workspaceId && needing.ids.length) {
      savePendingMessage({ prompt, workspaceId, projectIds: needing.ids })
    }
  }, [open, ready, isConnected, workspaceId, needing, prompt])

  const watch: Watch = !waiting ? 'off' : stopped ? 'stopped' : missed ? 'missed' : 'waiting'
  const chooseWay = (id: string) => { setWayId(id); setStopped(false); setMissed(false) }
  const checkAgain = () => {
    setStopped(false)
    setMissed(false)
    void feed.load({ quiet: true }).then((list) => setMissed(list === null))
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={copy.title}
      description={copy.description}
      footer={isConnected ? <Button variant="primary" onClick={close}>{copy.done}</Button> : <Button variant="ghost" onClick={close}>{copy.skip}</Button>}
    >
      <div ref={body} tabIndex={-1} className="outline-none sm:min-h-[16rem]">
        {clients.status === 'loading' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-text-muted" role="status"><Spinner size={14} />Checking whether Claude is connected…</p>
        ) : clients.status === 'error' ? (
          <div role="alert" className="py-2">
            <p className="text-sm text-danger">Couldn&apos;t check whether Claude is connected.</p>
            <Button className="mt-2" size="sm" onClick={() => void feed.load()}>Try again</Button>
          </div>
        ) : isConnected ? (
          <AskClaude clients={usable} prompt={prompt} onStart={started} onConnectAgain={again ? undefined : () => useUI.getState().setClaudeWindow('again')} />
        ) : (
          <>
            <AiBrandDetail brand={claude} way={way} url={url} watch={watch} onChooseWay={chooseWay} onCheckAgain={checkAgain} />
            {again && connected.length > 0 && (
              <p className="mt-4 text-xs text-text-muted">
                Claude can use Tempo again?{' '}
                <button type="button" className="focus-ring rounded-sm text-text underline decoration-border-strong underline-offset-4 hover:decoration-text" onClick={() => setAgainDone(true)}>
                  Show the message
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * A new, empty chat on Claude's website. Never prefilled with `?q=`: claude.ai puts a red "Use caution before running
 * this prompt" banner over any message that arrives through a link. So the button copies the message and opens a
 * blank chat, and the person pastes it.
 */
export const CLAUDE_NEW_CHAT = 'https://claude.ai/new'

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text-muted">{n}</span>
      <div className="min-w-0 flex-1 text-sm text-text">{children}</div>
    </li>
  )
}

/**
 * Claude is connected: how to start it, step by step. Claude works in its own app, so the person sends it one
 * message; with the Claude app the button copies the message and opens a new chat to paste it into. `onStart` runs on
 * Open Claude or a copy.
 */
export function AskClaude({ clients, prompt, onStart, onConnectAgain }: { clients: ConnectedClient[]; prompt: string; onStart?: () => void; onConnectAgain?: () => void }) {
  const names = [...new Set(clients.map((item) => appName(item.name)))]
  const app = clients.some((item) => matchClient(item.name)?.way === 'claude-app')
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const copyAndOpen = () => {
    // Called inside the click, so the browser allows the clipboard write; the link opens the chat either way.
    try {
      void navigator.clipboard.writeText(prompt).then(() => setCopied('yes'), () => setCopied('failed'))
    } catch {
      setCopied('failed') // no clipboard at all (an old or locked-down browser)
    }
    onStart?.()
  }
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-sm text-text" role="status">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span><span className="font-medium">{names.join(' and ')}</span> {names.length > 1 ? 'are' : 'is'} connected to Tempo.</span>
      </p>
      <p className="text-sm text-text">Claude works in its own app, not inside Tempo. Send it one message and it does the rest:</p>
      <ol className="space-y-3">
        {app ? (
          <>
            <Step n={1}>
              <p>Open Claude. Tempo copies the message for you.</p>
              <a href={CLAUDE_NEW_CHAT} target="_blank" rel="noopener noreferrer" className={`${PILL} mt-2`} onClick={copyAndOpen}>
                Copy message and open Claude<ArrowUpRight className="size-4" aria-hidden />
              </a>
              {copied && (
                <p className={`mt-1.5 text-xs ${copied === 'yes' ? 'text-text-muted' : 'text-danger'}`} role="status">
                  {copied === 'yes' ? 'Message copied.' : "Couldn't copy it. Use Copy message below."}
                </p>
              )}
            </Step>
            <Step n={2}>Paste it into the new chat and press Send. When Claude asks to use Tempo, choose Always allow, so it doesn&apos;t ask again for every app.</Step>
          </>
        ) : (
          <>
            <Step n={1}>Copy the message below.</Step>
            <Step n={2}>Paste it into Claude Code and press Enter. When it asks to use Tempo, choose the option that doesn&apos;t ask again.</Step>
          </>
        )}
        <Step n={3}>Come back here. Tempo shows each description as Claude writes it, at the bottom of the screen.</Step>
      </ol>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-muted">{app ? 'The message (copy it if you use Claude Code or the desktop app)' : 'The message'}</p>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border-strong bg-surface-2">
          <p className="p-3 text-sm text-text">{prompt}</p>
          <div className="flex justify-end border-t border-border px-3 py-1.5">
            <CopyButton text={prompt} label="Copy message" onCopied={onStart} />
          </div>
        </div>
      </div>
      <p className="text-xs text-text-muted">Each description arrives in Review as a draft. Nothing counts until you check it. Tasks land on each app&apos;s page and close on their own once fixed.</p>
      {onConnectAgain && (
        <p className="text-xs text-text-muted">
          Claude says it can&apos;t find Tempo?{' '}
          <button type="button" className="focus-ring rounded-sm text-text underline decoration-border-strong underline-offset-4 hover:decoration-text" onClick={onConnectAgain}>
            Connect it again
          </button>
        </p>
      )}
    </div>
  )
}
