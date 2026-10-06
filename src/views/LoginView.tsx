// Sign-in page (#/login). GitHub only: it's how Tempo reads your repos.
import { useEffect } from 'react'
import { Eye } from 'lucide-react'
import { useSession } from '../data/session'
import { navigate } from '../lib/router'
import { Mark } from '../components/Logo'
import { AuthShell } from '../components/landing/AuthShell'
import { SignInButtons } from '../components/landing/SignIn'
import { Skeleton } from '../components/ui'

export default function LoginView() {
  const status = useSession((s) => s.status)

  useEffect(() => {
    if (status === 'signed-in') navigate({ name: 'portfolio' })
  }, [status])

  return (
    <AuthShell below="New here? Signing in creates your account.">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-soft">
          <Mark size={30} />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-text">Sign in to Tempo</h1>
        <p className="mt-1 text-sm text-text-muted">Your team’s apps, in one place.</p>
      </div>

      <div className="mt-6" aria-busy={status === 'loading' || undefined}>
        {status === 'loading' ? (
          <div className="space-y-2" aria-label="Checking your session">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <SignInButtons layout="stack" primaryGithub />
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-md bg-bg px-3 py-2.5 text-xs text-text-muted">
        <Eye className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
        <span>What Tempo reads: repo metadata, README, agent notes, commits, PRs and issues. Tempo only reads, and the token stays in your browser. GitHub's permission for private repos also allows writes; Tempo never uses that.</span>
      </p>

    </AuthShell>
  )
}
