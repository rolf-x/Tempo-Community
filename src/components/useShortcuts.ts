// Global keyboard shortcuts. Mounted once in App.
//   ⌘K/Ctrl+K command bar (toggle)
//   Esc      close overlays and the mobile sidebar
// Ignored while typing in inputs, textareas, selects or contenteditable, and while a modal overlay is open.
import { useEffect } from 'react'
import { useUI } from './uiState'

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return
      const ui = useUI.getState()
      const mod = e.metaKey || e.ctrlKey

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // Not over Sync all's progress window: hide it first.
        if (!ui.syncWindowOpen) ui.setCommandOpen(!ui.commandOpen)
        return
      }

      if (e.key === 'Escape') {
        if (ui.anyModalOpen() || ui.sidebarOpen) ui.closeAll()
        return
      }

      if (mod || e.altKey || isTyping(e.target) || ui.anyModalOpen()) return

    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
