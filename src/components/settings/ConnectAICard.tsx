// Settings → Connect your AI. Tempo is an MCP server. "Connect an AI app" opens a picker of AI brands (Claude,
// ChatGPT, Gemini, Copilot…); each brand offers its ways in (its app, its terminal tool, its editor), and every way
// ends on Tempo's Allow page. "Any AI app" is the universal way (the address), and "API key" points to the AI
// connection card, where Tempo calls the AI itself with the person's own key. While only one brand is shown
// (SHOWN_BRANDS: Claude for now) the button says "Connect Claude" and the picker opens straight on it. Where the API
// key is kept too (VITE_AI_MODE=both) the card opens with the two choices side by side, each said in plain words
// (src/lib/aiChoices.ts): Claude (MCP), and the API key as the full-automation way.
// The picker notices the new connection (at once when Allow is clicked in another Tempo tab) and offers to disconnect
// the app someone switched from. Supabase holds each grant; it is revoked here.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, Check, CircleCheck, Copy, KeyRound, Plug } from 'lucide-react'
import { canWriteCards } from '../../ai/workspaceAI'
import { fetchGrants, publishAIApps } from '../../data/aiApps'
import { useSession } from '../../data/session'
import { aiChoices, type AIChoice } from '../../lib/aiChoices'
import { ALLOWED_KEY, clientsByWay, copyText, grantsFeed, matchClient, mcpUrl, newClients, shownBrands, type AiBrand, type AiBrandId, type AiWay, type ClientsState, type ConnectedClient } from '../../lib/mcpSetup'
import { toHash } from '../../lib/router'
import { useStore } from '../../store/useStore'
import { Button, EmptyState, Modal, SegmentedControl, Skeleton, Spinner } from '../ui'
import { useUI } from '../uiState'
import { cn } from '../ui/cn'
import { AiLogo, type AiLogoId } from './AiLogo'
import { Section } from './Section'

export type { ClientsState }

/** How often the picker asks Supabase for new connections while someone signs in elsewhere, and for how long. */
export const POLL_MS = 4000
export const POLL_FOR_MS = 5 * 60 * 1000

type RevokeError = { id: string; text: string } | null

