// App health flags from data we already hold (owner + last repo sync). Signals, not a security audit.
import type { Member, Project } from '../../types'
import { daysBetween, formatShort, isValidISODate, todayISO } from '../../lib/dates.js'

export type HealthKind = 'no-owner' | 'owner-leaving' | 'owner-left' | 'secrets' | 'public-repo' | 'stale' | 'no-readme' | 'no-repo'
export type Severity = 'high' | 'medium' | 'low'
export interface HealthFlag {
  kind: HealthKind
  severity: Severity
  label: string
}

export const STALE_DAYS = 14
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** How loud a flag looks. Red is kept for real risk (a committed secret, a public repo); people and pace flags are amber. */
export type FlagTone = 'risk' | 'warn' | 'quiet'
export function flagTone(flag: Pick<HealthFlag, 'kind' | 'severity'>): FlagTone {
  if (flag.kind === 'secrets' || flag.kind === 'public-repo') return 'risk'
  return flag.severity === 'low' ? 'quiet' : 'warn'
}

export interface HealthOptions {
  /** A one-person workspace, where every app is yours and ownership flags would be noise. */
  personal?: boolean
  /** Acknowledges the current quiet period. A later commit lets the flag return after another 14 days. */
  keptAt?: string | null
}

export function quietPeriodKept(lastCommitAt: string | null | undefined, keptAt: string | null | undefined): boolean {
  if (!lastCommitAt || !keptAt) return false
  const lastCommit = Date.parse(lastCommitAt)
  const kept = Date.parse(keptAt)
  return Number.isFinite(lastCommit) && Number.isFinite(kept) && kept >= lastCommit
}

export function health(p: Project, members: Member[], now = new Date(), opts: HealthOptions = {}): HealthFlag[] {
  if (p.archived) return []
  const flags: HealthFlag[] = []
  if (!opts.personal) {
    if (!p.ownerId) flags.push({ kind: 'no-owner', severity: 'high', label: 'No owner' })
    else {
      const owner = members.find((m) => m.id === p.ownerId)
      if (!owner?.active) flags.push({ kind: 'owner-left', severity: 'high', label: 'Owner has left' })
      else if (owner.leavingOn && isValidISODate(owner.leavingOn)) {
        const days = daysBetween(todayISO(now), owner.leavingOn)
        if (days <= 0) flags.push({ kind: 'owner-left', severity: 'high', label: 'Owner has left' })
        else if (days <= 30) flags.push({ kind: 'owner-leaving', severity: 'medium', label: `Owner leaves on ${formatShort(owner.leavingOn)}` })
      }
    }
  }

  const s = p.signals
  if (s?.secretFiles.length) flags.push({ kind: 'secrets', severity: 'high', label: `Secret file committed: ${s.secretFiles.slice(0, 2).join(', ')}` })
  if (p.repo && !p.repo.private) flags.push({ kind: 'public-repo', severity: 'medium', label: 'Public repo' })
  if (s?.lastCommitAt) {
    const days = (now.getTime() - new Date(s.lastCommitAt).getTime()) / 86_400_000
    if (days >= STALE_DAYS && !quietPeriodKept(s.lastCommitAt, opts.keptAt ?? p.keptAt)) {
      flags.push({ kind: 'stale', severity: 'medium', label: `No commits in ${Math.floor(days)} days` })
    }
  }
  if (s && !s.hasReadme) flags.push({ kind: 'no-readme', severity: 'low', label: 'No README' })
  if (!p.repo) flags.push({ kind: 'no-repo', severity: 'low', label: 'No repo connected' })
  return flags.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}
