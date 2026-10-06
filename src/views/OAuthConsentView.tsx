// Consent page for AI clients (real path /oauth/consent?authorization_id=…, not a hash route).
// Supabase's OAuth server sends the browser here. The user checks who is asking, then allows or denies, and Supabase
// sends the browser back to the client. Tempo never sees the client's tokens.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js'
import { Check, TriangleAlert, X } from 'lucide-react'
import { useSession } from '../data/session'
import { CONSENT_CAN, CONSENT_CANNOT, consentErrorText, describeRedirect, parseAuthorizationId, safeRedirectUrl, scopeLines, type RedirectHost } from '../lib/oauthConsent'
import { ALLOWED_KEY, clientLabel, matchClient } from '../lib/mcpSetup'
import { markPendingCopied, readPendingMessage, type PendingMessage } from '../data/claudeHandoff'
import { Mark } from '../components/Logo'
import { AuthShell } from '../components/landing/AuthShell'
import { SignInButtons } from '../components/landing/SignIn'
import { Button, Skeleton } from '../components/ui'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; text: string; detail?: string; retry?: boolean }
  | { kind: 'ready'; details: OAuthAuthorizationDetails }
  | { kind: 'sent'; text: string }

const GENERIC_FAIL = "Couldn't reach the sign-in service. Nothing was shared. Try again."

/** Tell an open Settings tab at once, through the storage event: its polling slows down while it is in the background. */
function announceAllowed() {
  try {
    localStorage.setItem(ALLOWED_KEY, String(Date.now()))
  } catch { /* storage blocked: the picker still polls */ }
}

/**
 * The message the Claude window is holding (claudeHandoff.ts), when the app asking is a Claude app: Allow copies it, so
 * the person pastes it in Claude straight away. Any other app gets nothing.
 */
export function messageToCopy(clientName: string | null | undefined, pending: PendingMessage | null): PendingMessage | null {
  return pending && matchClient(clientLabel(clientName))?.brand === 'claude' ? pending : null
}

