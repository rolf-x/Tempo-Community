// Demo data: "Acme", a fictional company with six vibe-coded internal apps. Dates are relative to now so
// the demo never looks stale. Every repo is a labelled sample (acme-sample/…), not a real GitHub project.
import type { Activity, AppCard, Color, Member, PersistedState, Project, RepoSignals } from '../types'
import { activityId, projectId } from './ids'
import { makeMember } from '../store/migrate'

interface SeedEvent {
  h: number // hours ago
  kind: Activity['kind']
  actor: string
  title: string
  path?: string
}

interface SeedApp {
  name: string
  emoji: string
  color: Color
  description: string
  owner: string | null // member key
  repo: string | null // repo name under acme-sample
  privateRepo?: boolean
  liveUrl?: string
  card: Omit<AppCard, 'updatedAt' | 'source'>
  signals: Omit<RepoSignals, 'syncedAt' | 'lastCommitAt'> & { lastCommitDays: number | null }
  events: SeedEvent[]
}

const PEOPLE: Record<string, Partial<Member> & { name: string }> = {
  me: { name: 'You', role: 'owner' },
  sam: { name: 'Sam Haddad', githubLogin: 'samhaddad', email: 'sam@acme.example' },
  nadia: { name: 'Nadia Karam', githubLogin: 'nadiak', email: 'nadia@acme.example' },
  omar: { name: 'Omar Fayed', githubLogin: 'omarf', email: 'omar@acme.example' },
  maya: { name: 'Maya Chen', githubLogin: 'mayachen', email: 'maya@acme.example' },
  lina: { name: 'Lina Aoun', githubLogin: 'linaaoun', email: 'lina@acme.example', active: false },
}

