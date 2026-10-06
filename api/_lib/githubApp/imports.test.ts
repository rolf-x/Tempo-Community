// Same idea as ../mcp/imports.test.ts, for the push-webhook functions: Node ESM on Vercel needs `./x.js` for `./x.ts`, which
// tsc and the tests don't enforce. And the other direction: browser code must never pull the server side in.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const ENTRIES = ['api/github-webhook.ts', 'api/github-link.ts', 'api/github-daily.ts']

/** Relative specifiers of the imports and re-exports that survive compilation: `import type` and `export type` are skipped. */
function runtimeSpecifiers(source: string): string[] {
  const out: string[] = []
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) if (!match[1]) out.push(match[2])
  return out
}

function walk(entry: string): { bad: string[]; reached: string[] } {
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
  visit(resolve(ROOT, entry))
  return { bad, reached: [...seen].map((file) => relative(ROOT, file)) }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe.each(ENTRIES)('%s loads as Node ESM', (entry) => {
  it('writes the .js extension on every runtime import it reaches', () => {
    expect(walk(entry).bad).toEqual([])
  })
})

describe('what the functions reach', () => {
  it('the webhook and the daily check share the repo reads and the facts with the browser', () => {
    for (const entry of ['api/github-webhook.ts', 'api/github-daily.ts']) {
      expect(walk(entry).reached).toEqual(expect.arrayContaining([
        'api/_lib/githubApp/refresh.ts', 'api/_lib/githubApp/auth.ts', 'api/_lib/githubApp/db.ts', 'src/lib/repoRead.ts', 'src/ai/tools/repoFacts.ts',
      ]))
    }
  })

  it('linking reuses the cookie reader of the GitHub proxy', () => {
    expect(walk('api/github-link.ts').reached).toEqual(expect.arrayContaining(['api/_lib/githubProxy.ts', 'api/_lib/githubApp/db.ts']))
  })

  it('no function pulls in the store, the browser data layer or a component', () => {
    for (const entry of ENTRIES) {
      const stray = walk(entry).reached.filter((file) => /^src\/(?:store|data|components|views)\//.test(file))
      expect(stray, entry).toEqual([])
    }
  })
})

describe('the browser bundle stays free of the server side', () => {
  it('nothing under src/ imports api/, server/ or the githubApp folder', () => {
    const offenders = sourceFiles(resolve(ROOT, 'src')).filter((file) => {
      const text = readFileSync(file, 'utf8')
      return /(?:from|import\()\s*['"][^'"]*(?:\/api\/|\/server\/|githubApp\/|node:)/.test(text)
    })
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([])
  })
})
