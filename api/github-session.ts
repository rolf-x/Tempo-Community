import { handleSession } from './_lib/githubProxy.js'

export function GET(request: Request): Promise<Response> {
  return handleSession(request, process.env)
}

export function POST(request: Request): Promise<Response> {
  return handleSession(request, process.env)
}

export function PATCH(request: Request): Promise<Response> {
  return handleSession(request, process.env)
}

export function DELETE(request: Request): Promise<Response> {
  return handleSession(request, process.env)
}
