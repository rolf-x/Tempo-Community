import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, useStore } from '../../store/useStore'
import { ThemeSwitch } from './ThemeSwitch'

// The server renderer reads a store's initial state, so route the hook through the live state instead.
vi.mock('../../store/useStore', async (original) => {
  const actual = await original<typeof import('../../store/useStore')>()
  return { ...actual, useStore: Object.assign((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState()), actual.useStore) }
})

const render = () => renderToStaticMarkup(createElement(ThemeSwitch))

beforeEach(() => useStore.setState({ settings: defaultSettings() }))

describe('ThemeSwitch', () => {
  it('starts dark for a new visitor and offers light', () => {
    expect(defaultSettings().theme).toBe('dark')
    expect(render()).toContain('aria-label="Switch to light mode"')
  })

  it('offers dark once the visitor picked light', () => {
    useStore.getState().setSettings({ theme: 'light' })
    expect(render()).toContain('aria-label="Switch to dark mode"')
  })
})
