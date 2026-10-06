// mcp and both modes: telling a person Claude isn't connected. A revoke shows "Claude isn't connected" at the
// top at once, and signing in again with Claude still disconnected opens a pop-up that either connects Claude or closes.
// The banner sits above every page until Claude is connected or it's closed for this sign-in; the pop-up (the Claude
// window, reason `reconnect`) comes once per sign-in. Both wait for the first apps, so a first visit asks for apps first.
// With an API key saved (both mode) Tempo writes the descriptions itself, so neither shows: Claude is then optional,
// for the tasks it adds, and Settings → Connect your AI is where to connect it.
import { useEffect } from 'react'
import { Unplug, X } from 'lucide-react'
import { claudeConnected, useAIApps, useWatchAIApps } from '../../data/aiApps'
import { useSession } from '../../data/session'
import { canWriteCards } from '../../ai/workspaceAI'
import { mcpEnabled } from '../../lib/aiMode'
import { claudeNotice, claudeNoticeOn } from '../../lib/claudeNotice'
import { isSampleRepo } from '../../lib/sampleRepo'
import { useStore } from '../../store/useStore'
import { useGuideState } from '../guide/guideState'
import { Button, IconButton } from '../ui'
import { openClaudeWindow, useUI } from '../uiState'

function useClaudeNotice() {
  const signedIn = useSession((s) => s.status === 'signed-in')
  const userId = useSession((s) => s.user?.id ?? null)
  const signIn = useSession((s) => s.user?.lastSignInAt ?? null)
  const demo = useStore((s) => s.settings.demo)
  const hasApps = useStore((s) => s.projects.some((p) => !p.archived && !isSampleRepo(p)))
  const keyed = useStore((s) => canWriteCards(s.settings))
  const on = claudeNoticeOn({ mcp: mcpEnabled(), keyed, signedIn, demo, userId })
  useWatchAIApps(userId, on)
  const connected = useAIApps((s) => claudeConnected(s, userId))
  const notice = useGuideState((s) => (userId ? s.claude[userId] : undefined))
  return { ...claudeNotice({ on, connected, hasApps, signIn, notice }), userId, signIn }
}

/** Mounted once in the app shell, above the page. */
export function ClaudeNotices() {
  const view = useClaudeNotice()
  const modalOpen = useUI((s) => s.anyModalOpen())
  const { settle, remind, userId, signIn } = view

  // Once per sign-in, as soon as the workspace and the connection list are in (and nothing else is open).
  useEffect(() => {
    if (!settle || !userId || !signIn || modalOpen) return
    useGuideState.getState().setClaudeNotice(userId, { remindedFor: signIn })
    if (remind) openClaudeWindow('reconnect')
  }, [settle, remind, userId, signIn, modalOpen])

  if (!view.banner) return null
  return <ClaudeBanner onConnect={() => openClaudeWindow('reconnect')} onHide={() => {
    if (userId && signIn) useGuideState.getState().setClaudeNotice(userId, { bannerHiddenFor: signIn })
  }} />
}

export function ClaudeBanner({ onConnect, onHide }: { onConnect: () => void; onHide: () => void }) {
  return (
    <div role="status" className="flex items-center gap-3 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-text sm:px-6">
      <Unplug className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Claude isn&apos;t connected.</span>{' '}
        <span className="hidden text-text-muted sm:inline">Claude writes your app descriptions and adds tasks when an app has a problem.</span>
      </p>
      <Button size="sm" variant="primary" onClick={onConnect} className="shrink-0">Connect Claude</Button>
      <IconButton icon={X} size="sm" label="Hide until next sign-in" onClick={onHide} />
    </div>
  )
}
