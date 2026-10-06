import { handleWebhook } from './_lib/githubApp/webhook.js'

export function POST(request: Request): Promise<Response> {
  return handleWebhook(request, process.env)
}
