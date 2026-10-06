// Claude only for now: the picker offers one brand, and in mcp mode the setup step is "Connect Claude".
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AiBrandDetail } from '../components/settings/ConnectAICard'
import { SHOWN_BRANDS, aiAppName, appName, connectLabel, shownBrands } from './mcpSetup'
import { nextStep, type GuideSnapshot } from './nextStep'
import type { Project } from '../types'

const URL = 'https://tempo.example/api/mcp'
const noop = () => {}

describe('shown brands', () => {
  it('offers Claude only, by its app and Claude Code', () => {
    expect(SHOWN_BRANDS).toEqual(['claude'])
    const brands = shownBrands(URL)
    expect(brands.map((brand) => brand.id)).toEqual(['claude'])
    expect(brands[0].ways.map((way) => way.id)).toEqual(['claude-app', 'claude-code'])
  })

  it('names the one brand in the labels, and falls back to "your AI" for several', () => {
    expect(aiAppName()).toBe('Claude')
    expect(connectLabel()).toBe('Connect Claude')
    expect(connectLabel(['claude', 'chatgpt'])).toBe('Connect your AI')
    expect(shownBrands(URL, ['chatgpt', 'claude']).map((brand) => brand.id)).toEqual(['claude', 'chatgpt'])
  })

  it('gives a connected client its way\'s short name, or keeps its own', () => {
    expect(appName('Claude')).toBe('Claude app')
    expect(appName('Claude Code (tempo)')).toBe('Claude Code')
    expect(appName('Cursor helper')).toBe('Cursor helper')
  })

  it("leaves out the way back to every app when the picker offers one brand", () => {
    const [claude] = shownBrands(URL)
    const props = { brand: claude, way: claude.ways[0], url: URL, watch: 'off' as const, onChooseWay: noop, onCheckAgain: noop }
    expect(renderToStaticMarkup(createElement(AiBrandDetail, props))).not.toContain('All apps')
    expect(renderToStaticMarkup(createElement(AiBrandDetail, { ...props, onBack: noop }))).toContain('All apps')
  })
})

describe('setup guide in mcp mode', () => {
  const app: Project = {
    id: 'p1', name: 'Ops', emoji: '', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false,
    ownerId: 'owner', repo: null, signals: null, appCard: null, lastActivityAt: null, autoApply: false,
  }
  const base: GuideSnapshot = {
    projects: [app], members: [], workspace: null, githubLogin: 'maya', githubConnected: true,
    settings: { ai: { provider: 'none', preset: null, baseUrl: null, apiKey: null, model: null }, theme: 'dark', teamSize: 1, onboarded: true, demo: false },
  }
  const step = (snapshot: GuideSnapshot) => nextStep(snapshot).checklist.find((item) => item.id === 'ai')!

  it('asks to connect Claude while no AI app is connected', () => {
    const guide = nextStep({ ...base, aiApps: [] })
    expect(step({ ...base, aiApps: [] })).toMatchObject({ label: 'Connect Claude', done: false, result: null })
    expect(guide.next).toMatchObject({ kind: 'ai', button: 'Connect Claude', action: { kind: 'ai' } })
  })

  it('ticks the step with the connected apps', () => {
    expect(step({ ...base, aiApps: ['Claude app', 'Claude Code', 'Claude Code'] })).toMatchObject({ done: true, result: 'Claude app, Claude Code' })
    expect(nextStep({ ...base, aiApps: ['Claude app'] }).next?.kind).not.toBe('ai')
  })

  it("doesn't suggest connecting while the list is still loading", () => {
    expect(step({ ...base, aiApps: null }).done).toBe(false)
    expect(nextStep({ ...base, aiApps: null }).next?.kind).not.toBe('ai')
  })

  describe('with the API key kept next to Claude (both mode)', () => {
    it('is done once a key is in use, with no Claude connected, and never nags to connect Claude', () => {
      expect(step({ ...base, aiApps: [], aiKey: true })).toMatchObject({ label: 'Pick your AI', done: true, result: 'API key' })
      expect(nextStep({ ...base, aiApps: [], aiKey: true }).next?.kind).not.toBe('ai')
      expect(step({ ...base, aiApps: null, aiKey: true }).done).toBe(true)
    })

    it('names both when Claude is connected too', () => {
      expect(step({ ...base, aiApps: ['Claude app'], aiKey: true })).toMatchObject({ done: true, result: 'Claude app, API key' })
    })

    it('still asks to connect Claude while there is no key and no Claude', () => {
      expect(step({ ...base, aiApps: [], aiKey: false })).toMatchObject({ label: 'Connect Claude', done: false })
      expect(nextStep({ ...base, aiApps: [], aiKey: false }).next).toMatchObject({ kind: 'ai', button: 'Connect Claude' })
    })

    it("ignores the browser's own connection, so a leftover key in mcp mode cannot tick the step", () => {
      const keyed = { ...base, settings: { ...base.settings, ai: { ...base.settings.ai, provider: 'anthropic' as const } } }
      expect(step({ ...keyed, aiApps: [] })).toMatchObject({ label: 'Connect Claude', done: false })
    })
  })

  it('keeps "Pick your AI" and the browser\'s own AI outside mcp mode', () => {
    expect(step(base)).toMatchObject({ label: 'Pick your AI', done: false })
    expect(nextStep(base).next).toMatchObject({ kind: 'ai', button: 'Pick your AI' })
    const keyed = { ...base, settings: { ...base.settings, ai: { ...base.settings.ai, provider: 'anthropic' as const } } }
    expect(step(keyed)).toMatchObject({ done: true, result: 'Claude' })
  })
})
