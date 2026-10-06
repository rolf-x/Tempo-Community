import { createTempoMcp, depsFromEnv } from './_lib/mcp/handler.js'

const deps = depsFromEnv(process.env)
const handle = deps ? createTempoMcp(deps) : null

function serve(request: Request): Promise<Response> {
  if (!handle) {
    return Promise.resolve(new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }))
  }
  return handle(request)
}

export const GET = serve
export const POST = serve
export const DELETE = serve
export const OPTIONS = serve
