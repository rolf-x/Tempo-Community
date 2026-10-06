import { handleLink } from './_lib/githubApp/link.js'

export function POST(request: Request): Promise<Response> {
  return handleLink(request, process.env)
}
