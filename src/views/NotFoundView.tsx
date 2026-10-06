import { FileQuestion } from 'lucide-react'
import { useSession } from '../data/session'
import { navigate } from '../lib/router'
import { Button, EmptyState } from '../components/ui'

export default function NotFoundView() {
  const signedIn = useSession((s) => s.status === 'signed-in')

  return (
    <main className="grid min-h-dvh place-items-center bg-bg">
      <EmptyState
        icon={FileQuestion}
        title="That page isn't here"
        body="The address may have a typo, or the app was removed. Nothing changed on your side."
        action={<>
          <Button variant="primary" onClick={() => navigate({ name: signedIn ? 'portfolio' : 'home' })}>
            {signedIn ? 'Go to Portfolio' : 'Go to Tempo'}
          </Button>
          <Button variant="ghost" onClick={() => window.history.back()}>Go back</Button>
        </>}
      />
    </main>
  )
}
