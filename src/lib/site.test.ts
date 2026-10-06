import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { tempoSite } from './site'

describe('tempoSite', () => {
  it('names live Tempo plainly, and staging and local servers with a suffix', () => {
    expect(tempoSite('https://tempo.example.com/api/mcp')).toEqual({ label: 'Tempo', id: 'tempo', live: true })
    expect(tempoSite('https://tempo-staging.example.com')).toEqual({ label: 'Tempo (staging)', id: 'tempo-staging', live: false })
    expect(tempoSite('https://staging.tempo.example/api/mcp').id).toBe('tempo-staging')
    for (const local of ['http://localhost:5173/api/mcp', 'http://127.0.0.1:5173', 'http://[::1]:5173', 'http://tempo.localhost']) {
      expect(tempoSite(local)).toEqual({ label: 'Tempo (local)', id: 'tempo-local', live: false })
    }
  })

  it('treats any other address, or none, as live', () => {
    for (const other of ['https://tempo.example', 'https://tempo-git-fix-acme.vercel.app', 'https://nostaging.example', '', 'not a url']) {
      expect(tempoSite(other).live).toBe(true)
    }
  })

  it('has no imports, so the MCP server can load it as is', () => {
    expect(readFileSync(new URL('./site.ts', import.meta.url), 'utf8')).not.toMatch(/^import /m)
  })
})