/** onUseApiKey: shown as the "API key" choice when this build keeps the AI connection card (VITE_AI_MODE both). */
export function ConnectAICard({ onUseApiKey }: { onUseApiKey?: () => void }) {
  const status = useSession((state) => state.status)
  const userId = useSession((state) => state.user?.id ?? null)
  const [clients, setClients] = useState<ClientsState>({ status: 'loading' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<RevokeError>(null)
  const [picking, setPicking] = useState(false)
  const feed = useMemo(() => grantsFeed(fetchGrants, setClients), [])
  const refresh = useCallback(() => feed.load({ quiet: true }), [feed])
  const poll = useCallback(() => feed.load({ quiet: true, join: true }), [feed])
  const url = mcpUrl(window.location.origin)
  const brands = useMemo(() => shownBrands(url), [url])
  const single = brands.length === 1 ? brands[0] : null
  const requested = useUI((state) => state.connectAIRequested)
  const keySaved = useStore((state) => canWriteCards(state.settings))

  // "Connect Claude" elsewhere in the app (setup guide, repo scan) lands here and opens the picker.
  useEffect(() => {
    if (!requested || status === 'loading') return
    useUI.setState({ connectAIRequested: false })
    if (status === 'signed-in') { setRevokeError(null); setPicking(true) }
  }, [requested, status])

  // The setup guide ticks "Connect Claude" from the same list.
  useEffect(() => {
    if (clients.status === 'ready' && userId) publishAIApps(userId, clients.clients)
  }, [clients, userId])

  useEffect(() => {
    if (status !== 'signed-in') return
    void feed.load()
    // Sign-in happens in another tab or app. Coming back here, or an Allow in another Tempo tab, shows it at once.
    const onReturn = () => { if (document.visibilityState === 'visible') void refresh() }
    const onAllowed = (event: StorageEvent) => { if (event.key === ALLOWED_KEY) void refresh() }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('storage', onAllowed)
    return () => {
      feed.invalidate() // drop a late answer after sign-out or unmount
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('storage', onAllowed)
    }
  }, [status, feed, refresh])

  const revoke = async (clientId: string) => {
    setRevoking(clientId)
    setRevokeError(null)
    try {
      const { client } = await import('../../data/cloud')
      const { error } = await client().auth.oauth.revokeGrant({ clientId })
      if (error) throw error
      // A check that started before the revoke must not bring the app back, so drop it and ask again.
      feed.invalidate()
      setClients((now) => (now.status === 'ready' ? { status: 'ready', clients: now.clients.filter((item) => item.clientId !== clientId) } : now))
      void refresh()
      setConfirmId(null)
      useUI.getState().notify('Access revoked. That AI app is signed out of Tempo.', 'success')
    } catch {
      setRevokeError({ id: clientId, text: "Couldn't revoke access. Nothing changed. Try again." })
    } finally {
      setRevoking(null)
    }
  }

  const connected = clients.status === 'ready' ? clients.clients : []
  const openPicker = () => { setRevokeError(null); setPicking(true) }

  return (
    <Section
      title="Connect your AI"
      description={onUseApiKey
        ? 'Pick how your app descriptions get written. You check every draft before it counts.'
        : `${single ? single.name : 'Your AI app'} reads your portfolio and writes drafts. You check each draft before it counts.`}
    >
      {status === 'loading' ? (
        <div className="space-y-2" role="status" aria-label="Checking your session">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          {onUseApiKey ? (
            // The key lives in this browser, so its choice shows even before sign-in; Claude needs the sign-in.
            <AIChoices
              app={single?.name ?? null}
              logo={single?.id ?? 'any'}
              connected={connected.length > 0}
              keySaved={keySaved}
              signedIn={status === 'signed-in'}
              canSignIn={status === 'signed-out'}
              connectLabel={single ? `Connect ${single.name}` : 'Connect an AI app'}
              onConnect={openPicker}
              onApiKey={onUseApiKey}
            />
          ) : status !== 'signed-in' ? (
            <SignInFirst canSignIn={status === 'signed-out'} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={connected.length ? 'secondary' : 'primary'} icon={Plug} onClick={openPicker}>
                {single ? `Connect ${single.name}` : connected.length ? 'Connect or switch AI app' : 'Connect an AI app'}
              </Button>
              <p className="text-xs text-text-muted">
                {single ? `${single.ways.map((item) => item.name).join(' or ')}.` : 'Claude, ChatGPT, Gemini, GitHub Copilot, Cursor or any app with MCP.'}
              </p>
            </div>
          )}
          {status === 'signed-in' && (
            <>
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium text-text">Connected AI apps</h3>
                <p className="mt-0.5 text-xs text-text-muted">Each one signed in as you. Revoking signs it out.</p>
                <ClientsList
                  className="mt-3"
                  state={clients}
                  confirmId={confirmId}
                  revoking={revoking}
                  error={revokeError}
                  onRetry={() => void feed.load()}
                  onAskRevoke={(id) => { setConfirmId(id); setRevokeError(null) }}
                  onCancel={() => { setConfirmId(null); setRevokeError(null) }}
                  onRevoke={(id) => void revoke(id)}
                />
              </div>
              <AiPicker
                open={picking}
                onClose={() => { setPicking(false); setRevokeError(null) }}
                url={url}
                brands={brands}
                clients={clients}
                revoking={revoking}
                revokeError={revokeError}
                refresh={refresh}
                poll={poll}
                onDisconnect={(id) => void revoke(id)}
                onClearRevokeError={() => setRevokeError(null)}
                onUseApiKey={onUseApiKey ? () => { setPicking(false); onUseApiKey() } : undefined}
              />
            </>
          )}
        </>
      )}
    </Section>
  )
}

export function SignInFirst({ canSignIn }: { canSignIn: boolean }) {
  return (
    <p className="text-sm text-text-muted">
      Sign in first to connect an AI app.
      {canSignIn && (
        <>
          {' '}
          <a href={toHash({ name: 'login' })} className="focus-ring rounded-sm font-medium text-accent underline-offset-2 hover:underline">Sign in</a>
        </>
      )}
    </p>
  )
}

/**
 * The two ways to get descriptions written, side by side (both mode): Claude (MCP) works in its own app, the API key is
 * the full-automation way. Stacks on a phone. `connected` / `keySaved` show a green check on the choice already in use.
 */
export function AIChoices({ app, logo, connected, keySaved, signedIn = true, canSignIn = false, connectLabel, onConnect, onApiKey }: {
  app: string | null
  logo: AiLogoId
  connected: boolean
  keySaved: boolean
  /** Claude needs a Tempo sign-in; the API key doesn't, so before it that choice shows "Sign in first" instead of its button. */
  signedIn?: boolean
  canSignIn?: boolean
  connectLabel: string
  onConnect: () => void
  onApiKey: () => void
}) {
  const copy = aiChoices(app)
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          logo={logo}
          choice={copy.mcp}
          status={connected ? `${app ?? 'An AI app'} is connected.` : null}
          action={signedIn
            ? <Button variant={connected || keySaved ? 'secondary' : 'primary'} icon={Plug} onClick={onConnect}>{connectLabel}</Button>
            : <SignInFirst canSignIn={canSignIn} />}
        />
        <ChoiceCard
          logo="api-key"
          choice={copy.key}
          note={copy.tasks}
          status={keySaved ? 'A key is saved. Tempo writes the descriptions and tasks.' : null}
          action={<Button variant={!signedIn && !keySaved ? 'primary' : 'secondary'} icon={KeyRound} onClick={onApiKey}>{keySaved ? 'Add another key' : 'Add an API key'}</Button>}
        />
      </div>
      <p className="text-xs text-text-muted">{copy.both}</p>
    </div>
  )
}

function ChoiceCard({ logo, choice, note, status, action }: { logo: AiLogoId; choice: AIChoice; note?: string; status: string | null; action: ReactNode }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border-strong bg-surface p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text"><AiLogo id={logo} className="size-5" /></span>
        <h3 id={titleId} className="min-w-0 text-sm font-medium text-text">{choice.title}</h3>
        {choice.badge && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 text-xs font-medium text-accent">{choice.badge}</span>}
      </div>
      <p className="text-sm leading-6 text-text-muted">{choice.body}</p>
      <p className="border-t border-border pt-3 text-xs leading-5 text-text-muted">
        {choice.cost}
        {note && <> {note}</>}
      </p>
      {status && (
        <p className="flex items-start gap-1.5 text-xs text-text" role="status">
          <CircleCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
          {status}
        </p>
      )}
      <div className="mt-auto">{action}</div>
    </section>
  )
}

// ── Picker ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface AiPickerProps {
  open: boolean
  onClose: () => void
  url: string
  /** The brands offered (SHOWN_BRANDS). Just one, and the picker opens on it with no grid to go back to. */
  brands: AiBrand[]
  clients: ClientsState
  revoking: string | null
  revokeError: RevokeError
  /** A fresh check (opening, Check again). */
  refresh: () => Promise<ConnectedClient[] | null>
  /** A polling check, which may share one started a moment ago. */
  poll: () => Promise<ConnectedClient[] | null>
  onDisconnect: (clientId: string) => void
  onClearRevokeError: () => void
  onUseApiKey?: () => void
}