const APPS: SeedApp[] = [
  {
    name: 'Expense Bot',
    emoji: '🧾',
    color: 'green',
    description: 'Slack bot that reads receipt photos and files them in the finance sheet.',
    owner: 'maya',
    repo: 'expense-bot',
    privateRepo: true,
    card: {
      what: 'A Slack bot: post a receipt photo, it extracts amount, vendor and date, and adds a row to the finance sheet.',
      who: 'Everyone who expenses things; finance reviews the sheet weekly.',
      stage: 'live',
      status: 'In daily use. This week Claude Code added multi-currency support; the VAT field is still read wrong on some UAE receipts.',
    },
    signals: { hasReadme: true, secretFiles: [], lastCommitDays: 0, openIssues: 3, openPrs: 1 },
    events: [
      { h: 2.2, kind: 'commit', actor: 'mayachen', title: 'feat: multi-currency amounts', path: '/commit/8f2c1ab' },
      { h: 20, kind: 'issue', actor: 'linaaoun', title: 'VAT read as total on Carrefour receipts', path: '/issues/14' },
    ],
  },
  {
    name: 'Onboarding Portal',
    emoji: '🧭',
    color: 'blue',
    description: 'New-hire checklist: accounts, laptop, first-week meetings.',
    owner: 'nadia',
    repo: 'onboarding-portal',
    liveUrl: 'https://onboarding.acme.example',
    privateRepo: true,
    card: {
      what: 'A web app that gives each new hire a personal checklist (accounts, laptop, buddy, first-week meetings) and shows HR who is stuck.',
      who: 'New hires and HR. Built in Lovable, synced to GitHub.',
      stage: 'building',
      status: 'Checklist and HR view work. Google Workspace account creation is next; two hires start on the 12th, so that is the deadline.',
    },
    signals: { hasReadme: false, secretFiles: [], lastCommitDays: 1, openIssues: 2, openPrs: 2 },
    events: [
      { h: 5, kind: 'pr', actor: 'nadiak', title: 'HR dashboard: who is stuck and on which step', path: '/pull/9' },
      { h: 26, kind: 'commit', actor: 'nadiak', title: 'Sync from Lovable: role templates', path: '/commit/41d9e07' },
    ],
  },
  {
    name: 'Sales Dashboard',
    emoji: '📈',
    color: 'violet',
    description: 'Pipeline and quota view pulled from the CRM every hour.',
    owner: 'omar',
    repo: 'sales-dashboard',
    liveUrl: 'https://sales.acme.example',
    privateRepo: false,
    card: {
      what: 'A dashboard that pulls deals from the CRM hourly and shows pipeline, win rate and each rep’s quota progress.',
      who: 'The sales team and leadership on Monday calls.',
      stage: 'live',
      status: 'Used every Monday. The repo is public and a .env file with a CRM key is committed: rotate the key and make the repo private.',
    },
    signals: { hasReadme: true, secretFiles: ['.env'], lastCommitDays: 4, openIssues: 1, openPrs: 0 },
    events: [
      { h: 95.5, kind: 'commit', actor: 'omarf', title: 'feat: quota view per region (behind flag)', path: '/commit/9b8a7c6' },
      { h: 50, kind: 'issue', actor: 'nadiak', title: 'Leadership wants a CSV export of the pipeline', path: '/issues/5' },
      { h: 97, kind: 'commit', actor: 'omarf', title: 'win rate chart', path: '/commit/c0ffee1' },
    ],
  },
  {
    name: 'Contract Reviewer',
    emoji: '📄',
    color: 'amber',
    description: 'Flags risky clauses in supplier contracts before legal sees them.',
    owner: 'lina',
    repo: 'contract-reviewer',
    privateRepo: true,
    card: {
      what: 'Upload a supplier contract and it flags auto-renewal, liability caps and payment terms that break Acme’s policy.',
      who: 'Procurement, before sending contracts to legal.',
      stage: 'stale',
      status: 'Worked as a prototype. Its builder, Lina, has left Acme and nothing has changed in 23 days. Procurement still uses it: it needs a new owner.',
    },
    signals: { hasReadme: true, secretFiles: [], lastCommitDays: 23, openIssues: 4, openPrs: 0 },
    events: [
      { h: 23 * 24 + 1, kind: 'commit', actor: 'linaaoun', title: 'wip: ocr', path: '/commit/7a1b2c3' },
    ],
  },
  {
    name: 'Support Triage',
    emoji: '🎧',
    color: 'rose',
    description: 'Routes incoming support tickets to the right team with a suggested reply.',
    owner: 'sam',
    repo: 'support-triage',
    liveUrl: 'https://support.acme.example',
    privateRepo: true,
    card: {
      what: 'Reads each new support ticket, tags it (billing, bug, how-to), routes it to the right queue and drafts a first reply.',
      who: 'The support team; customers see faster first replies.',
      stage: 'building',
      status: 'Routing works on test tickets. Codex is wiring the helpdesk webhook; the go-live check slipped two days.',
    },
    signals: { hasReadme: true, secretFiles: [], lastCommitDays: 0, openIssues: 5, openPrs: 1 },
    events: [
      { h: 1.3, kind: 'commit', actor: 'samhaddad', title: 'feat: helpdesk webhook endpoint', path: '/commit/5e6f7a8' },
      { h: 30, kind: 'issue', actor: 'nadiak', title: 'Refund tickets routed to the bug queue', path: '/issues/22' },
    ],
  },
  {
    name: 'Desk Booking',
    emoji: '🪑',
    color: 'teal',
    description: 'Book a desk for office days. Someone started it; nobody owns it.',
    owner: null,
    repo: 'desk-booking',
    privateRepo: true,
    card: {
      what: 'A page to book a desk for the days you come in, with a floor map.',
      who: 'Hybrid staff at the Dubai office.',
      stage: 'idea',
      status: 'A first screen exists from a weekend session. No owner and no plan yet.',
    },
    signals: { hasReadme: false, secretFiles: [], lastCommitDays: 16, openIssues: 0, openPrs: 0 },
    events: [{ h: 16 * 24, kind: 'commit', actor: 'samhaddad', title: 'first screen: floor map', path: '/commit/0d1e2f3' }],
  },
  {
    name: 'Receipts Helper',
    emoji: '🧮',
    color: 'slate',
    description: 'Upload a receipt photo and it files the expense in the finance spreadsheet.',
    owner: 'sam',
    repo: 'receipts-helper',
    privateRepo: true,
    card: {
      what: 'Upload a receipt photo and it extracts the amount, vendor and date, then files the expense in the finance spreadsheet.',
      who: 'Employees who expense things; finance.',
      stage: 'building',
      status: 'Extraction works on clean photos. Sam started it before learning Expense Bot already exists.',
    },
    signals: { hasReadme: true, secretFiles: [], lastCommitDays: 3, openIssues: 1, openPrs: 0 },
    events: [{ h: 3 * 24, kind: 'commit', actor: 'samhaddad', title: 'receipt photo extraction', path: '/commit/3c4d5e6' }],
  },
  {
    name: 'Hackday Quiz',
    emoji: '🎲',
    color: 'violet',
    description: 'Live quiz built for the September hack day.',
    owner: 'omar',
    repo: 'hackday-quiz',
    privateRepo: true,
    card: {
      what: 'A live team quiz with a scoreboard, built for the hack day.',
      who: 'Whoever ran the hack day.',
      stage: 'stale',
      status: 'Used once. Nothing has changed in 47 days.',
    },
    signals: { hasReadme: true, secretFiles: [], lastCommitDays: 47, openIssues: 0, openPrs: 0 },
    events: [{ h: 47 * 24, kind: 'commit', actor: 'omarf', title: 'final scoreboard tweaks', path: '/commit/aa11bb2' }],
  },
]

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

