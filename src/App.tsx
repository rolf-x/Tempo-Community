// App shell: sidebar + topbar + routed view, overlays and the toast host. See docs/design.md.
// Views are code-split: the landing view starts loading while the store hydrates, the rest warm up when idle.
import { Suspense, lazy, useEffect } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import { Analytics } from '@vercel/analytics/react'
import { useStore } from './store/useStore'
import { isPublicRoute, navigate, toHash, useRoute, type Route } from './lib/router'
import { useSession } from './data/session'
import { whenIdle } from './lib/idle'
import { canEnterApp, gateRedirect } from './lib/entry'
import { isConsentPath } from './lib/oauthConsent'
import { pageOnly, pagePath } from './lib/analytics'
import { useTheme } from './components/useTheme'
import { useShortcuts } from './components/useShortcuts'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Splash } from './components/Splash'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OverlaySlots } from './components/OverlaySlots'
import { PendingSaveIndicator } from './components/PendingSaveIndicator'
import { ClaudeNotices } from './components/onboarding/ClaudeNotices'
import { AutoLinkInstallations } from './components/AutoLinkInstallations'
import { ClaudeWritingIndicator } from './components/ClaudeWritingIndicator'
import { SyncAllProgress } from './components/SyncAllProgress'
import { useUI } from './components/uiState'
import { DUR, Page, Skeleton, SkeletonRow, ToastHost } from './components/ui'
import { ConnectGitHubDialogHost } from './components/ConnectGitHubDialog'

const load = {
  settings: () => import('./views/SettingsView'),
  portfolio: () => import('./views/PortfolioView'),
  review: () => import('./views/ReviewView'),
  app: () => import('./views/AppView'),
  landing: () => import('./views/LandingView'),
  login: () => import('./views/LoginView'),
  join: () => import('./views/JoinView'),
  setup: () => import('./views/SetupView'),
  removed: () => import('./views/RemovedWorkspaceView'),
  directory: () => import('./views/DirectoryView'),
  privacy: () => import('./views/PrivacyView'),
  notFound: () => import('./views/NotFoundView'),
}
const OAuthConsentView = lazy(() => import('./views/OAuthConsentView'))
const SettingsView = lazy(load.settings)
const PortfolioView = lazy(load.portfolio)
const ReviewView = lazy(load.review)
const DirectoryView = lazy(load.directory)
const AppView = lazy(load.app)
const LandingView = lazy(load.landing)
const LoginView = lazy(load.login)
const SetupView = lazy(load.setup)
const RemovedWorkspaceView = lazy(load.removed)
const JoinView = lazy(load.join)
const PrivacyView = lazy(load.privacy)
const NotFoundView = lazy(load.notFound)

function loaderFor(route: Route) {
  switch (route.name) {
    case 'project':
      return load.app
    case 'home':
    case 'welcome':
      return load.landing
    default:
      return load[route.name]
  }
}

/**
 * The AI-client consent page lives at a real path (/oauth/consent?authorization_id=…) because Supabase redirects the browser
 * to it. It is not a hash route, so it skips the router, the shell and page analytics (the request id stays out of the stats).
 */
export default function App() {
  return isConsentPath(window.location.pathname) ? <ConsentApp /> : <MainApp />
}

function ConsentApp() {
  const hydrated = useStore((s) => s.hydrated)
  useTheme(hydrated)
  return (
    <MotionConfig reducedMotion="user">
      {hydrated ? (
        <ErrorBoundary>
          <Suspense fallback={<Splash />}>
            <OAuthConsentView />
          </Suspense>
        </ErrorBoundary>
      ) : <Splash />}
      <ToastHost />
    </MotionConfig>
  )
}

