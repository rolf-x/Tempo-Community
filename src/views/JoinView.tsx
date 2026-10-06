import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { useSession } from '../data/session'
import { acceptInvite, acceptInviteApps, previewInvite } from '../data/workspace'
import { navigate } from '../lib/router'
import { inviteAnswerToast, inviteDeadCopy, isInviteToken, type InvitePreview } from '../lib/invites'
import { useUI } from '../components/uiState'
import { AuthShell } from '../components/landing/AuthShell'
import { SignInButtons } from '../components/landing/SignIn'
import { Button, Checkbox, EmptyState, Skeleton, Textarea } from '../components/ui'

const INTENT_KEY = 'tempo.inviteIntent'

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: InvitePreview }
  | { kind: 'error'; message: string }

export async function acceptJoinInvite(token: string, preview: InvitePreview, confirmed: string[], note: string): Promise<string> {
  if (preview.apps.length === 0) return acceptInvite(token)
  return acceptInviteApps(token, confirmed, confirmed.length < preview.apps.length ? note : null)
}

export default function JoinView({ token }: { token: string }) {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const valid = isInviteToken(token)

  useEffect(() => {
    if (!valid || status === 'loading') return
    let cancelled = false
    setLoad({ kind: 'loading' })
    previewInvite(token)
      .then((preview) => {
        if (cancelled) return
        setLoad({ kind: 'ready', preview })
        let decline = false
        try {
          decline = sessionStorage.getItem(INTENT_KEY) === token
          sessionStorage.removeItem(INTENT_KEY)
        } catch { /* The confirmation screen still works when storage is unavailable. */ }
        setSelected(decline ? [] : preview.apps.map((app) => app.id))
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : 'Tempo could not check this invite. Check your connection and try again.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [attempt, status, token, valid])

  const preview = load.kind === 'ready' ? load.preview : null
  const inviter = preview?.inviterName || 'the person who sent it'
  const dead = !valid || (preview && preview.status !== 'ok')

  const signInNotMine = async () => {
    try {
      sessionStorage.setItem(INTENT_KEY, token)
    } catch { /* The invite itself is still remembered by the sign-in flow. */ }
    setSigningIn(true)
    try {
      await useSession.getState().signIn('github')
    } finally {
      setSigningIn(false)
    }
  }

  const submit = async (confirmed: string[]) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (!preview) return
      const workspaceName = await acceptJoinInvite(token, preview, confirmed, note)
      useUI.getState().notify(inviteAnswerToast(confirmed.length, preview.apps.length, workspaceName), 'success')
      navigate({ name: 'portfolio' })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Tempo could not confirm these apps. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (dead) {
    const copy = inviteDeadCopy(valid && preview && preview.status !== 'ok' ? preview.status : 'missing', preview?.inviterName ?? null, preview?.workspaceName ?? null)
    return (
      <AuthShell>
        <EmptyState
          compact
          icon={Users}
          title={copy.title}
          body={copy.body}
          action={<Button variant="primary" onClick={() => navigate({ name: 'home' })}>Go to Tempo</Button>}
        />
      </AuthShell>
    )
  }

  if (load.kind === 'error') {
    return (
      <AuthShell>
        <EmptyState
          compact
          icon={Users}
          title="Tempo couldn't check this invite"
          body={load.message}
          action={<Button variant="primary" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
        />
      </AuthShell>
    )
  }

  const appCount = preview?.apps.length ?? 0
  const title = preview
    ? appCount > 0
      ? `${inviter} asked you to own ${appCount} ${appCount === 1 ? 'app' : 'apps'}.`
      : `${inviter} invited you to ${preview.workspaceName || 'a Tempo workspace'}.`
    : 'Checking your invite'
  const account = user?.githubLogin ? `@${user.githubLogin}` : user?.email || user?.name

  return (
    <AuthShell>
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
          <Users className="size-6" strokeWidth={2} aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-text">{title}</h1>
        {preview?.workspaceName && appCount > 0 && <p className="mt-1 text-sm text-text-muted">{preview.workspaceName}</p>}
      </div>

      {load.kind === 'loading' ? (
        <div className="mt-6 space-y-2" aria-busy="true" aria-label="Checking your invite">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        preview && <>
          {preview.apps.length > 0 && (
            <ul className="mt-6 space-y-2">
              {preview.apps.map((app) => {
                const checked = selected.includes(app.id)
                return (
                  <li key={app.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                    {status === 'signed-in' && (
                      <Checkbox
                        checked={checked}
                        onChange={(next) => setSelected((current) => next ? [...current, app.id] : current.filter((id) => id !== app.id))}
                        aria-label={`${checked ? 'Decline' : 'Confirm'} ${app.name}`}
                      />
                    )}
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium text-text">{app.name}</span>
                      {app.repo && <span className="block truncate text-xs text-text-muted">{app.repo}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-6">
            {(status === 'off' || status === 'signed-out') && (
              <div className="space-y-2">
                <SignInButtons layout="stack" primaryGithub label="Sign in and confirm" />
                {preview.apps.length > 0 && (
                  <Button className="w-full" variant="secondary" loading={signingIn} onClick={() => void signInNotMine()}>
                    Not mine
                  </Button>
                )}
              </div>
            )}

            {status === 'signed-in' && (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">
                  You’re signed in as <span className="font-medium text-text">{account}</span>. Your answer applies to this account, even if the link was sent elsewhere.
                </p>
                {preview.apps.length > 0 && (
                  <label className="block text-left text-xs font-medium text-text-muted">
                    Note (optional)
                    <Textarea
                      className="mt-1.5"
                      rows={2}
                      maxLength={500}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Tell the admin what changed."
                    />
                  </label>
                )}
                {submitError && <p className="text-sm text-danger" role="alert">{submitError}</p>}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className="flex-1" variant="primary" loading={submitting} onClick={() => void submit(selected)}>
                    Confirm
                  </Button>
                  {preview.apps.length > 0 && (
                    <Button className="flex-1" variant="secondary" disabled={submitting} onClick={() => void submit([])}>
                      Not mine
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </AuthShell>
  )
}
