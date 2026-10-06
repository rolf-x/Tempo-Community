// sync_app post-processing: clean the written card and attach exact repo evidence.
import type { AppCard, AppCardEvidence, RepoSignals, Stage } from '../../types'
import type { ToolOutput } from '../schemas'
import type { RepoFacts } from './repoFacts'
import { STALE_DAYS } from './health.js'

export interface SyncResult {
  card: Omit<AppCard, 'updatedAt' | 'source'>
}

interface Ctx { signals?: RepoSignals }

export const plain = (value: string) =>
  value.replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1')

const clip = (value: string, limit: number) => {
  const text = plain(value).trim()
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text
}

const readmeLine = (markdown: string | null) => {
  if (!markdown) return null
  const line = markdown.split('\n').map((value) => value.trim()).find((value) => value && !value.startsWith('#') && !value.startsWith('![') && !value.startsWith('<'))
  return line ? clip(line, 200) : null
}

function cardEvidence(facts: RepoFacts, signals?: RepoSignals): AppCardEvidence {
  return {
    readme: readmeLine(facts.readme),
    lastCommit: facts.commits[0] ? {
      message: facts.commits[0].message,
      author: facts.commits[0].author,
      at: facts.commits[0].date,
      url: facts.commits[0].url,
    } : null,
    deployFile: facts.deployFile,
    repoFacts: {
      hasReadme: signals?.hasReadme ?? facts.readme !== null,
      secretFiles: [...(signals?.secretFiles ?? [])].sort(),
      private: facts.meta.private,
      lastCommitAt: signals?.lastCommitAt ?? facts.commits[0]?.date ?? null,
    },
  }
}

export function applySync(out: ToolOutput<'sync_app'>, ctx: Ctx & { facts: RepoFacts }): SyncResult {
  return { card: {
    what: clip(out.card.what, 240),
    who: clip(out.card.who, 160),
    stage: out.card.stage,
    status: clip(out.card.status, 400),
    checkedAt: null,
    evidence: cardEvidence(ctx.facts, ctx.signals),
  } }
}

function firstParagraph(markdown: string | null): string | null {
  if (!markdown) return null
  const paragraph = markdown.split(/\n\s*\n/).map((block) => block.trim())
    .find((block) => block && !block.startsWith('#') && !block.startsWith('![') && !block.startsWith('<') && !block.startsWith('[!'))
  return paragraph ? paragraph.replace(/\s+/g, ' ') : null
}

export function fallbackSync(facts: RepoFacts, ctx: Ctx, now: string): SyncResult {
  const last = facts.commits[0]?.date
  const ageDays = last ? (Date.parse(now) - Date.parse(last)) / 86_400_000 : null
  const live = !!ctx.signals?.liveUrl && ageDays !== null && ageDays < STALE_DAYS
  const stage: Stage = ageDays === null ? 'idea' : ageDays >= STALE_DAYS ? 'stale' : live ? 'live' : 'building'
  const week = facts.commits.filter((commit) => Date.parse(now) - Date.parse(commit.date) < 7 * 86_400_000).length
  const status = [
    `${week} commit${week === 1 ? '' : 's'} in the last 7 days, ${facts.pulls.length} open PR${facts.pulls.length === 1 ? '' : 's'}, ${facts.issues.length} open issue${facts.issues.length === 1 ? '' : 's'}.`,
    last ? `Latest: “${facts.commits[0].message}”.` : 'No commits yet.',
  ].join(' ')
  return { card: {
    what: clip(facts.meta.description || firstParagraph(facts.readme) || 'Not described in the repo yet.', 240),
    who: 'Not stated in the repo.',
    stage,
    status,
    evidence: cardEvidence(facts, ctx.signals),
  } }
}
