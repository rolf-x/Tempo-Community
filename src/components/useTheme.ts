// Applies settings.theme to <html> (.dark class + color-scheme) and mirrors it to localStorage so
// index.html can apply it before the first paint. Follows the OS while theme === 'system'.
import { useEffect } from 'react'
import { useStore } from '../store/useStore'

const BG = { light: '#FFFFFF', dark: '#0B0C12' }

export function useTheme(enabled = true) {
  const theme = useStore((s) => s.settings.theme)

  useEffect(() => {
    if (!enabled) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      const root = document.documentElement
      root.classList.toggle('dark', dark)
      root.style.colorScheme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? BG.dark : BG.light)
      try {
        localStorage.setItem('tempo-theme-v2', theme) // v2: dark became the default, so older light values are ignored
      } catch {
        // private mode: no flash prevention, nothing else breaks
      }
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, enabled])
}
