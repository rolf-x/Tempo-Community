import { handleGitHub } from './_lib/githubProxy.js'

export function GET(request: Request): Promise<Response> {
  return handleGitHub(request, process.env)
}

export function POST(request: Request): Promise<Response> {
  return handleGitHub(request, process.env)
}
