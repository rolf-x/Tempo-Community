import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleGitHub, handleSession, type GitHubProxyEnv } from '../api/_lib/githubProxy.ts'

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const method = req.method ?? 'GET'
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : Uint8Array.from(await readBody(req)).buffer
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body })
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}

/** The sealing key for the dev session cookie. Shared with the push-link dev server, which has to open the same cookie. */
export const devTokenKey = process.env.GITHUB_TOKEN_KEY || randomBytes(32).toString('base64')

export function localGitHubProxy(): Plugin {
  const env: GitHubProxyEnv = { ...process.env, GITHUB_TOKEN_KEY: devTokenKey }
  return {
    name: 'tempo-local-github-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const handler = pathname === '/api/github' ? handleGitHub : pathname === '/api/github-session' ? handleSession : null
        if (!handler) return next()
        try {
          await send(res, await handler(await toRequest(req), env))
        } catch (error) {
          server.config.logger.error(`[github-proxy] ${(error as Error).message}`)
          await send(res, new Response(JSON.stringify({ error: 'internal_error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          }))
        }
      })
    },
  }
}
