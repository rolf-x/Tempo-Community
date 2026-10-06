import { useEffect, useState } from 'react'
import { useSession } from '../data/session'

export const pendingSaveCopy = (online: boolean) => online ? 'Saving again · changes waiting' : 'Offline · changes waiting'

export function PendingSaveIndicator() {
  const pending = useSession((state) => state.status === 'signed-in' && state.pendingSave)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? false : navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  if (!pending) return null
  return <div role="status" className="fixed bottom-5 right-5 z-[59] rounded-full border border-warning/30 bg-warning-soft px-3 py-1.5 text-xs font-medium text-text shadow-md">{pendingSaveCopy(online)}</div>
}
