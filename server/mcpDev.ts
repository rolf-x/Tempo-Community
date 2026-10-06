// Dev-only: serves /api/mcp and its two OAuth discovery paths from `npm run dev`, like vercel.json's rewrites do in
// production. Same handler as api/mcp.ts; Supabase settings come from the VITE_ variables Vite already loads.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createTempoMcp, depsFromEnv } from '../api/_lib/mcp/handler.ts'

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const ROUTES: Record<string, string> = {
  '/api/mcp': '',
  '/.well-known/oauth-protected-resource/api/mcp': 'prm',
  '/.well-known/oauth-authorization-server': 'as',
}

export function localMcp(): Plugin {
  let handle: ((request: Request) => Promise<Response>) | null = null
  return {
    name: 'tempo-local-mcp',
    apply: 'serve',
    configResolved(config) {
      const deps = depsFromEnv(config.env)
      handle = deps ? createTempoMcp(deps) : null
    },
    configureServer(server) {
      server.middlewares.use(async (req, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        if (!(url.pathname in ROUTES)) return next()
        if (!handle) {
          res.statusCode = 503
          res.end('MCP needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local')
          return
        }
        const target = new URL('/api/mcp', url)
        if (ROUTES[url.pathname]) target.searchParams.set('wk', ROUTES[url.pathname])
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
          else if (value !== undefined) headers.set(name, value)
        }
        const method = req.method ?? 'GET'
        const body = method === 'GET' || method === 'HEAD' ? undefined : Uint8Array.from(await readBody(req)).buffer
        try {
          const response = await handle(new Request(target, { method, headers, body }))
          res.statusCode = response.status
          response.headers.forEach((value, name) => res.setHeader(name, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          server.config.logger.error(`[mcp] ${(error as Error).message}`)
          res.statusCode = 500
          res.end()
        }
      })
    },
  }
}
