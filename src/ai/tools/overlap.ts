// Duplicate and dead-app detection from data we already hold. Pure and deterministic: token overlap, no AI.
// These are hints for a human to review, never verdicts.
import type { Activity, Project } from '../../types'
import { quietPeriodKept } from './health'

export const DEAD_DAYS = 30
export const DUPLICATE_THRESHOLD = 0.25
const NAME_THRESHOLD = 0.5
/** Name similarity alone is not enough for tiny names; the descriptions must overlap a little too. */
const NAME_RULE_MIN_TEXT = 0.12

export interface DuplicateGroup {
  appIds: string[]
  reason: string
  score: number
}
export interface DeadApp {
  appId: string
  days: number
  reason: string
}

const STOP = new Set(
  ('a an the and or of for to in on at by with from into is are be it its this that these those as it you your we our they their ' +
    'app apps tool tools web page site new use used using user users team teams build built make made help helper helps every each all ' +
    'work works one more can will get gets lets let its also still just very per who what when which while than then so not no yes ' +
    'bot dashboard portal everyone people staff').split(' '),
)

export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && w.endsWith('es') && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue
    const s = stem(raw)
    if (s.length >= 3 && !STOP.has(s)) out.add(s)
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

interface Profile {
  id: string
  name: Set<string>
  all: Set<string>
}

function profile(p: Project): Profile {
  const name = tokens(`${p.name} ${p.repo?.fullName.split('/')[1] ?? ''}`)
  const all = tokens([p.name, p.description, p.appCard?.what ?? '', p.appCard?.who ?? ''].join(' '))
  for (const t of name) all.add(t)
  return { id: p.id, name, all }
}

function shared(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((t) => b.has(t)).sort()
}

function plainList(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export function findDuplicates(projects: Project[]): DuplicateGroup[] {
  const ps = projects.filter((p) => !p.archived).map(profile).sort((a, b) => a.id.localeCompare(b.id))
  const parent = new Map(ps.map((p) => [p.id, p.id]))
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!))
  const pairs: { a: Profile; b: Profile; score: number }[] = []

  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const text = jaccard(ps[i].all, ps[j].all)
      const nameSim = jaccard(ps[i].name, ps[j].name)
      if (text >= DUPLICATE_THRESHOLD || (nameSim >= NAME_THRESHOLD && text >= NAME_RULE_MIN_TEXT)) {
        pairs.push({ a: ps[i], b: ps[j], score: text })
        parent.set(find(ps[i].id), find(ps[j].id))
      }
    }
  }

  const groups = new Map<string, { ids: Set<string>; best: (typeof pairs)[number] }>()
  for (const pr of pairs) {
    const root = find(pr.a.id)
    const g = groups.get(root) ?? { ids: new Set<string>(), best: pr }
    g.ids.add(pr.a.id).add(pr.b.id)
    if (pr.score > g.best.score) g.best = pr
    groups.set(root, g)
  }

  return [...groups.values()]
    .map((g) => {
      const words = shared(g.best.a.all, g.best.b.all).slice(0, 3)
      return {
        appIds: [...g.ids].sort(),
        reason: words.length ? `${g.ids.size === 2 ? 'Both' : 'All'} deal with ${plainList(words)}` : 'Their names and descriptions are very similar',
        score: Math.round(g.best.score * 100) / 100,
      }
    })
    .sort((a, b) => b.score - a.score || a.appIds[0].localeCompare(b.appIds[0]))
}

export function findDeadApps(projects: Project[], activity: Activity[], now = new Date()): DeadApp[] {
  const latest = new Map<string, number>()
  for (const a of activity) {
    if (a.kind !== 'sync') latest.set(a.projectId, Math.max(latest.get(a.projectId) ?? 0, new Date(a.at).getTime()))
  }
  const out: DeadApp[] = []
  for (const p of projects) {
    if (p.archived || quietPeriodKept(p.signals?.lastCommitAt, p.keptAt)) continue
    const stamps = [latest.get(p.id), p.signals?.lastCommitAt, p.lastActivityAt].map((s) => (typeof s === 'number' ? s : s ? new Date(s).getTime() : NaN)).filter((n) => !Number.isNaN(n))
    // Nothing recorded at all: judge by when the app was added, so a brand-new app is not "dead".
    const last = stamps.length ? Math.max(...stamps) : new Date(p.createdAt).getTime()
    const days = Math.floor((now.getTime() - last) / 86_400_000)
    if (days >= DEAD_DAYS) out.push({ appId: p.id, days, reason: `No activity in ${days} days` })
  }
  return out.sort((a, b) => b.days - a.days || a.appId.localeCompare(b.appId))
}

export interface SavedEstimate {
  duplicateGroups: number
  appsInDuplicateGroups: number
  deadApps: number
  /** Distinct apps worth a look. Counts only: no invented money or hours. */
  appsToReview: number
}

export function savedEstimate(groups: DuplicateGroup[], dead: DeadApp[]): SavedEstimate {
  const inGroups = new Set(groups.flatMap((g) => g.appIds))
  const all = new Set([...inGroups, ...dead.map((d) => d.appId)])
  return { duplicateGroups: groups.length, appsInDuplicateGroups: inGroups.size, deadApps: dead.length, appsToReview: all.size }
}
