// Dev-only bridge: POST /api/claude → `claude -p` on the developer's own Claude subscription.
// `apply: 'serve'` keeps it out of the production build (provider `local`).
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const MODELS = ['sonnet', 'haiku', 'opus'] as const
type Model = (typeof MODELS)[number]
const MAX_INPUT = 50_000
const TIMEOUT_MS = 120_000

export interface BridgeRequest {
  system: string
  user: string
  schema: Record<string, unknown>
  model: Model
}

export function parseBridgeRequest(body: unknown): BridgeRequest {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.system !== 'string' || !b.system) throw new Error('system prompt is required')
  if (typeof b.user !== 'string' || !b.user) throw new Error('user message is required')
  if (!b.schema || typeof b.schema !== 'object') throw new Error('schema is required')
  if (b.system.length + b.user.length > MAX_INPUT) throw new Error('input too long')
  const model = MODELS.includes(b.model as Model) ? (b.model as Model) : 'sonnet'
  return { system: b.system, user: b.user, schema: b.schema as Record<string, unknown>, model }
}

/** Only JSON from a localhost page (or no Origin, e.g. curl). Blocks other websites posting "simple" CORS requests. */
export function isAllowedRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const type = String(headers['content-type'] ?? '')
  if (!type.toLowerCase().startsWith('application/json')) return false
  const origin = headers.origin
  if (origin === undefined) return true
  try {
    const host = new URL(String(origin)).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

export function buildClaudeArgs(req: BridgeRequest): string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(req.schema),
    '--system-prompt', req.system,
    '--model', req.model,
    '--effort', 'low',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ]
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    throw new Error('Claude returned no JSON')
  }
}

export function parseClaudeOutput(raw: string): unknown {
  let out: { is_error?: boolean; result?: string; structured_output?: unknown }
  try {
    out = JSON.parse(raw)
  } catch {
    throw new Error('claude -p output was unreadable')
  }
  if (out.is_error) throw new Error(out.result || 'claude -p failed')
  if (out.structured_output && typeof out.structured_output === 'object') return out.structured_output
  return extractJson(out.result ?? '')
}

export function runClaude(req: BridgeRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Drop any API credentials so claude -p always runs on the signed-in subscription, never a billed key.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    const child = spawn('claude', buildClaudeArgs(req), { stdio: ['pipe', 'pipe', 'pipe'], env })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('claude -p timed out'))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`could not start claude: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        resolve(parseClaudeOutput(stdout))
      } catch (e) {
        reject(code === 0 ? e : new Error(stderr.trim().slice(0, 300) || (e as Error).message))
      }
    })
    child.stdin.end(req.user)
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_INPUT * 2) reject(new Error('input too long'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function localClaudeBridge(): Plugin {
  return {
    name: 'tempo-local-claude-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/claude', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
        if (!isAllowedRequest(req.headers)) return send(res, 403, { error: 'Forbidden' })
        const started = Date.now()
        const log = server.config.logger
        try {
          const request = parseBridgeRequest(JSON.parse(await readBody(req)))
          log.info(`[bridge] → claude -p (${request.model})`, { timestamp: true })
          const data = await runClaude(request)
          log.info(`[bridge] ✓ ${Date.now() - started} ms`, { timestamp: true })
          send(res, 200, { data, ms: Date.now() - started })
        } catch (e) {
          log.error(`[bridge] ✗ ${(e as Error).message}`, { timestamp: true })
          send(res, 502, { error: (e as Error).message })
        }
      })
    },
  }
}
