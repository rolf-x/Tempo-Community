import { describe, expect, it } from 'vitest'
import { diffById } from './diff'

describe('diffById', () => {
  const a = { id: 'a', v: 1 }
  const b = { id: 'b', v: 1 }
  it('reports changed (new identity) and added items as upserts, missing ones as deletes', () => {
    const b2 = { ...b, v: 2 }
    const c = { id: 'c', v: 1 }
    expect(diffById([a, b], [a, b2, c])).toEqual({ upserts: [b2, c], deletes: [] })
    expect(diffById([a, b], [b])).toEqual({ upserts: [], deletes: ['a'] })
  })
  it('same array → nothing', () => expect(diffById([a], [a])).toEqual({ upserts: [], deletes: [] }))
})
