import { UserX } from 'lucide-react'
import { signOutToHome, useSession } from '../data/session'
import { navigate } from '../lib/router'
import { AuthShell } from '../components/landing/AuthShell'
import { Button, EmptyState } from '../components/ui'

export default function RemovedWorkspaceView() {
  const removedFrom = useSession((state) => state.removedFrom)

  const startOwnWorkspace = () => {
    useSession.setState({ removedFrom: null, needsSetup: true })
    navigate({ name: 'setup' })
  }

  return (
    <AuthShell>
      <EmptyState
        compact
        icon={UserX}
        title={`You were removed from ${removedFrom?.name || 'this workspace'}.`}
        body="Ask an admin there for a new invite."
        action={<>
          <Button variant="primary" onClick={() => void signOutToHome()}>Sign out</Button>
          <Button variant="ghost" onClick={startOwnWorkspace}>Start my own workspace</Button>
        </>}
      />
    </AuthShell>
  )
}
