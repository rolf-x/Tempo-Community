import { useEffect, useState } from 'react'
import { cloudConfigured } from '../data/session'

export function GitHubPopupPage() {
  const [message, setMessage] = useState('Connecting GitHub…')

  useEffect(() => {
    if (!cloudConfigured) {
      setMessage("GitHub couldn't connect. Close this window and try again.")
      return
    }
    void import('../data/cloud')
      .then((cloud) => cloud.initGitHubPopup((state, error) => {
        setMessage(state === 'connected' ? 'GitHub connected. You can close this window.' : error ?? "GitHub couldn't connect. Close this window and try again.")
      }))
      .catch(() => setMessage("GitHub couldn't connect. Close this window and try again."))
  }, [])

  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6">
      <p className="text-center text-sm text-text">{message}</p>
    </main>
  )
}
