// Static sample data for the landing visuals ("Halden Freight", a made-up company). The landing is public and must not depend
// on the app's seed or store, so the illustrations carry their own rows. Everything here is labelled as a sample
// where it's shown.
import type { HealthFlag } from '../../ai/tools/health'
import type { Stage } from '../../types'

export interface SampleOwner {
  name: string
  /** false = has left the company */
  active: boolean
}

export interface SampleApp {
  id: string
  name: string
  emoji: string
  repo: string
  /** One line: what the app does */
  what: string
  /** Who uses it and how to get in */
  access: string
  stage: Stage
  owner: SampleOwner | null
  flags: HealthFlag[]
  /** Last activity, as the card shows it */
  last: string
}

const flag = (kind: HealthFlag['kind'], severity: HealthFlag['severity'], label: string): HealthFlag => ({ kind, severity, label })

export const APPS: SampleApp[] = [
  {
    id: 'expense-bot',
    name: 'Expense bot',
    emoji: '🧾',
    repo: 'halden/expense-bot',
    what: 'Post a receipt photo in Slack and it files the expense in the finance sheet.',
    access: 'Everyone · /expense in Slack',
    stage: 'live',
    owner: null,
    flags: [flag('no-owner', 'high', 'No owner')],
    last: 'Commit · 2 d ago',
  },
  {
    id: 'fuel-card-reconciliation',
    name: 'Fuel card reconciliation',
    emoji: '💳',
    repo: 'halden/fuel-card-reconciliation',
    what: 'Match fuel card charges to trips and send unmatched charges to finance.',
    access: 'Finance · ask Tomas',
    stage: 'live',
    owner: { name: 'Tomas Berg', active: true },
    flags: [flag('secrets', 'high', 'Secret file committed: .env on main · 3 Oct')],
    last: 'Commit · 3 Oct',
  },
  {
    id: 'dock-scheduler',
    name: 'Dock scheduler',
    emoji: '🚚',
    repo: 'halden/dock-scheduler',
    what: 'Book loading slots and keep dispatch and warehouse teams in sync.',
    access: 'Dispatch · ask Priya',
    stage: 'building',
    owner: { name: 'Priya Nair', active: true },
    flags: [],
    last: 'Pull request · 2 h ago',
  },
  {
    id: 'driver-onboarding',
    name: 'Driver onboarding',
    emoji: '🧭',
    repo: 'halden/driver-onboarding',
    what: 'Track licences, safety checks and paperwork for new drivers.',
    access: 'HR and new drivers · company SSO',
    stage: 'stale',
    owner: { name: 'Jonas Weber', active: false },
    flags: [flag('owner-left', 'high', 'Owner left in August'), flag('stale', 'medium', 'No commits in 21 days')],
    last: 'Commit · 21 d ago',
  },
  {
    id: 'receipt-scanner',
    name: 'Receipt scanner',
    emoji: '📸',
    repo: 'halden/receipt-scanner',
    what: 'Upload a receipt and it files the expense in the finance spreadsheet.',
    access: 'Ops · ask Ana',
    stage: 'building',
    owner: { name: 'Ana Costa', active: true },
    flags: [],
    last: 'Pull request · 1 h ago',
  },
  {
    id: 'route-planner',
    name: 'Route planner',
    emoji: '🗺️',
    repo: 'halden/route-planner',
    what: 'Plan delivery routes and share the next stops with drivers.',
    access: 'Dispatch · ask Sam',
    stage: 'live',
    owner: { name: 'Sam Okafor', active: true },
    flags: [],
    last: 'Commit · 40 min ago',
  },
  {
    id: 'desk-booking',
    name: 'Desk booking',
    emoji: '🪑',
    repo: 'halden/desk-booking',
    what: 'Book a desk for the days you come in, with a floor map.',
    access: 'Office staff · ask Maya',
    stage: 'stale',
    owner: { name: 'Maya Lind', active: true },
    flags: [flag('stale', 'medium', 'No commits in 34 days'), flag('no-readme', 'low', 'No README')],
    last: 'Commit · 34 d ago',
  },
  {
    id: 'customs-docs',
    name: 'Customs docs',
    emoji: '📄',
    repo: 'halden/customs-docs',
    what: 'Prepare customs paperwork and track missing documents for each shipment.',
    access: 'Operations · ask Lea',
    stage: 'live',
    owner: { name: 'Lea Moreau', active: true },
    flags: [flag('public-repo', 'medium', 'Public repo')],
    last: 'Commit · 6 d ago',
  },
]

/** The named apps, in the order given. */
export function appsNamed(names: string[]): SampleApp[] {
  return names.flatMap((n) => APPS.filter((a) => a.name === n))
}

const isHigh = (a: SampleApp) => a.flags.some((f) => f.severity === 'high')
const isStale = (a: SampleApp) => a.stage === 'stale' || a.flags.some((f) => f.kind === 'stale')
const hasNoOwner = (a: SampleApp) => a.flags.some((f) => f.kind === 'no-owner' || f.kind === 'owner-left')

/** Portfolio header counts, derived from the rows above so the numbers always match what's drawn. */
export const COUNTS = {
  apps: APPS.length,
  attention: APPS.filter(isHigh).length,
  stale: APPS.filter(isStale).length,
  noOwner: APPS.filter(hasNoOwner).length,
}
