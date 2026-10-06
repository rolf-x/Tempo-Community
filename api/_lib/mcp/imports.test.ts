// The api runs as Node ESM on Vercel, where a relative import needs its file extension (`./x.js` for `./x.ts`). Tests and
// tsc resolve a bare `./x` anyway, so a missing extension only shows up after a deploy. This walks every runtime import
// reachable from the MCP function and names the ones that would not load. Type-only imports are erased, so they're fine.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const ENTRY = resolve(ROOT, 'api/mcp.ts')

/** Relative specifiers of the imports and re-exports that survive compilation: `import type` and `export type` are skipped. */
function runtimeSpecifiers(source: string): string[] {
  const out: string[] = []
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) if (!match[1]) out.push(match[2])
  return out
}

function walk(): { bad: string[]; reached: string[] } {
  const seen = new Set<string>()
  const bad: string[] = []
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
      if (!specifier.endsWith('.js')) {
        bad.push(`${relative(ROOT, file)} imports '${specifier}'`)
        continue
      }
      const next = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))
      if (existsSync(next)) visit(next)
    }
  }
  visit(ENTRY)
  return { bad, reached: [...seen].map((file) => relative(ROOT, file)) }
}

describe('the MCP function loads as Node ESM', () => {
  it('reaches the tools, the pure src modules and what they import', () => {
    const { reached } = walk()
    expect(reached).toEqual(expect.arrayContaining(['api/mcp.ts', 'api/_lib/mcp/tools.ts', 'src/ai/tools/health.ts', 'src/ai/tools/mcpDrafts.ts', 'src/lib/tasks.ts', 'src/lib/claudeWork.ts']))
  })
  it('writes the .js extension on every runtime import it reaches', () => {
    expect(walk().bad).toEqual([])
  })
})
