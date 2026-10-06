import { describe, expect, it } from 'vitest'
import { HandoverOut, SyncAppOut, TOOLS, TOOL_DESCRIPTIONS, WriteTasksOut, toJsonSchema } from './schemas'

describe('AI schemas', () => {
  it('accepts app cards and handovers', () => {
    expect(SyncAppOut.safeParse({ card: { what: 'Tracks apps.', who: 'Engineering', stage: 'live', status: 'Healthy' } }).success).toBe(true)
    expect(HandoverOut.safeParse({ summary: 'Ready.', howToRun: [], whereThingsAre: [], openWork: [], risks: [], contacts: [], unknowns: [] }).success).toBe(true)
  })

  it('accepts tasks for a problem Tempo flags, and rejects a problem it does not', () => {
    expect(WriteTasksOut.safeParse({ tasks: [{ problem: 'no-readme', title: 'Write a README', detail: 'Say what it does.' }] }).success).toBe(true)
    expect(WriteTasksOut.safeParse({ tasks: [] }).success).toBe(true)
    expect(WriteTasksOut.safeParse({ tasks: [{ problem: 'bad-vibes', title: 'x', detail: '' }] }).success).toBe(false)
    expect(WriteTasksOut.safeParse({ tasks: [{ problem: 'stale', title: '', detail: '' }] }).success).toBe(false)
  })

  it('exposes only portfolio tools', () => {
    expect(Object.keys(TOOLS)).toEqual(['sync_app', 'handover', 'write_tasks'])
    for (const name of Object.keys(TOOLS)) expect(TOOL_DESCRIPTIONS[name as keyof typeof TOOLS]).toBeTruthy()
    for (const name of Object.keys(TOOLS) as (keyof typeof TOOLS)[]) {
      const schema = toJsonSchema(name)
      expect(schema.type).toBe('object')
      expect(schema).not.toHaveProperty('$schema')
    }
  })
})
