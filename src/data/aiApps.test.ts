import { beforeEach, describe, expect, it, vi } from 'vitest'

const listGrants = vi.fn()
vi.mock('./cloud', () => ({ client: () => ({ auth: { oauth: { listGrants } } }) }))

const { knownAIApps, loadAIApps, publishAIApps, useAIApps } = await import('./aiApps')

const grant = (id: string, name: string) => ({ client: { id, name }, granted_at: '2026-10-05T10:00:00Z' })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  listGrants.mockReset()
  useAIApps.setState({ clients: null, userId: null, failed: false, version: 0 })
})

describe('connected AI apps', () => {
  it('reads the list for the signed-in user', async () => {
    listGrants.mockResolvedValue({ data: [grant('c1', 'Claude')], error: null })
    await loadAIApps('u1')
    expect(useAIApps.getState()).toMatchObject({ userId: 'u1', clients: [{ clientId: 'c1', name: 'Claude' }] })
  })

  it('shares a read already on its way', async () => {
    const answer = deferred<{ data: unknown[]; error: null }>()
    listGrants.mockReturnValue(answer.promise)
    const first = loadAIApps('u1')
    const second = loadAIApps('u1')
    answer.resolve({ data: [], error: null })
    await Promise.all([first, second])
    expect(listGrants).toHaveBeenCalledTimes(1)
    expect(useAIApps.getState().clients).toEqual([])
  })

  it("drops an older read once Settings has published a list (a revoke can't come back)", async () => {
    const answer = deferred<{ data: unknown[]; error: null }>()
    listGrants.mockReturnValue(answer.promise)
    const read = loadAIApps('u1')
    publishAIApps('u1', [])
    answer.resolve({ data: [grant('c1', 'Claude')], error: null })
    await read
    expect(useAIApps.getState().clients).toEqual([])
  })

  it("starts from nothing for another user, so their apps never tick this user's step", async () => {
    publishAIApps('u1', [{ clientId: 'c1', name: 'Claude', grantedOn: '' }])
    const answer = deferred<{ data: unknown[]; error: null }>()
    listGrants.mockReturnValue(answer.promise)
    const read = loadAIApps('u2')
    expect(useAIApps.getState()).toMatchObject({ userId: 'u2', clients: null })
    answer.resolve({ data: [], error: null })
    await read
    expect(useAIApps.getState().clients).toEqual([])
  })

  it('keeps the last list when a read fails', async () => {
    publishAIApps('u1', [{ clientId: 'c1', name: 'Claude', grantedOn: '' }])
    listGrants.mockResolvedValue({ data: null, error: new Error('down') })
    await loadAIApps('u1')
    expect(useAIApps.getState().clients).toHaveLength(1)
  })

  it('offers to connect when the first read fails, instead of waiting forever', async () => {
    listGrants.mockResolvedValue({ data: null, error: new Error('down') })
    const read = loadAIApps('u1')
    expect(knownAIApps(useAIApps.getState(), 'u1')).toBeNull()
    await read
    expect(knownAIApps(useAIApps.getState(), 'u1')).toEqual([])
    expect(knownAIApps(useAIApps.getState(), 'u1')).toBe(knownAIApps(useAIApps.getState(), 'u1'))
    expect(knownAIApps(useAIApps.getState(), 'u2')).toBeNull()
  })
})
