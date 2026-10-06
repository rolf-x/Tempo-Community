// Records edited locally and not yet acknowledged by the server. Realtime must never overwrite these with an older
// server copy (an echo of an earlier save), or fast successive edits get lost.
export class DirtySet {
  private versions = new Map<string, number>()
  private key = (table: string, id: string) => `${table}:${id}`

  touch(table: string, ids: string[]) {
    for (const id of ids) this.versions.set(this.key(table, id), (this.versions.get(this.key(table, id)) ?? 0) + 1)
  }

  has(table: string, id: string) {
    return this.versions.has(this.key(table, id))
  }

  /** Versions being sent now; pass to ack() when the server confirms. */
  snapshot(table: string, ids: string[]): Map<string, number> {
    return new Map(ids.map((id) => [this.key(table, id), this.versions.get(this.key(table, id)) ?? 0]))
  }

  ack(sent: Map<string, number>) {
    for (const [k, v] of sent) if (this.versions.get(k) === v) this.versions.delete(k)
  }
}
