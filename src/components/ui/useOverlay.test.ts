import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{ deps: unknown[]; cleanup?: () => void }>,
  refCursor: 0,
  effectCursor: 0,
}))

vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return {
    ...actual,
    useRef: <T,>(initial: T) => {
      const index = hooks.refCursor++
      hooks.refs[index] ??= { current: initial }
      return hooks.refs[index]
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const index = hooks.effectCursor++
      const previous = hooks.effects[index]
      if (previous && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return
      previous?.cleanup?.()
      const cleanup = effect()
      hooks.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    },
  }
})

import { useOverlay } from './useOverlay'

describe('useOverlay focus', () => {
  beforeEach(() => {
    hooks.refs = []
    hooks.effects = []
    hooks.refCursor = 0
    hooks.effectCursor = 0
  })

  it('focuses once, keeps the input focused through typed rerenders, and Escape uses the latest close callback', () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>()
    const opener = { focus: vi.fn() }
    const input = { value: '', focus: vi.fn(() => { fakeDocument.activeElement = input }) }
    const fakeDocument = {
      activeElement: opener as unknown,
      body: { style: { overflow: '' } },
      addEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    }
    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (callback(0), 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const panel = { current: { querySelector: (selector: string) => selector === '[autofocus]' ? input : null } as unknown as HTMLElement }
    const firstClose = vi.fn()
    const latestClose = vi.fn()

    useOverlay(true, panel, firstClose)
    expect(fakeDocument.activeElement).toBe(input)
    input.value = 'hello'

    hooks.refCursor = 0
    hooks.effectCursor = 0
    useOverlay(true, panel, latestClose)

    expect(input.value).toBe('hello')
    expect(fakeDocument.activeElement).toBe(input)
    expect(input.focus).toHaveBeenCalledTimes(1)
    listeners.get('keydown')?.({ key: 'Escape', stopPropagation: vi.fn() } as unknown as KeyboardEvent)
    expect(latestClose).toHaveBeenCalledOnce()
    expect(firstClose).not.toHaveBeenCalled()
  })
})