/** The connections there were when the picker opened, read fresh. Anything new after that is the app just connected. */
type Baseline = { status: 'loading' } | { status: 'error' } | { status: 'ready'; ids: ReadonlySet<string> }

/** While a way is on screen: checking for the new connection, the last check failed, or gave up after POLL_FOR_MS. */
export type Watch = 'waiting' | 'missed' | 'stopped' | 'off'

/** What the picker shows: a brand's ways, or the API key choice. */
type Choice = AiBrandId | 'api-key'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function AiPicker({ open, onClose, url, brands, clients, revoking, revokeError, refresh, poll, onDisconnect, onClearRevokeError, onUseApiKey }: AiPickerProps) {
  const single = brands.length === 1 ? brands[0] : null
  const [choice, setChoice] = useState<Choice | null>(null)
  const [wayId, setWayId] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<Baseline>({ status: 'loading' })
  const [stopped, setStopped] = useState(false)
  const [missed, setMissed] = useState(false)
  const attempt = useRef(0)
  const body = useRef<HTMLDivElement>(null)
  const lastView = useRef<string | null>(null)

  const takeBaseline = useCallback(() => {
    const n = ++attempt.current
    setBaseline({ status: 'loading' })
    void refresh().then((list) => {
      if (n === attempt.current) setBaseline(list ? { status: 'ready', ids: new Set(list.map((item) => item.clientId)) } : { status: 'error' })
    })
  }, [refresh])

  // Opening reads the connections afresh, so one made while the picker was closed is not mistaken for a new one.
  useEffect(() => {
    if (open) takeBaseline()
    else {
      attempt.current++
      setChoice(null)
      setWayId(null)
      setStopped(false)
      setMissed(false)
    }
  }, [open, takeBaseline])

  const ids = baseline.status === 'ready' ? baseline.ids : null
  const ready = clients.status === 'ready' ? clients.clients : null
  const fresh = ids && ready ? newClients(ids, ready) : []
  const others = ids && ready && fresh.length ? ready.filter((item) => ids.has(item.clientId)) : []
  const brand = brands.find((item) => item.id === choice) ?? single
  const way = brand ? (brand.ways.find((item) => item.id === wayId) ?? brand.ways[0]) : null
  // A way that is already connected shows as connected, with Revoke, instead of its way in: connecting it twice
  // would only add a second sign-in for the same app.
  const byWay = useMemo(() => clientsByWay(ready ?? []), [ready])
  const connectedWays = useMemo(() => new Set(byWay.keys()), [byWay])
  const connectedHere = way ? (byWay.get(way.id) ?? []) : []
  const waiting = open && ids !== null && way !== null && way.method.kind !== 'unavailable' && connectedHere.length === 0 && fresh.length === 0

  // While someone signs in elsewhere, ask quietly every few seconds, for POLL_FOR_MS from when this way was shown.
  // A background tab slows these timers, so an Allow in another Tempo tab also tells the card directly (ALLOWED_KEY).
  useEffect(() => {
    if (!waiting || stopped) return
    const until = Date.now() + POLL_FOR_MS
    const timer = window.setInterval(() => {
      if (Date.now() > until) setStopped(true)
      else void poll().then((list) => setMissed(list === null))
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [waiting, stopped, poll, choice, wayId])

  // A new view replaces the control that had focus, so move focus into it (the modal only does this when it opens).
  // On "Connected" focus lands on the message, not on a Disconnect button.
  const view = baseline.status !== 'ready' ? baseline.status : fresh.length ? 'connected' : brand ? `choice:${brand.id}` : choice ? `choice:${choice}` : 'grid'
  useEffect(() => {
    if (!open) { lastView.current = null; return }
    const previous = lastView.current
    lastView.current = view
    if (previous === null || previous === view) return
    const frame = requestAnimationFrame(() => {
      const el = body.current
      const target = view === 'connected' ? el : (el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, view])

  const show = (next: Choice | null, nextWay: string | null) => {
    setChoice(next)
    setWayId(nextWay)
    setStopped(false)
    setMissed(false)
  }
  const checkAgain = () => {
    setStopped(false)
    setMissed(false)
    void refresh().then((list) => setMissed(list === null))
  }
  const watch: Watch = !way || way.method.kind === 'unavailable' || connectedHere.length ? 'off' : stopped ? 'stopped' : missed ? 'missed' : 'waiting'
  const apiKey = choice === 'api-key' && onUseApiKey

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={fresh.length ? 'Connected' : brand ? `Connect ${brand.name}` : apiKey ? 'Use an API key' : 'Connect an AI app'}
      description={fresh.length || brand || apiKey ? undefined : 'Pick the AI you use. Tempo walks you through signing it in.'}
      footer={fresh.length ? <Button variant="primary" onClick={onClose}>Done</Button> : undefined}
    >
      {/* About the grid's height, so switching between views and ways doesn't make the centred dialog jump. */}
      <div ref={body} tabIndex={-1} className="outline-none sm:min-h-[21.5rem]">
        {baseline.status === 'loading' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-text-muted" role="status"><Spinner size={14} />Checking which AI apps are connected…</p>
        ) : baseline.status === 'error' ? (
          <div role="alert" className="py-2">
            <p className="text-sm text-danger">Couldn&apos;t check which AI apps are connected, so Tempo can&apos;t tell when a new one signs in.</p>
            <Button className="mt-2" size="sm" onClick={takeBaseline}>Try again</Button>
          </div>
        ) : fresh.length ? (
          <ConnectedNotice fresh={fresh} others={others} revoking={revoking} error={revokeError} onDisconnect={onDisconnect} />
        ) : brand && way ? (
          <AiBrandDetail
            brand={brand}
            way={way}
            url={url}
            watch={watch}
            connectedWays={connectedWays}
            connectedHere={connectedHere}
            revoking={revoking}
            revokeError={revokeError}
            onRevoke={onDisconnect}
            onCancelRevoke={onClearRevokeError}
            onBack={single ? undefined : () => show(null, null)}
            onChooseWay={(id) => show(brand.id, id)}
            onCheckAgain={checkAgain}
          />
        ) : apiKey ? (
          <ApiKeyChoice onBack={() => show(null, null)} onSetUp={onUseApiKey} />
        ) : (
          <AiBrandGrid brands={brands} connectedWays={connectedWays} onPick={(picked) => show(picked.id, picked.ways[0].id)} onApiKey={onUseApiKey ? () => show('api-key', null) : undefined} />
        )}
      </div>
    </Modal>
  )
}

const TILE = 'focus-ring flex h-full w-full rounded-lg border border-border-strong bg-surface transition-colors hover:bg-surface-2'
const LOGO_CHIP = 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text'

/**
 * The brands, then the two ways that aren't one brand: any app with MCP (the universal way) and an API key.
 * A brand with a single one-click way is that link itself, so one click opens the app, unless it is already connected.
 * A brand with a connected way carries a green check.
 */
export function AiBrandGrid({ brands, connectedWays = new Set(), onPick, onApiKey }: { brands: AiBrand[]; connectedWays?: ReadonlySet<string>; onPick: (brand: AiBrand) => void; onApiKey?: () => void }) {
  const any = brands.find((brand) => brand.id === 'any')
  const isConnected = (brand: AiBrand) => brand.ways.some((item) => connectedWays.has(item.id))
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="AI apps">
        {brands.filter((brand) => brand.id !== 'any').map((brand) => {
          const connected = isConnected(brand)
          const only = brand.ways.length === 1 && !connected ? brand.ways[0].method : null
          const inner = (
            <>
              {connected && <ConnectedMark className="absolute right-2 top-2" />}
              <span className={LOGO_CHIP}><AiLogo id={brand.id} className="size-6" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{brand.name}{connected && <span className="sr-only"> (connected)</span>}</span>
                <span className="block text-xs leading-4 text-text-muted">{brand.hint}</span>
              </span>
            </>
          )
          const tile = cn(TILE, 'relative flex-col items-center gap-2 px-2 py-3 text-center')
          return (
            <li key={brand.id} className="min-w-0">
              {only?.kind === 'link' ? (
                <a href={only.href} {...(only.web ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={tile} onClick={() => onPick(brand)}>{inner}</a>
              ) : (
                <button type="button" className={tile} onClick={() => onPick(brand)}>{inner}</button>
              )}
            </li>
          )
        })}
      </ul>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Other ways to connect">
        {any && <WideTile id="any" name={any.name} hint={any.hint} connected={isConnected(any)} onClick={() => onPick(any)} />}
        {onApiKey && <WideTile id="api-key" name="API key" hint="Tempo calls the AI with your own key" onClick={onApiKey} />}
      </ul>
    </div>
  )
}

function WideTile({ id, name, hint, connected = false, onClick }: { id: 'any' | 'api-key'; name: string; hint: string; connected?: boolean; onClick: () => void }) {
  return (
    <li className="min-w-0">
      <button type="button" className={cn(TILE, 'relative items-center gap-3 p-2.5 text-left')} onClick={onClick}>
        {connected && <ConnectedMark className="absolute right-2 top-2" />}
        <span className={LOGO_CHIP}><AiLogo id={id} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text">{name}{connected && <span className="sr-only"> (connected)</span>}</span>
          <span className="block text-xs leading-4 text-text-muted">{hint}</span>
        </span>
      </button>
    </li>
  )
}

/** The green check on a connected app's tile. */
function ConnectedMark({ className }: { className?: string }) {
  return <CircleCheck className={cn('size-4 text-success', className)} strokeWidth={2.25} aria-hidden />
}

/** The API key choice: no app to connect; Tempo calls the AI itself. Setting it up happens in the AI connection card. */
export function ApiKeyChoice({ onBack, onSetUp }: { onBack: () => void; onSetUp: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text"><AiLogo id="api-key" /></span>
          <span className="truncate text-sm font-medium text-text">API key</span>
        </div>
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>All apps</Button>
      </div>
      <p className="text-sm leading-6 text-text-muted">
        <span className="font-medium text-text">Full automation.</span> There is no app to connect. {aiChoices(null).key.body} {aiChoices(null).key.cost} Use a key
        from Anthropic, OpenAI, Google Gemini, OpenRouter or any compatible provider.
      </p>
      <Button variant="primary" onClick={onSetUp}>Set up an API key</Button>
    </div>
  )
}

interface AiBrandDetailProps {
  brand: AiBrand
  way: AiWay
  url: string
  watch: Watch
  /** Way ids with a connected client: their switch option gets a green check. */
  connectedWays?: ReadonlySet<string>
  /** The clients connected through this way. Any at all, and the way shows as connected instead of its way in. */
  connectedHere?: ConnectedClient[]
  revoking?: string | null
  revokeError?: RevokeError
  onRevoke?: (clientId: string) => void
  onCancelRevoke?: () => void
  /** Back to every brand; left out when the picker offers only this one. */
  onBack?: () => void
  onChooseWay: (wayId: string) => void
  onCheckAgain: () => void
}

/**
 * One brand: where you use it (when it has more than one way in), then that way's link, line or address, and steps.
 * A way already connected shows that, with Revoke, and no way back in until it is revoked.
 */
export function AiBrandDetail({ brand, way, url, watch, connectedWays = new Set(), connectedHere = [], revoking = null, revokeError = null, onRevoke, onCancelRevoke, onBack, onChooseWay, onCheckAgain }: AiBrandDetailProps) {
  const method = way.method
  const connected = connectedHere.length > 0
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text"><AiLogo id={brand.id} /></span>
          <span className="truncate text-sm font-medium text-text">{brand.name}</span>
        </div>
        {onBack && <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>All apps</Button>}
      </div>

      {brand.ways.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs text-text-muted">Where do you use it?</p>
          <SegmentedControl
            aria-label={`Where you use ${brand.name}`}
            value={way.id}
            onChange={onChooseWay}
            options={brand.ways.map((item) => ({
              value: item.id,
              label: connectedWays.has(item.id) ? `${item.name} (connected)` : item.name,
              ...(connectedWays.has(item.id) ? { icon: CircleCheck, iconClassName: 'text-success' } : {}),
            }))}
            collapseLabels="never"
            className="max-w-full flex-wrap"
          />
        </div>
      )}

      {connected ? (
        <ConnectedWay way={way} clients={connectedHere} revoking={revoking} error={revokeError} onRevoke={onRevoke} onCancel={onCancelRevoke} />
      ) : (
        <>
          {method.kind === 'link' && (
            <div className="space-y-1.5">
              <a
                href={method.href}
                {...(method.web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="focus-ring inline-flex h-8 items-center gap-2 rounded-full bg-pill-bg px-3.5 text-[14px] font-medium text-pill-ink"
              >
                Open {way.name}<ArrowUpRight className="size-4" aria-hidden />
              </a>
              {!method.web && <p className="text-xs text-text-muted">Nothing opened? Check {way.name} is installed, then click again.</p>}
            </div>
          )}
          {method.kind === 'command' && (
            <div className="min-w-0 overflow-hidden rounded-lg border border-border-strong bg-surface-2">
              <pre className="whitespace-pre-wrap p-3 font-mono text-xs leading-5 text-text [overflow-wrap:anywhere]">{method.command}</pre>
              <div className="flex justify-end border-t border-border px-3 py-1.5">
                <CopyButton text={copyText(way, url)} label="Copy command" />
              </div>
            </div>
          )}
          {method.kind === 'address' && (
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-text">{url}</code>
              <CopyButton text={url} label="Copy address" />
            </div>
          )}

          <ol className={cn('space-y-1 text-sm leading-6 text-text-muted', way.steps.length > 1 && 'list-decimal pl-5 marker:text-text-faint')}>
            {way.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </>
      )}

      {watch !== 'off' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-text-muted" role="status">
          {watch === 'stopped' ? (
            <>
              <span>Stopped checking after 5 minutes.</span>
              <Button size="sm" variant="ghost" onClick={onCheckAgain}>Check again</Button>
            </>
          ) : (
            <>
              <Spinner size={14} />
              {watch === 'missed' ? "Couldn't check just now. Trying again." : 'Waiting for you to click Allow. This updates on its own.'}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** A way that is already connected: who, since when, and Revoke (asked once more) as the only way to connect it again. */
export function ConnectedWay({ way, clients, revoking, error, onRevoke, onCancel }: { way: AiWay; clients: ConnectedClient[]; revoking: string | null; error: RevokeError; onRevoke?: (clientId: string) => void; onCancel?: () => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="flex items-start gap-2 text-sm text-text">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span><span className="font-medium">{way.name}</span> is already connected to Tempo.</span>
      </p>
      <ul className="space-y-2">
        {clients.map((item) => {
          const confirming = confirmId === item.clientId
          return (
            <li key={item.clientId}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-sm text-text-muted">
                  {item.name}{item.grantedOn && <> · since {item.grantedOn}</>}
                </span>
                {onRevoke && (
                  <div className="flex items-center gap-2">
                    {confirming && <Button size="sm" variant="ghost" disabled={revoking === item.clientId} onClick={() => { setConfirmId(null); onCancel?.() }}>Cancel</Button>}
                    <Button
                      size="sm"
                      variant={confirming ? 'danger' : 'secondary'}
                      loading={revoking === item.clientId}
                      onClick={() => (confirming ? onRevoke(item.clientId) : setConfirmId(item.clientId))}
                      aria-label={confirming ? undefined : `Revoke ${item.name}`}
                    >
                      {confirming ? 'Revoke access' : 'Revoke'}
                    </Button>
                  </div>
                )}
              </div>
              {error?.id === item.clientId && <p role="alert" className="mt-1 text-xs text-danger">{error.text}</p>}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-text-muted">To connect it again, revoke its access first. Revoking signs it out of Tempo.</p>
    </div>
  )
}

/** After a new app connects: say so, and offer to disconnect the ones from before (switching apps). */
export function ConnectedNotice({ fresh, others, revoking, error, onDisconnect }: { fresh: ConnectedClient[]; others: ConnectedClient[]; revoking: string | null; error: RevokeError; onDisconnect: (clientId: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-sm text-text" role="status">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span><span className="font-medium">{fresh.map((item) => item.name).join(', ')}</span> {fresh.length > 1 ? 'are' : 'is'} connected to Tempo.</span>
      </p>
      {others.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm text-text">Switching? These are still connected:</p>
          <ul className="mt-2 space-y-2">
            {others.map((item) => (
              <li key={item.clientId}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-sm text-text-muted">{item.name}</span>
                  <Button size="sm" variant="secondary" loading={revoking === item.clientId} onClick={() => onDisconnect(item.clientId)}>Disconnect {item.name}</Button>
                </div>
                {error?.id === item.clientId && <p role="alert" className="mt-1 text-xs text-danger">{error.text}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">Or keep them: several apps can be connected at once.</p>
        </div>
      )}
    </div>
  )
}

export function CopyButton({ text, label, onCopied }: { text: string; label: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopied?.()
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      useUI.getState().notify("Couldn't copy. Select the text and copy it instead.", 'danger')
    }
  }

  return (
    <>
      <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copy()} aria-label={label} className="shrink-0">
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {/* The button keeps its name, so say "Copied" to screen readers here. */}
      <span className="sr-only" role="status">{copied ? 'Copied' : ''}</span>
    </>
  )
}

// ── Connected clients ───────────────────────────────────────────────────────────────────────────────────────────

export interface ClientsListProps {
  state: ClientsState
  confirmId: string | null
  revoking: string | null
  error: { id: string; text: string } | null
  onRetry: () => void
  onAskRevoke: (clientId: string) => void
  onCancel: () => void
  onRevoke: (clientId: string) => void
  className?: string
}

export function ClientsList({ state, confirmId, revoking, error, onRetry, onAskRevoke, onCancel, onRevoke, className }: ClientsListProps) {
  if (state.status === 'loading') {
    return (
      <div className={className} role="status" aria-label="Loading connected AI apps">
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={className} role="alert">
        <p className="text-sm text-danger">Couldn&apos;t load your connected AI apps. Nothing changed.</p>
        <Button className="mt-2" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    )
  }
  if (!state.clients.length) {
    return (
      <div className={className}>
        <EmptyState compact icon={Plug} title="No AI app connected" body="Connect an AI app above. It shows up here once you click Allow." className="rounded-lg border border-dashed border-border" />
      </div>
    )
  }
  return (
    <ul className={className}>
      {state.clients.map((item) => {
        const confirming = confirmId === item.clientId
        const failed = error?.id === item.clientId ? error.text : null
        return (
          <li key={item.clientId} className="border-b border-border py-2.5 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text"><AiLogo id={matchClient(item.name)?.brand ?? 'any'} className="size-4" /></span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-text">{item.name}</p>
                  {item.grantedOn && <p className="text-xs text-text-muted">Connected {item.grantedOn}</p>}
                </div>
              </div>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="danger" loading={revoking === item.clientId} onClick={() => onRevoke(item.clientId)}>Revoke access</Button>
                  <Button size="sm" variant="ghost" disabled={revoking === item.clientId} onClick={onCancel}>Cancel</Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onAskRevoke(item.clientId)} aria-label={`Revoke ${item.name}`}>Revoke</Button>
              )}
            </div>
            {confirming && !failed && <p className="mt-2 text-xs text-text-muted">{item.name} will be signed out of Tempo. It can connect again if you allow it.</p>}
            {failed && <p role="alert" className="mt-2 text-xs text-danger">{failed}</p>}
          </li>
        )
      })}
    </ul>
  )
}
