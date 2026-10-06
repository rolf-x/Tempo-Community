#!/usr/bin/env node
// Creates your GitHub App for Tempo in one click, through GitHub's "register an App from a manifest" flow.
//
//   node scripts/setup/github-app.mjs --domain https://your-tempo.vercel.app --supabase https://<ref>.supabase.co
//
// Options: --org <name> (the App belongs to that organization), --name "<App name>", --private (only the owner
// account can install it), --replace (overwrite keys saved by an earlier run), --dry-run (print the manifest, do nothing).
//
// It serves one page on this computer only, which sends the filled-in settings to GitHub. You check them and press
// Create. GitHub sends a one-time code back here, which is traded for the App's keys. Those go straight into
// .tempo-setup/github-app.json (only your user can read it, git ignores it) and are never printed.
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedHost, appSummary, buildManifest, exchangeCode, httpsOrigin, manifestPage, newAppUrl, newState, parseArgs, sameState, saveAppFile } from './lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WAIT_MS = 10 * 60_000

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

let options
try {
  options = parseArgs(process.argv.slice(2), { values: ['domain', 'supabase', 'org', 'name'], flags: ['private', 'replace', 'dry-run'] })
  if (!options.domain || !options.supabase) throw new Error('Usage: node scripts/setup/github-app.mjs --domain https://your-site --supabase https://<ref>.supabase.co')
  httpsOrigin(options.domain, '--domain')
  httpsOrigin(options.supabase, '--supabase')
} catch (error) {
  fail(error.message)
}

const host = new URL(options.domain).hostname.split('.')[0]
const name = options.name ?? `Tempo (${host})`.slice(0, 34)
const state = newState()

if (options['dry-run']) {
  const manifest = buildManifest({ domain: options.domain, supabase: options.supabase, name, redirectUrl: 'http://localhost:<port>/done', isPublic: !options.private })
  console.log(JSON.stringify(manifest, null, 2))
  console.log(`\nWould open: ${newAppUrl({ org: options.org, state: '<state>' })}`)
  process.exit(0)
}

let used = false
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const send = (status, html) => {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    response.end(html)
  }
  if (request.method !== 'GET') return send(405, 'Method not allowed')
  const { port } = server.address()
  if (!allowedHost(request.headers.host, port)) return send(421, 'Wrong address')
  if (url.pathname === '/') {
    const manifest = buildManifest({ domain: options.domain, supabase: options.supabase, name, redirectUrl: `http://localhost:${port}/done`, isPublic: !options.private })
    return send(200, manifestPage({ action: newAppUrl({ org: options.org, state }), manifest }))
  }
  if (url.pathname !== '/done') return send(404, 'Not found')
  if (!sameState(state, url.searchParams.get('state'))) return send(400, 'This link does not belong to this setup run.')
  if (used) return send(410, 'This setup run is already finished.')
  used = true
  try {
    const app = await exchangeCode(url.searchParams.get('code'))
    saveAppFile(ROOT, app, { replace: Boolean(options.replace) })
    send(200, '<!doctype html><meta charset="utf-8"><title>Done</title><body style="font:16px system-ui;margin:4rem auto;max-width:40rem">'
      + `<h1>GitHub App created</h1><p>Its keys are saved on your computer. Go back to the terminal for the next step.</p></body>`)
    console.log(`\n${appSummary(app).join('\n')}\n`)
    finish(0)
  } catch (error) {
    send(500, 'Something went wrong. The terminal says what.')
    console.error(`\n${error.message}\n`)
    finish(1)
  }
})

function finish(code) {
  clearTimeout(timer)
  server.close(() => process.exit(code))
  server.closeAllConnections?.()
}

const timer = setTimeout(() => {
  console.error('\nNothing came back from GitHub in 10 minutes. Run the helper again when you are ready.\n')
  finish(1)
}, WAIT_MS)

// localhost only: nothing outside this computer can reach the page or the code GitHub sends back.
server.listen(0, 'localhost', () => {
  const { port } = server.address()
  const page = `http://localhost:${port}/`
  console.log(`\nOpening ${page} in your browser. It takes you to GitHub with every setting filled in.`)
  console.log('If no browser opens, open that address yourself. Waiting up to 10 minutes…')
  const opener = process.platform === 'darwin' ? ['open', [page]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', page]] : ['xdg-open', [page]]
  try {
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
  } catch { /* The address is printed above. */ }
})
