import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { cloudConfigured, useSession } from './data/session'
import { isGitHubPopup } from './data/githubPopup'
import { GitHubPopupPage } from './components/GitHubPopupPage'

const githubPopup = isGitHubPopup()

// Cloud mode only when Supabase is configured; guest mode never downloads the Supabase client.
if (cloudConfigured && !githubPopup) {
  import('./data/cloud')
    .then((m) => m.initCloud())
    .catch(() => useSession.setState({ status: 'signed-out', error: "Couldn't reach the sign-in service. Nothing changed on your side. Try again in a minute." }))
}

createRoot(document.getElementById('root')!).render(
  githubPopup ? <GitHubPopupPage /> : <StrictMode><App /></StrictMode>,
)
