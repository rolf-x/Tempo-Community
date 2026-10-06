// A name from the AI or a commit author → member id. Ambiguity returns null:
// a wrong owner is worse than no suggestion.
import type { Member } from '../../types'

export interface CommitIdentity {
  /** RepoFacts currently uses this field. It may be a GitHub login, name or email. */
  author?: string | null
  authorLogin?: string | null
  authorName?: string | null
  authorEmail?: string | null
  date: string
}

export interface OwnerSuggestion {
  name: string
  login: string | null
  email: string | null
  memberId: string | null
  commits: number
  totalCommits: number
  share: number
  since: string
}

const normal = (value: string | null | undefined) => value?.trim().replace(/^@/, '').toLowerCase() ?? ''
const authorParts = (raw: string | null | undefined) => {
  const value = raw?.trim() ?? ''
  const angle = value.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/)
  if (angle) return { name: angle[1].trim(), email: angle[2].trim() }
  return value.includes('@') ? { name: '', email: value } : { name: value, email: '' }
}

export function matchMember(raw: string | null | undefined, members: Member[]): string | null {
  const parsed = authorParts(raw)
  const q = normal(parsed.email || parsed.name)
  if (!q) return null
  const one = (hits: Member[]) => (hits.length === 1 ? hits[0].id : hits.length > 1 ? 'ambiguous' : null)
  const first = (x: Member) => x.name.trim().split(/\s+/)[0].toLowerCase()
  const steps = [
    (x: Member) => normal(x.githubLogin) === q,
    (x: Member) => normal(x.email) === q,
    (x: Member) => normal(x.name) === q,
    (x: Member) => first(x) === q,
    (x: Member) => first(x).startsWith(q),
  ]
  for (const step of steps) {
    const r = one(members.filter(step))
    if (r === 'ambiguous') return null
    if (r) return r
  }
  return null
}

function identity(commit: CommitIdentity) {
  const parsed = authorParts(commit.author)
  const login = commit.authorLogin?.trim().replace(/^@/, '') || null
  const email = commit.authorEmail?.trim() || parsed.email || null
  const name = commit.authorName?.trim() || parsed.name || login || email || ''
  const key = normal(login) || normal(email) || normal(name)
  return { login, email, name, key }
}

function memberForAuthor(author: ReturnType<typeof identity>, members: Member[]): Member | null {
  const ids = [author.login, author.email, author.name]
    .map((value) => matchMember(value, members))
    .filter((id): id is string => !!id)
  const unique = [...new Set(ids)]
  return unique.length === 1 ? members.find((member) => member.id === unique[0]) ?? null : null
}

/** First day of the month `months` ago. Oct 4 with the default produces Jul 1. */
export function commitShareWindowStart(now = new Date(), months = 3): Date {
  return new Date(now.getFullYear(), now.getMonth() - months, 1)
}

/**
 * Suggest the current top committer since `since`. Known former members are excluded as candidates,
 * but their commits stay in the denominator so the displayed share remains honest.
 */
export function suggestOwnerByCommitShare(commits: CommitIdentity[], members: Member[], since: Date): OwnerSuggestion | null {
  const start = since.getTime()
  if (!Number.isFinite(start)) return null
  const eligible = commits
    .map((commit) => ({ commit, at: Date.parse(commit.date), author: identity(commit) }))
    .filter(({ at, author }) => Number.isFinite(at) && at >= start && !!author.key && author.key !== 'unknown')
  if (!eligible.length) return null

  const groups = new Map<string, { author: ReturnType<typeof identity>; member: Member | null; count: number }>()
  for (const item of eligible) {
    const member = memberForAuthor(item.author, members)
    const key = member ? `member:${member.id}` : `author:${item.author.key}`
    const current = groups.get(key)
    if (current) current.count += 1
    else groups.set(key, { author: item.author, member, count: 1 })
  }
  const ranked = [...groups.values()]
    .filter((group) => group.member?.active !== false)
    .sort((a, b) => b.count - a.count || (a.member?.name ?? a.author.name).localeCompare(b.member?.name ?? b.author.name))
  if (!ranked.length || (ranked[1] && ranked[0].count === ranked[1].count)) return null

  const top = ranked[0]
  return {
    name: top.member?.name ?? top.author.name,
    login: top.author.login ?? top.member?.githubLogin ?? null,
    email: top.author.email ?? top.member?.email ?? null,
    memberId: top.member?.id ?? null,
    commits: top.count,
    totalCommits: eligible.length,
    share: Math.round((top.count / eligible.length) * 100),
    since: since.toISOString(),
  }
}

export function suggestionSinceLabel(since: string, locale = 'en'): string {
  const date = new Date(since)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { month: 'long' }).format(date) : ''
}