export default function OAuthConsentView() {
  const status = useSession((state) => state.status)
  const sessionUser = useSession((state) => state.user)
  const authId = useMemo(() => parseAuthorizationId(window.location.search), [])
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null)
  const [actionError, setActionError] = useState<{ text: string; detail?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!authId || status !== 'signed-in') return
    let live = true
    setPhase({ kind: 'loading' })
    void (async () => {
      try {
        const { client } = await import('../data/cloud')
        const { data, error } = await client().auth.oauth.getAuthorizationDetails(authId)
        if (!live) return
        if (error || !data) {
          setPhase({
            kind: 'error',
            title: "This request can't be shown",
            text: 'It may have expired or already been used. Go back to your AI app and connect again.',
            detail: consentErrorText(error?.message),
            retry: true,
          })
        } else if ('authorization_id' in data) {
          setPhase({ kind: 'ready', details: data })
        } else {
          // Already allowed once: Supabase answers with the way back instead of asking again.
          const target = safeRedirectUrl(data.redirect_url)
          if (!target) setPhase({ kind: 'error', title: "Can't send you back", text: 'The address to return to is not one Tempo will open. Nothing was shared.' })
          else {
            setPhase({ kind: 'sent', text: 'Already allowed. Taking you back to your AI app…' })
            announceAllowed()
            window.location.assign(target)
          }
        }
      } catch {
        if (live) setPhase({ kind: 'error', title: "This request can't be shown", text: GENERIC_FAIL, retry: true })
      }
    })()
    return () => {
      live = false
    }
  }, [authId, status, attempt])

  const decide = async (choice: 'allow' | 'deny', details: OAuthAuthorizationDetails) => {
    setBusy(choice)
    setActionError(null)
    // Copying starts inside the click, while the browser still allows it; the approval below takes a moment.
    const message = choice === 'allow' ? messageToCopy(details.client.name, readPendingMessage()) : null
    let copying: Promise<boolean> = Promise.resolve(false)
    if (message) {
      try {
        copying = navigator.clipboard.writeText(message.prompt).then(() => true, () => false)
      } catch { /* No clipboard: the Tempo tab still has the message. */ }
    }
    try {
      const { client } = await import('../data/cloud')
      const oauth = client().auth.oauth
      const { data, error } = choice === 'allow'
        ? await oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true })
      const target = error ? null : safeRedirectUrl(data?.redirect_url)
      if (!target) throw error ?? new Error('No safe address to return to.')
      const name = clientLabel(details.client.name)
      const copied = await copying
      // Only once Claude is really allowed: the Tempo tab then starts waiting for the drafts.
      if (copied && message) markPendingCopied(message)
      setPhase({ kind: 'sent', text: choice === 'allow'
        ? `Allowed.${copied ? ' Your message is copied: in Claude, start a new chat and paste it.' : ''} Taking you back to ${name}…`
        : `Denied. Taking you back to ${name}…` })
      if (choice === 'allow') announceAllowed()
      window.location.assign(target)
    } catch (e) {
      setActionError({ text: choice === 'allow' ? "Couldn't allow it. Nothing was shared. Try again." : "Couldn't deny it. Try again.", detail: consentErrorText(e instanceof Error ? e.message : null) })
      setBusy(null)
    }
  }

  let body: ReactNode
  if (!authId) {
    body = <Problem title="This link is missing its request" text="Go back to your AI app and start the connection again." />
  } else if (status === 'off') {
    body = <Problem title="Sign-in isn't set up here" text="This Tempo can't connect AI apps yet. Nothing changed." />
  } else if (status === 'loading') {
    body = <Waiting label="Checking your session" />
  } else if (status === 'signed-out') {
    body = <SignedOut />
  } else if (phase.kind === 'loading') {
    body = <Waiting label="Loading the request" />
  } else if (phase.kind === 'error') {
    body = <Problem title={phase.title} text={phase.text} detail={phase.detail} onRetry={phase.retry ? () => setAttempt((n) => n + 1) : undefined} />
  } else if (phase.kind === 'sent') {
    body = <Sent text={phase.text} />
  } else {
    const details = phase.details
    body = (
      <ConsentBody
        details={details}
        redirect={describeRedirect(details.redirect_uri)}
        account={details.user?.email || sessionUser?.email || sessionUser?.name || ''}
        copiesMessage={messageToCopy(details.client.name, readPendingMessage()) !== null}
        busy={busy}
        error={actionError}
        onAllow={() => void decide('allow', details)}
        onDeny={() => void decide('deny', details)}
        onSignOut={() => void useSession.getState().signOut()}
      />
    )
  }

  return (
    <AuthShell homeHref="/" below={authId && status === 'signed-in' ? 'You can turn this off any time in Settings, under Connect your AI.' : undefined}>
      {body}
    </AuthShell>
  )
}

function Head({ title, text }: { title: string; text?: ReactNode }) {
  return (
    <div className="text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-soft">
        <Mark size={30} />
      </span>
      <h1 className="mt-4 break-words text-xl font-semibold tracking-tight text-text">{title}</h1>
      {text && <p className="mt-1 break-words text-sm text-text-muted">{text}</p>}
    </div>
  )
}

function Waiting({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      <Head title="Connect your AI" text="One moment." />
      <div className="mt-6 space-y-2" aria-hidden>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  )
}

function SignedOut() {
  return (
    <div>
      <Head title="Sign in to connect your AI" text="An AI app wants to use Tempo for you. Sign in first, then you can allow or deny it." />
      <div className="mt-6">
        <SignInButtons layout="stack" primaryGithub />
      </div>
      <p className="mt-4 text-center text-xs text-text-faint">You will come back to this page to finish.</p>
    </div>
  )
}

function Problem({ title, text, detail, onRetry }: { title: string; text: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-danger-soft text-danger">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 break-words text-xl font-semibold tracking-tight text-text">{title}</h1>
      <p className="mt-1 text-sm text-text-muted">{text}</p>
      {detail && <p className="mt-2 break-words text-xs text-text-faint">{detail}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && <Button variant="primary" onClick={onRetry}>Try again</Button>}
        <a href="/" className="focus-ring inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-text-muted hover:bg-surface-2 hover:text-text">Open Tempo</a>
      </div>
    </div>
  )
}

