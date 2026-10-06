// Light/dark switch for the public website. It writes the same settings.theme as the sidebar's switch, so the choice
// carries into the app. Two states only: a visitor wants the other look, not a "follow system" step in between.
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { IconButton } from '../ui'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const update = () => setDark(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return dark
}

export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useStore((s) => s.settings.theme)
  const setSettings = useStore((s) => s.setSettings)
  const systemDark = useSystemDark()
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  return (
    <IconButton
      icon={dark ? Sun : Moon}
      label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}
      className={className}
    />
  )
}
