import { Mark } from './Logo'

/** Shared hydration/session/public-view loader; visible immediately after the boot mark. */
export function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-bg" role="status" aria-label="Loading Tempo">
      <div className="flex flex-col items-center gap-3" aria-hidden="true">
        <Mark size={40} loading />
        <span className="text-sm font-medium text-text-muted">Tempo</span>
      </div>
    </div>
  )
}
