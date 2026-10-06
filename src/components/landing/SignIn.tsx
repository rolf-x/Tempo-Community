// Sign-in button shared by the landing, login and join pages. GitHub only: it's the
// account that connects repos. The props API is unchanged; Google is no longer offered.
// With no cloud configured (status 'off') the session store answers with an error.
import { ArrowRight } from 'lucide-react'
import { toHash } from '../../lib/router'
import { useState } from 'react'
import { useSession, type AuthProvider } from '../../data/session'
import { Button, cn } from '../ui'

/** Monochrome provider marks (currentColor), so they follow the button's text colour in both themes. */
export function ProviderMark({ provider, className }: { provider: AuthProvider; className?: string }) {
  if (provider === 'github') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={cn('shrink-0', className)}>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('shrink-0', className)}>
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z" />
    </svg>
  )
}

export interface SignInButtonsProps {
  /** stack = full-width rows (auth cards) · row = side by side from sm up (hero) */
  layout?: 'row' | 'stack'
  /** GitHub as the page's primary button (login, join and the landing hero) */
  primaryGithub?: boolean
  /** md = 40px (default) · lg = 44px, for the landing hero and closing section */
  size?: 'md' | 'lg'
  /** Centre the row and any error line (landing) */
  align?: 'start' | 'center'
  className?: string
  label?: string
}

const LG_TEXT = { fontSize: '0.9375rem' } as const

export function SignInButtons({ layout = 'row', primaryGithub = false, size = 'md', align = 'start', className, label = 'Sign in with GitHub' }: SignInButtonsProps) {
  const status = useSession((s) => s.status)
  const error = useSession((s) => s.error)
  const [busy, setBusy] = useState<AuthProvider | null>(null)
  const stack = layout === 'stack'
  const lg = size === 'lg'
  const btn = cn(primaryGithub && 'signal-pill', lg ? 'h-11 px-5' : 'h-10 px-4', stack && 'w-full')

  const signIn = async (provider: AuthProvider) => {
    setBusy(provider)
    try {
      await useSession.getState().signIn(provider)
    } finally {
      setBusy(null)
    }
  }

  // Already signed in: every sign-in button on the public pages becomes the way back into the app.
  if (status === 'signed-in') {
    return (
      <div className={cn(align === 'center' && 'flex flex-col items-center text-center', className)}>
        <a
          href={toHash({ name: 'portfolio' })}
          className={cn('focus-ring inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium shadow-xs transition-colors duration-150', btn, !primaryGithub && 'border border-border bg-surface text-text hover:bg-surface-2')}
          style={lg ? LG_TEXT : undefined}
        >
          Open Tempo <ArrowRight className="size-4" aria-hidden />
        </a>
      </div>
    )
  }

  return (
    <div className={cn(align === 'center' && 'flex flex-col items-center text-center', className)}>
      <div className={cn('flex gap-2', stack ? 'flex-col' : 'flex-col sm:flex-row', align === 'center' && 'w-full sm:w-auto sm:justify-center', lg && 'gap-3')}>
        <Button
          variant={primaryGithub ? 'primary' : 'secondary'}
          className={btn}
          style={lg ? LG_TEXT : undefined}
          loading={busy === 'github'}
          disabled={status === 'loading' || busy !== null}
          onClick={() => void signIn('github')}
        >
          {busy !== 'github' && <ProviderMark provider="github" />}
          {label}
          {primaryGithub && lg && <ArrowRight className="signal-pill-arrow" aria-hidden />}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
