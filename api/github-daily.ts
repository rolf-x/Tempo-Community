import { handleDaily } from './_lib/githubApp/daily.js'

export function GET(request: Request): Promise<Response> {
  return handleDaily(request, process.env)
}
