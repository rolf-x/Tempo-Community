// Drafts an agent writes over MCP. The server cleans them before saving, and the browser cleans a stored handover
// again before showing it, so a draft written straight to the database is shown the same way. Pure.
import type { HandoverOut, ToolOutput } from '../schemas'
import { plain } from './applySync.js'
import { cleanHandover } from './handoverFallback.js'
import type { HealthKind } from './health'
import { redactDeep } from './repoFacts.js'

type CardDraft = ToolOutput<'sync_app'>['card']

export const CARD_LIMITS = { what: 240, who: 160, status: 400 } as const
const LIST_MAX = 20
const ITEM_MAX = 300
const CLIENT_MAX = 60

// Zero-width characters and bidi controls: invisible, and bidi overrides can make text read differently than it is.
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** Every string an agent sends, before anything else looks at it. */
const visible = <T>(value: T): T => {
  if (typeof value === 'string') return value.replace(INVISIBLE, '') as T
  if (Array.isArray(value)) return value.map(visible) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visible(v)])) as T
  return value
}

/** Prose becomes text: no HTML tags, autolinks, inline or reference links (escaped brackets included), emphasis or code. */
const flatten = (value: string) => plain(value
  .replace(/<\/?[A-Za-z][^<>]*>/g, '')
  .replace(/<((?:https?|mailto|javascript|data):[^<>\s]*)>/gi, '$1')
  .replace(/\[((?:\\.|[^\]\\])*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
  .replace(/\[((?:\\.|[^\]\\])*)\]\[[^\]]*\]/g, '$1')
  .replace(/\\([[\]()])/g, '$1'))

const clip = (value: string, limit: number) => {
  const text = flatten(value).replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text
}

/** Same limits as an in-app sync (applySync), with secrets redacted and markdown flattened to text. */
export function cleanCardDraft(card: CardDraft): CardDraft {
  const safe = redactDeep(visible(card))
  return {
    what: clip(safe.what, CARD_LIMITS.what),
    who: clip(safe.who, CARD_LIMITS.who) || 'Not stated in the repo.',
    stage: safe.stage,
    status: clip(safe.status, CARD_LIMITS.status),
  }
}

export const TASK_LIMITS = { title: 80, detail: 240 } as const

/** One task for a problem Tempo flags on an app (a health flag), as an agent sends it and as it is saved. */
export interface TaskDraft { problem: HealthKind; title: string; detail: string | null }

/**
 * Tasks an agent wrote for an app's health flags: plain text, secrets redacted, a title of up to 80 characters and a
 * detail of up to 240. A task with no title is dropped, and so is a second one with the same problem and title.
 */
/** A task is a note, never a link: web addresses go once markup is flattened (the database removes them too). */
export const TASK_LINK = /(?:https?:\/\/|www\.)\S*/gi

const clipTask = (value: string, limit: number) => clip(flatten(value).replace(TASK_LINK, ' '), limit)

/**
 * A task as shown in the browser: invisible characters out, secrets redacted, markup flattened, links removed, one line.
 * The server and the database already clean what they store; this holds for anything stored another way.
 */
export function taskText(value: string, limit: number): string {
  return clipTask(redactDeep(visible(value)), limit)
}

export function cleanTasksDraft(tasks: ReadonlyArray<{ problem: HealthKind; title: string; detail?: string | null }>): TaskDraft[] {
  const seen = new Set<string>()
  const out: TaskDraft[] = []
  for (const task of tasks) {
    const safe = redactDeep(visible({ title: task.title, detail: task.detail ?? '' }))
    const title = clipTask(safe.title, TASK_LIMITS.title)
    const key = `${task.problem}\n${title.toLowerCase()}`
    if (!title || seen.has(key)) continue
    seen.add(key)
    out.push({ problem: task.problem, title, detail: clipTask(safe.detail, TASK_LIMITS.detail) || null })
  }
  return out
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Evidence links a handover may keep: issue, pull request and commit pages of the app's own GitHub repo. */
export function repoEvidenceUrls(doc: HandoverOut, repoFullName: string | null | undefined): Set<string> {
  if (!repoFullName) return new Set()
  const HOST = 'https://github.com/'
  // The scheme and host exactly as GitHub writes them; owner and repo names are case-insensitive on GitHub.
  const page = new RegExp(`^${escape(repoFullName)}/(issues/\\d+|pull/\\d+|commit/[0-9a-f]{7,40})$`, 'i')
  return new Set(doc.openWork.map((item) => item.evidenceUrl?.trim() ?? '')
    .filter((url) => url.startsWith(HOST) && page.test(url.slice(HOST.length))))
}

/** Plain text, redacted, capped lists and items; the only links left point into the app's own repo. */
export function cleanHandoverDraft(doc: HandoverOut, repoFullName: string | null | undefined): HandoverOut {
  const safe = redactDeep(visible(doc))
  const clean = cleanHandover(safe, repoEvidenceUrls(safe, repoFullName))
  const list = (items: string[]) => items.slice(0, LIST_MAX).map((item) => clip(item, ITEM_MAX))
  return {
    summary: clip(clean.summary, 1200),
    howToRun: clean.howToRun.slice(0, LIST_MAX).map((item) => item.slice(0, ITEM_MAX)),
    whereThingsAre: clean.whereThingsAre.slice(0, LIST_MAX).map((item) => ({ path: item.path.slice(0, ITEM_MAX), what: clip(item.what, ITEM_MAX) })),
    openWork: clean.openWork.slice(0, LIST_MAX).map((item) => ({ ...item, title: clip(item.title, ITEM_MAX) })),
    risks: list(clean.risks),
    contacts: list(clean.contacts),
    unknowns: list(clean.unknowns),
  }
}

/** The name an MCP client reports about itself, as one short line. It is a label, not proof of who wrote the draft. */
export function clientName(raw: string | null | undefined): string {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim()
  return name ? name.slice(0, CLIENT_MAX) : 'An AI agent'
}