function Sent({ text }: { text: string }) {
  return (
    <div role="status" className="text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-success-soft text-success">
        <Check className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-text">{text}</h1>
      <p className="mt-1 text-sm text-text-muted">If nothing happens, you can close this tab and go back to your AI app.</p>
    </div>
  )
}

export interface ConsentBodyProps {
  details: Pick<OAuthAuthorizationDetails, 'client'> & Partial<Pick<OAuthAuthorizationDetails, 'scope'>>
  redirect: RedirectHost | null
  /** The signed-in account, shown so the person knows whose portfolio the app gets. */
  account: string
  /** Allow also copies the message the Claude window is holding. */
  copiesMessage?: boolean
  busy: 'allow' | 'deny' | null
  error: { text: string; detail?: string } | null
  onAllow: () => void
  onDeny: () => void
  onSignOut: () => void
}

/** The question itself: who is asking, where it goes back to, what it can and can't do, and the two answers. */
export function ConsentBody({ details, redirect, account, copiesMessage = false, busy, error, onAllow, onDeny, onSignOut }: ConsentBodyProps) {
  const name = clientLabel(details.client.name)
  return (
    <div>
      <Head title={`${name} wants to connect`} text="Allow it to use Tempo as you?" />

      <dl className="mt-6 space-y-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-sm">
        <Row term="App">{name}</Row>
        <Row term="Returns to">
          {redirect ? (
            <>
              <span className="break-all font-mono text-xs">{redirect.display}</span>
              {redirect.local && <span className="ml-2 text-xs text-text-muted">This computer</span>}
            </>
          ) : (
            <span className="text-danger">An address Tempo can&apos;t read</span>
          )}
        </Row>
        <Row term="Signed in as">
          <span className="break-all">{account || 'your account'}</span>{' '}
          <button type="button" onClick={onSignOut} className="focus-ring rounded-sm text-xs text-text-muted underline underline-offset-2 hover:text-text">Not you?</button>
        </Row>
      </dl>

      {redirect?.insecure && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>This address is not secure (http). Allow it only if you trust it.</span>
        </p>
      )}
      {!redirect && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Tempo can&apos;t tell where this app sends you back, so it can&apos;t be allowed. Deny it, then check the app.</span>
        </p>
      )}

      <div className="mt-5">
        <h2 className="text-xs font-medium text-text-muted">If you allow it</h2>
        <ul className="mt-2 space-y-2 text-sm text-text">
          {CONSENT_CAN.map((line) => <Point key={line} yes>{line}</Point>)}
          {scopeLines(details.scope).map((line) => <Point key={line} yes>{line}</Point>)}
          {CONSENT_CANNOT.map((line) => <Point key={line}>{line}</Point>)}
        </ul>
      </div>

      {error && (
        <div role="alert" className="mt-4 text-sm text-danger">
          <p>{error.text}</p>
          {error.detail && <p className="mt-0.5 break-words text-xs text-text-faint">{error.detail}</p>}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button block size="lg" disabled={busy !== null} loading={busy === 'deny'} onClick={onDeny}>Deny</Button>
        <Button block size="lg" variant="primary" disabled={busy !== null || !redirect} loading={busy === 'allow'} onClick={onAllow}>Allow access</Button>
      </div>
      {copiesMessage && (
        <p className="mt-3 text-center text-xs text-text-muted">Allow also copies your message for Claude. Back in Claude, start a new chat and paste it.</p>
      )}
      <p className="mt-3 text-center text-xs text-text-faint">Only allow an app you started yourself.</p>
    </div>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs text-text-muted">{term}</dt>
      <dd className="min-w-0 break-words text-right text-text">{children}</dd>
    </div>
  )
}

function Point({ yes = false, children }: { yes?: boolean; children: ReactNode }) {
  const Icon = yes ? Check : X
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={yes ? 'mt-0.5 size-4 shrink-0 text-success' : 'mt-0.5 size-4 shrink-0 text-text-faint'} aria-hidden />
      <span className="min-w-0 break-words leading-5">{children}</span>
    </li>
  )
}
