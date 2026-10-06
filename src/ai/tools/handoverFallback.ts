// Deterministic handover for when the AI is unavailable. Facts only: nothing here is invented. Pure.
import type { HandoverOut } from '../schemas'
import type { HealthFlag } from './health'
import { plain } from './applySync.js'
import { MEMORY_FILES, type RepoFacts } from './repoFacts.js'

export interface DeploymentEvidence {
  liveUrl: string | null
  deployFile: string | null
}

const CMD = /^\s*(?:\$\s*)?((?:npm|pnpm|yarn|bun|npx|pip3?|python3?|uv|poetry|docker(?:-compose)?|make|cargo|go|bundle|rails|php|composer)\b.*)$/
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function firstParagraph(readme: string | null): string | null {
  if (!readme) return null
  const p = readme.split(/\n\s*\n/).map((b) => b.trim()).find((b) => b && !b.startsWith('#') && !b.startsWith('```'))
  return p ? p.replace(/\s+/g, ' ') : null
}

function runCommands(readme: string | null): string[] {
  if (!readme) return []
  const out: string[] = []
  let inFence = false
  for (const line of readme.split('\n')) {
    if (line.trim().startsWith('```')) { inFence = !inFence; continue }
    const m = inFence ? CMD.exec(line) : null
    if (m && !out.includes(m[1].trim())) out.push(m[1].trim())
  }
  return out.slice(0, 8)
}

/** Links the AI was shown (repo, commits, pull requests, issues). A handover may link only to these. */
export function factUrls(facts: RepoFacts): Set<string> {
  return new Set([facts.meta.url, ...facts.commits.map((c) => c.url), ...facts.pulls.map((p) => p.url), ...facts.issues.map((i) => i.url)].filter(Boolean))
}

const oneLine = (value: string) => plain(value).replace(/\s+/g, ' ').trim()
// Paths and commands go inside code spans, where markdown is not rendered: keep them as written (src/__tests__/x.ts) minus line breaks and backticks.
const inCode = (value: string) => value.replace(/\s+/g, ' ').replace(/`/g, "'").trim()

/**
 * Text from the AI or from the repo becomes plain text, one line per item: no links, emphasis or code spans to
 * render, and no way to start a new heading or list from inside a string. The one link that survives is an
 * evidenceUrl that is exactly a URL in the facts. Add deployment evidence afterwards: its links are ours.
 */
export function cleanHandover(doc: HandoverOut, allowedUrls: ReadonlySet<string>): HandoverOut {
  const keep = (items: string[]) => items.map(oneLine).filter(Boolean)
  return {
    summary: plain(doc.summary).replace(/\s+/g, ' ').trim() || 'The repo does not describe the app yet.',
    howToRun: doc.howToRun.map(inCode).filter(Boolean),
    whereThingsAre: doc.whereThingsAre.map((item) => ({ path: inCode(item.path), what: oneLine(item.what) })).filter((item) => item.path),
    openWork: doc.openWork.map((item) => {
      const url = item.evidenceUrl?.trim()
      return { title: oneLine(item.title), ...(url && allowedUrls.has(url) ? { evidenceUrl: url } : {}) }
    }).filter((item) => item.title),
    risks: keep(doc.risks),
    contacts: keep(doc.contacts),
    unknowns: keep(doc.unknowns),
  }
}

/** A link only for a plain web address; anything stranger is shown as code, where nothing renders as a link. */
const liveLink = (url: string) => (/^https?:\/\/[^\s()<>[\]`]+$/i.test(url) ? `[${url}](${url})` : `\`${inCode(url)}\``)

/** Add known deployment evidence and remove a contradictory deployment unknown. */
export function withDeploymentEvidence(doc: HandoverOut, deployment: DeploymentEvidence): HandoverOut {
  const { liveUrl, deployFile } = deployment
  const whereThingsAre = [...doc.whereThingsAre]
  const alreadyHasLiveUrl = !!liveUrl && whereThingsAre.some((item) => item.path.includes(liveUrl) || item.what.includes(liveUrl))
  if (deployFile && !whereThingsAre.some((item) => item.path.toLowerCase() === deployFile.toLowerCase())) {
    whereThingsAre.push({ path: deployFile, what: liveUrl ? `Deployment config · live at ${liveLink(liveUrl)}` : 'Deployment config' })
  } else if (liveUrl && !alreadyHasLiveUrl) {
    whereThingsAre.push({ path: 'Live app', what: liveLink(liveUrl) })
  }
  return {
    ...doc,
    whereThingsAre,
    unknowns: liveUrl ? doc.unknowns.filter((item) => !/where .*deploy|deploy(?:ment)? (?:target|url|location)|live url|where it (?:runs|is hosted)/i.test(item)) : doc.unknowns,
  }
}

export function fallbackHandover(f: RepoFacts, flags: HealthFlag[], owner: string | null, deployment: DeploymentEvidence = { liveUrl: null, deployFile: f.deployFile }): HandoverOut {
  const ask = `Unknown — ask ${owner ?? 'the team'}`
  const howToRun = runCommands(f.readme)
  const order = (p: string) => { const i = MEMORY_FILES.indexOf(p); return i < 0 ? MEMORY_FILES.length : i }
  const files = [...f.files].sort((a, b) => order(a.path) - order(b.path))
  const unknowns = [
    ...(howToRun.length === 0 ? [`${ask}: how to run it locally`] : []),
    ...(files.length === 0 ? [`${ask}: where the agent or design notes live`] : []),
    deployment.liveUrl
      ? `${ask}: which accounts and environment variables it needs`
      : `${ask}: where it is deployed and which accounts and environment variables it needs`,
  ]
  return withDeploymentEvidence(cleanHandover({
    summary: clip(firstParagraph(f.readme) || f.meta.description || `${f.meta.fullName}: the repo does not describe the app yet.`, 600),
    howToRun,
    whereThingsAre: [
      ...(f.readme ? [{ path: 'README.md', what: 'Project overview' }] : []),
      ...files.map((x) => ({ path: x.path, what: 'Notes left by a coding agent or the team' })),
    ].filter((w, i, a) => a.findIndex((y) => y.path === w.path) === i),
    openWork: [
      ...f.pulls.map((p) => ({ title: `PR #${p.number}: ${p.title}`, evidenceUrl: p.url })),
      ...f.issues.map((i) => ({ title: `Issue #${i.number}: ${i.title}`, evidenceUrl: i.url })),
    ],
    risks: flags.map((x) => x.label),
    contacts: [],
    unknowns,
  }, factUrls(f)), { ...deployment, deployFile: deployment.deployFile ?? f.deployFile })
}