export function makeSeed(): Pick<PersistedState, 'projects' | 'members' | 'activity' | 'meId'> {
  const now = new Date().toISOString()
  const ids: Record<string, string> = {}
  const members: Member[] = Object.entries(PEOPLE).map(([key, p]) => {
    const m = makeMember(p.name, p)
    ids[key] = m.id
    return m
  })
  const projects: Project[] = []
  const activity: Activity[] = []

  for (const app of APPS) {
    const url = app.repo ? `https://github.com/acme-sample/${app.repo}` : null
    const events = [...app.events].sort((a, b) => a.h - b.h)
    const p: Project = {
      id: projectId(),
      name: app.name,
      emoji: app.emoji,
      color: app.color,
      description: app.description,
      createdAt: now,
      archived: false,
      ownerId: app.owner ? ids[app.owner] : null,
      repo: app.repo ? { fullName: `acme-sample/${app.repo}`, url: url!, private: app.privateRepo ?? true, defaultBranch: 'main' } : null,
      liveUrl: app.liveUrl ?? null,
      signals: {
        hasReadme: app.signals.hasReadme,
        secretFiles: app.signals.secretFiles,
        openIssues: app.signals.openIssues,
        openPrs: app.signals.openPrs,
        lastCommitAt: app.signals.lastCommitDays === null ? null : hoursAgo(app.signals.lastCommitDays * 24 + 2),
        syncedAt: hoursAgo(0.5),
      },
      appCard: { ...app.card, updatedAt: hoursAgo(0.5), source: 'demo' },
      lastActivityAt: events[0] ? hoursAgo(events[0].h) : null,
      autoApply: false,
    }
    projects.push(p)
    for (const e of events) {
      activity.push({
        id: activityId(),
        projectId: p.id,
        kind: e.kind,
        actor: e.actor,
        title: e.title,
        url: e.path && url ? url + e.path : null,
        at: hoursAgo(e.h),
      })
    }
  }
  activity.sort((a, b) => b.at.localeCompare(a.at))
  return { projects, members, activity, meId: ids.me }
}
