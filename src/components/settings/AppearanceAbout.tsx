import { Monitor, Moon, Sun } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { Theme } from '../../types'
import { SegmentedControl } from '../ui'
import { Mark } from '../Logo'
import { Field, Section } from './Section'

export function AppearanceCard() {
  const theme = useStore((s) => s.settings.theme)
  const setSettings = useStore((s) => s.setSettings)
  return (
    <Section title="Appearance">
      <Field label="Theme">
        <SegmentedControl<Theme>
          aria-label="Theme"
          value={theme}
          onChange={(t) => setSettings({ theme: t })}
          collapseLabels="never"
          options={[
            { value: 'system', label: 'System', icon: Monitor },
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
          ]}
        />
      </Field>
    </Section>
  )
}

export function AboutCard() {
  return (
    <Section title="About">
      <div className="flex items-center gap-3">
        <Mark size={32} />
        <div className="min-w-0">
          <p className="text-sm text-text">Tempo: know every app your company vibe-coded.</p>
          <p className="text-xs text-text-muted">Version 0.1.0</p>
        </div>
      </div>
    </Section>
  )
}
