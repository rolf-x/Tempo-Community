import { useSession } from '../data/session'
import { Button, type ButtonProps } from './ui'
import { requestGitHubConnection } from './ConnectGitHubDialog'

export type ReconnectGitHubProps = Omit<ButtonProps, 'children' | 'loading' | 'onClick'> & {
  label?: string
}

/** Starts GitHub OAuth and returns to the current app page when it finishes. */
export function ReconnectGitHub({ label = 'Reconnect GitHub', disabled, ...props }: ReconnectGitHubProps) {
  const status = useSession((state) => state.status)
  return (
    <Button {...props} disabled={disabled || status !== 'signed-in'} onClick={() => void requestGitHubConnection()}>
      {label}
    </Button>
  )
}
