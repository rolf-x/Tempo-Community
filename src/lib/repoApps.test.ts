import { describe, expect, it } from 'vitest'
import { appNameFromRepo, reposToAdd } from './repoApps'

describe('appNameFromRepo', () => {
  it('turns a repo slug into a readable app name', () => {
    expect(appNameFromRepo('acme/expense-bot')).toBe('Expense bot')
    expect(appNameFromRepo('octo-labs/tempo')).toBe('Tempo')
    expect(appNameFromRepo('acme/sales_dashboard.v2')).toBe('Sales dashboard v2')
  })
  it('keeps a name that already has capitals', () => {
    expect(appNameFromRepo('acme/CRMSync')).toBe('CRMSync')
  })
})

describe('reposToAdd', () => {
  it('skips repos already linked to an app, case-insensitively, and duplicates', () => {
    const projects = [{ repo: { fullName: 'acme/Bot' } }, { repo: null }] as never
    expect(reposToAdd(['acme/bot', 'acme/new', 'acme/new'], projects)).toEqual(['acme/new'])
  })
})

// Classification never invents what an app does; it reports the matching evidence.
import { classifyRepo } from './repoApps'
const repo = { fork: false, archived: false, is_template: false, size: 1, homepage: null, language: null }

describe('classifyRepo', () => {
  it.each([['fork', 'Fork'], ['archived', 'Archived'], ['is_template', 'Template'], ['size', 'Empty']])('excludes %s even with deploy files, scripts and a URL', (key, reason) => {
    expect(classifyRepo({ ...repo, [key]: key === 'size' ? 0 : true, homepage: 'https://example.com' }, { files: ['vercel.json'], scripts: { start: 'node app' } })).toEqual({ isApp: false, reason })
  })
  it('checks a new size-zero repo when GitHub has already detected its language', () => {
    expect(classifyRepo({ ...repo, size: 0, language: 'TypeScript' }, { files: ['vercel.json'], scripts: {} })).toEqual({ isApp: true, reason: 'vercel.json' })
  })
  it.each(['vercel.json', 'netlify.toml', 'Dockerfile', 'fly.toml', 'render.yaml', 'Procfile', 'wrangler.toml', 'railway.json', 'app.yaml'])('recognises root deploy file %s', (file) => {
    expect(classifyRepo(repo, { files: [file], scripts: {} })).toEqual({ isApp: true, reason: file })
  })
  it.each(['start', 'build', 'dev'])('recognises a %s script', (name) => {
    expect(classifyRepo(repo, { files: ['package.json'], scripts: { [name]: 'run something' } })).toEqual({ isApp: true, reason: `${name} script` })
  })
  it.each(['https://example.com', 'http://example.com/app', ' https://example.com '])('recognises homepage %s', (homepage) => {
    expect(classifyRepo({ ...repo, homepage })).toEqual({ isApp: true, reason: 'live URL' })
  })
  it.each([null, '', ' ', 'not a URL', 'javascript:alert(1)', 'ftp://example.com', '/docs'])('rejects a non-live homepage: %s', (homepage) => {
    expect(classifyRepo({ ...repo, homepage })).toEqual({ isApp: false, reason: 'No deploy file or start script' })
  })
  it('does not count nested deploy files, package presence alone, test scripts, or blank commands', () => {
    expect(classifyRepo(repo, { files: ['docs/vercel.json', 'package.json', 'README.md'], scripts: { test: 'vitest', start: '   ', build: '' } })).toEqual({ isApp: false, reason: 'No deploy file or start script' })
  })
  it('prefers a deploy file as evidence when several signals match', () => {
    expect(classifyRepo({ ...repo, homepage: 'https://example.com' }, { files: ['vercel.json'], scripts: { start: 'vite' } }).reason).toBe('vercel.json')
  })
})
