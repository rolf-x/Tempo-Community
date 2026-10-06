#!/usr/bin/env node
// Sets every variable a hosted Tempo needs in your Vercel project, without showing a single secret.
//
//   node scripts/setup/vercel-env.mjs --site-url https://your-tempo.vercel.app --supabase-url https://<ref>.supabase.co \
//     --anon-key <anon key> --contact-email you@yourcompany.com
//
// Needs the Vercel CLI, logged in and linked to your project (`vercel link`), and the keys saved by
// scripts/setup/github-app.mjs. --site-url fills the link previews in index.html; --contact-email is where people ask
// to delete their account (optional). Other options: --ai-mode legacy|both|mcp (default both), --target
// production|preview|development (default production), --replace (overwrite variables already set), --dry-run.
//
// The GitHub App's keys come from .tempo-setup/github-app.json; GITHUB_TOKEN_KEY, TEMPO_SERVER_KEY and CRON_SECRET
// are made fresh here. Each value goes to the Vercel CLI over stdin. Only the server key's SHA-256 is printed, for
// the one line of SQL that lets your database recognise the server.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addEnv, envPlan, parseArgs, readAppFile } from './lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

let options
let plan
try {
  options = parseArgs(process.argv.slice(2), { values: ['site-url', 'supabase-url', 'anon-key', 'contact-email', 'ai-mode', 'target'], flags: ['replace', 'dry-run'] })
  if (!options['site-url'] || !options['supabase-url'] || !options['anon-key']) {
    throw new Error('Usage: node scripts/setup/vercel-env.mjs --site-url https://<your site> --supabase-url https://<ref>.supabase.co --anon-key <anon key> [--contact-email <email>]')
  }
  plan = envPlan(readAppFile(ROOT), {
    siteUrl: options['site-url'],
    supabaseUrl: options['supabase-url'],
    anonKey: options['anon-key'],
    contactEmail: options['contact-email'],
    aiMode: options['ai-mode'] ?? 'both',
  })
  if (!options['contact-email']) console.log('No --contact-email: the Privacy page will tell people to ask whoever runs this Tempo.')
} catch (error) {
  fail(error.message)
}

const target = options.target ?? 'production'

if (options['dry-run']) {
  console.log(`Would set in Vercel (${target}):`)
  for (const v of plan.vars) console.log(`  ${v.name}${v.sensitive ? '  (secret)' : ''}`)
  process.exit(0)
}

if (!fs.existsSync(path.join(ROOT, '.vercel', 'project.json'))) {
  fail('This folder is not linked to a Vercel project yet. Run `vercel link` here first.')
}

console.log(`\nSetting ${plan.vars.length} variables in Vercel (${target})…`)
const results = []
for (const v of plan.vars) {
  const result = await addEnv({ ...v, target, replace: Boolean(options.replace) }, { spawn })
  results.push(result)
  console.log(`  ${result.ok ? '✓' : result.skipped ? '–' : '✗'} ${v.name}: ${result.message}`)
}

const serverKey = results.find((r) => r.name === 'TEMPO_SERVER_KEY')
if (serverKey?.ok) {
  console.log('\nLast step for the database: run this once in Supabase → SQL Editor. It stores only the hash of the server key.')
  console.log(`\n  insert into public.server_keys (name, key_hash) values ('github', '${plan.serverKeyHash}')`)
  console.log('    on conflict (name) do update set key_hash = excluded.key_hash;\n')
} else {
  console.log('\nTEMPO_SERVER_KEY was not changed, so the database keeps the hash it has.')
}

const failed = results.filter((r) => !r.ok && !r.skipped)
if (failed.length) fail(`${failed.length} variable(s) failed. Fix the cause above and run this again (add --replace for ones already set).`)
console.log('Done. Deploy again (vercel --prod, or push to your main branch) so the new values are used.\n')
