// "Drafted by Claude Code for Dana · 2 days ago": the author line under an MCP draft. Pure.
// `draftedBy.client` is the name the AI client reported about itself. It is a label, so the wording never says it was verified.
import type { DraftedBy } from '../types'
import { clientName } from '../ai/tools/mcpDrafts'
import { daysBetween, formatCalendarDate, todayISO } from './dates'

type Named = { id: string; name: string }

/** The day a timestamp falls on in the viewer's calendar, or null when it is not a date. */
function localDay(iso: string | null | undefined): string | null {
  const at = iso ? new Date(iso) : null
  return at && !Number.isNaN(at.getTime()) ? todayISO(at) : null
}

/** "today", "yesterday", "3 days ago", then a calendar date. A time in the future (clock skew) reads as today. */
export function relativeDay(iso: string | null | undefined, now = new Date()): string {
  const day = localDay(iso)
  if (!day) return ''
  const ago = daysBetween(day, todayISO(now))
  if (ago <= 0) return 'today'
  if (ago === 1) return 'yesterday'
  return ago < 7 ? `${ago} days ago` : formatCalendarDate(day)
}

/** The client's own name for itself, as one short line. */
const who = (by: DraftedBy): string => (by.client?.trim() ? clientName(by.client) : 'an AI agent')

/** The teammate an agent drafted for, by the member id Tempo took from the sign-in token. */
const forWhom = (by: DraftedBy, members: readonly Named[]): string => members.find((member) => member.id === by.memberId)?.name.trim() || 'a teammate'

/** Review: "Drafted by Claude Code for Dana · today". */
export function draftedByLine(by: DraftedBy, members: readonly Named[], now = new Date()): string {
  const when = relativeDay(by.at, now)
  return `Drafted by ${who(by)} for ${forWhom(by, members)}${when ? ` · ${when}` : ''}`
}

/** Handover: "Written by Claude Code for Dana on 5 Oct 2026". */
export function handoverByline(by: DraftedBy, members: readonly Named[]): string {
  const day = localDay(by.at)
  return `Written by ${who(by)} for ${forWhom(by, members)}${day ? ` on ${formatCalendarDate(day)}` : ''}`
}
