// What changed between two snapshots of an id-keyed list. The store updates immutably, so identity = changed.
export function diffById<T extends { id: string }>(prev: T[], next: T[]): { upserts: T[]; deletes: string[] } {
  if (prev === next) return { upserts: [], deletes: [] }
  const before = new Map(prev.map((x) => [x.id, x]))
  const upserts = next.filter((x) => before.get(x.id) !== x)
  const ids = new Set(next.map((x) => x.id))
  return { upserts, deletes: prev.filter((x) => !ids.has(x.id)).map((x) => x.id) }
}
