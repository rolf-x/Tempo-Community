// Dev-only: serves the push-webhook functions from `npm run dev` (api/github-webhook.ts, github-link.ts, github-daily.ts),
// the same handlers production runs. Settings come from the shell and from .env / .env.local (all names, not only VITE_
// ones, because the App's key and secrets are server-side). Without them each answers 503 not_configured. GitHub cannot
// reach localhost, so to try the webhook by hand sign a payload with GITHUB_WEBHOOK_SECRET and POST it here.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { handleDaily } from '../api/_lib/githubApp/daily.ts'
import { handleLink } from '../api/_lib/githubApp/link.ts'
import { handleWebhook } from '../api/_lib/githubApp/webhook.ts'
import { devTokenKey } from './githubProxyDev.ts'

type Env = Record<string, string | undefined>

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

const ROUTES: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  '/api/github-webhook': (request, env) => handleWebhook(request, env),
  '/api/github-link': (request, env) => handleLink(request, env),
  '/api/github-daily': (request, env) => handleDaily(request, env),
}

export function localGitHubApp(): Plugin {
  let env: Env = {}
  return {
    name: 'tempo-local-github-app',
    apply: 'serve',
    configResolved(config) {
      env = { ...loadEnv(config.mode, config.envDir || config.root, ''), ...process.env, GITHUB_TOKEN_KEY: devTokenKey }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handler = ROUTES[new URL(req.url ?? '/', 'http://localhost').pathname]
        if (!handler) return next()
        try {
          await send(res, await handler(await toRequest(req), env))
        } catch (error) {
          server.config.logger.error(`[github-app] ${(error as Error).name}`)
          await send(res, new Response(JSON.stringify({ error: 'internal_error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          }))
        }
      })
    },
  }
}