function MainApp() {
  const hydrated = useStore((s) => s.hydrated)
  const route = useRoute()
  useTheme(hydrated)
  useShortcuts()
  useSessionErrorToast()

  useEffect(() => {
    void loaderFor(route)()
    return whenIdle(() => Object.values(load).forEach((l) => void l()))
    // Only on mount: later navigations load on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      {hydrated ? <Gate route={route} /> : <Splash />}
      <ToastHost />
      <PendingSaveIndicator />
      <ClaudeWritingIndicator />
      <SyncAllProgress />
      <ConnectGitHubDialogHost />
      {/* Tempo's pages live in the hash, which Vercel's tracker ignores: report each page change by name. */}
      <Analytics beforeSend={pageOnly} route={pagePath(toHash(route))} path={pagePath(toHash(route))} />
    </MotionConfig>
  )
}

/** Sign-in and sync errors land in the session store; surface each new one as a toast on whatever page is open. */
function useSessionErrorToast() {
  const error = useSession((s) => s.error)
  useEffect(() => {
    if (error) useUI.getState().notify(error, 'danger')
  }, [error])
}

/**
 * Public pages (landing, login, join, privacy) render without the shell. #/ is always the landing page (it offers "Open Tempo"
 * once you've entered); app pages send a visitor who hasn't entered yet (no demo, no sign-in) back to it.
 */
function Gate({ route }: { route: Route }) {
  const onboarded = useStore((s) => s.settings.onboarded)
  const demo = useStore((s) => s.settings.demo)
  const hasWorkspace = useStore((s) => !!s.workspace)
  const status = useSession((s) => s.status)
  const loading = status === 'loading'
  const needsSetup = useSession((s) => s.needsSetup)
  const removedFrom = useSession((s) => s.removedFrom)
  const entered = canEnterApp({ status, demo, onboarded })
  const removed = status === 'signed-in' && removedFrom !== null && route.name !== 'join' && route.name !== 'privacy'
  const redirect = loading || removed ? null : gateRedirect(route.name, { entered, signedIn: status === 'signed-in', needsSetup, hasWorkspace })

  useEffect(() => {
    if (redirect) navigate({ name: redirect })
  }, [redirect])

  if (loading || redirect) return <Splash />
  if (removed) return <ErrorBoundary><Suspense fallback={<Splash />}><RemovedWorkspaceView /></Suspense></ErrorBoundary>
  if (isPublicRoute(route)) {
    return (
      <ErrorBoundary key={toHash(route)}>
      <Suspense fallback={<Splash />}>
        {route.name === 'notFound' ? <NotFoundView /> : route.name === 'privacy' ? <PrivacyView /> : route.name === 'setup' ? <SetupView /> : route.name === 'login' ? <LoginView /> : route.name === 'join' ? <JoinView token={route.token} /> : <LandingView />}
      </Suspense>
      </ErrorBoundary>
    )
  }
  return <Shell route={route} />
}

function Shell({ route }: { route: Route }) {
  const projects = useStore((s) => s.projects)
  const missing = route.name === 'project' && !projects.some((p) => p.id === route.projectId)

  // A project route that points nowhere (deleted, bad link, empty store) goes home.
  useEffect(() => {
    if (missing) navigate({ name: 'portfolio' })
  }, [missing])

  const key = route.name === 'project' ? `${route.projectId}/${route.view}` : route.name

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Keyboard users: jump past the sidebar. A button, not a hash link, so the router stays untouched. */}
      <button
        type="button"
        onClick={() => document.getElementById('main')?.focus()}
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:border focus:border-border focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-text focus:shadow-md"
      >
        Skip to content
      </button>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <Topbar />
        <ClaudeNotices />
        <AutoLinkInstallations />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {/* Fade only: a translate on the scroll container's child would add scrollable overflow. */}
          {!missing && (
            <motion.div key={key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.base }}>
              <ErrorBoundary key={toHash(route)}>
              <Suspense fallback={<ViewFallback />}>
                <View route={route} />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}
        </main>
      </div>
      <OverlaySlots />
    </div>
  )
}

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'settings':
      return <SettingsView />
    case 'portfolio':
      return <PortfolioView />
    case 'review':
      return <ReviewView />
    case 'directory':
      return <DirectoryView />
    case 'home':
    case 'welcome':
    case 'login':
    case 'join':
    case 'notFound':
      return null // handled by Gate
    case 'project':
      return <AppView projectId={route.projectId} />
  }
}

/** Shown while a view's chunk loads (first visit only; later visits are instant). */
function ViewFallback() {
  return (
    <Page width="narrow">
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="mb-2 h-3 w-28" />
        <Skeleton className="mb-7 h-6 w-56" />
        <div className="space-y-1">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </Page>
  )
}
