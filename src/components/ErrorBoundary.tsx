import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useSession } from '../data/session'
import { navigate } from '../lib/router'
import { Button } from './ui/Button'

/** Remount with the route key so a failed page cannot poison the next page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tempo page failed', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section role="alert" className="mx-auto flex max-w-xl flex-col items-start gap-5 px-6 py-16 text-text">
        <p className="text-lg">Something broke on this page. Your data is safe.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="secondary" onClick={() => navigate({ name: useSession.getState().status === 'signed-in' ? 'portfolio' : 'home' })}>
            Go to your apps
          </Button>
        </div>
      </section>
    )
  }
}
