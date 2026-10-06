// The five selling points on the landing page, each with a product visual built in JSX from the Halden Freight sample:
// the app directory (a search that types itself), duplicates and quiet apps (an archive that happens), the handover
// pack (sections that tick in), health flags (that pop into place) and live repo activity.
// Illustrations only (nothing links into the app). Static data, no store; motion is position/opacity only and the
// mocks rest in their finished state under reduced motion.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { Archive, Check, Circle, ExternalLink, FileText, GitMerge, Search, UserRoundPlus } from 'lucide-react'
import { SampleFlags, useSignalReveal } from './Signal'
import { Avatar, EASE, cn } from '../ui'
import { COUNTS, appsNamed } from './sample'
import { BENEFITS } from './copy'

const MOCKS: ComponentType[] = [DirectoryMock, DuplicatesMock, RiskMock, HandoverMock, StatusMock]
const PILLARS = BENEFITS.map((item, i) => ({ ...item, mock: MOCKS[i] }))

export function Pillars() {
  const reveal = useSignalReveal()
  return (
    <ol className="signal-pillars grid grid-cols-1 items-stretch gap-4 sm:gap-6 lg:grid-cols-2">
      {PILLARS.map(({ title, body, mock: Mock }, i) => {
        return (
          <motion.li key={title} {...reveal()} className={cn('signal-pillar flex min-w-0 flex-col gap-6 rounded-2xl border border-border bg-surface p-5 lg:p-7', i === 2 && 'lg:col-span-2')}>
            <div>
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border-strong bg-surface text-sm font-medium tabular-nums text-text">{i + 1}</span>
              <h3 className="mt-4 text-xl font-semibold leading-snug tracking-[0.2px] text-text">{title}</h3>
              <p className="mt-3 max-w-[52ch] text-[16px] leading-[1.6] text-text-muted">{body}</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <div className="min-w-0">
                <Mock />
                <p className="mt-3 text-center text-xs text-text-muted">Halden Freight · Sample data</p>
              </div>
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}

/* ── Shared bits ───────────────────────────────────────────────────────────── */

function Shell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-border bg-surface shadow-xs', className)}>{children}</div>
}

function Pill({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'accent' | 'success' | 'danger'; className?: string }) {
  const cls = {
    muted: 'bg-surface-2 text-text-muted',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
  }[tone]
  return <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium', cls, className)}>{children}</span>
}

/** A button-shaped label inside a mock (decorative; the mocks are illustrations). */
function FauxButton({ children, primary, className }: { children: ReactNode; primary?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium',
        primary ? 'signal-pill' : 'border border-border bg-surface text-text shadow-xs',
        className,
      )}
      aria-hidden
    >
      {children}
    </span>
  )
}

/** Trigger a sequence once; reduced motion renders its final state. */
function useFirstView(ref: React.RefObject<Element | null>, reduced: boolean) {
  const inView = useInView(ref, { once: true, margin: '-40px' })
  return { inView, running: inView && !reduced }
}

/* ── 1 · Directory: a search that types itself ─────────────────────────────── */

const DIRECTORY_APPS = ['Expense bot', 'Dock scheduler', 'Receipt scanner', 'Fuel card reconciliation', 'Route planner']
const QUERY = 'expense'

function DirectoryMock() {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const { running } = useFirstView(ref, reduced)
  const [n, setN] = useState(() => (reduced ? QUERY.length : 0))

  useEffect(() => {
    if (reduced) { setN(QUERY.length); return }
    if (!running || n >= QUERY.length) return
    const t = window.setTimeout(() => setN(n + 1), n === 0 ? 900 : 150)
    return () => window.clearTimeout(t)
  }, [n, running, reduced])

  const query = QUERY.slice(0, n)
  const apps = appsNamed(DIRECTORY_APPS)
  const matches = (name: string, what: string) => query.length === 0 || `${name} ${what}`.toLowerCase().includes(query)
  const hits = query.length === QUERY.length ? apps.filter((a) => matches(a.name, a.what)).length : null

  return (
    <Shell>
      <div ref={ref} className="border-b border-border p-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-sm" aria-hidden>
          <Search className="size-4 shrink-0 text-text-muted" />
          <span className="flex min-w-0 flex-1 items-center">
            {query ? <span className="truncate text-text">{query}</span> : <span className="truncate text-text-muted">Search apps…</span>}
            {!reduced && n < QUERY.length && (
              <motion.span
                className="ml-px h-4 w-px shrink-0 bg-text"
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: 'linear' }}
              />
            )}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-text-muted">{hits === null ? `${COUNTS.apps} apps` : `${hits} of ${COUNTS.apps}`}</span>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {apps.map((a) => {
          const hit = matches(a.name, a.what)
          return (
            <motion.li
              key={a.id}
              className={cn("flex items-center gap-3 p-3", hit && query && "bg-surface-2")}
              initial={false}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-bg text-base leading-none" aria-hidden>
                {a.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{a.name}</p>
                <p className="truncate text-xs text-text-muted">{a.what}</p>
                <p className="mt-0.5 truncate text-xs text-text-muted sm:hidden">{a.access}</p>
              </div>
              <div className="hidden min-w-0 flex-col items-end gap-0.5 text-xs sm:flex">
                <span className="flex items-center gap-1.5 text-text-muted">
                  <Avatar className="!bg-surface-3 !text-text" name={a.owner?.name ?? null} size="xs" />
                  {a.owner?.name.split(' ')[0] ?? 'No owner'}
                </span>
                <span className="max-w-[11rem] truncate text-text-muted">{a.access}</span>
              </div>
              <FauxButton>
                Open app <ExternalLink className="size-3" />
              </FauxButton>
            </motion.li>
          )
        })}
      </ul>
    </Shell>
  )
}

/* ── 2 · Duplicates and quiet apps ──────────────────────────────────────────── */

const DUPLICATES = [
  { name: 'Expense bot', team: 'Finance' },
  { name: 'Receipt scanner', team: 'Ops' },
]

const ARCHIVE_AFTER_MS = 2400

function DuplicatesMock() {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const { running } = useFirstView(ref, reduced)
  const [archived, setArchived] = useState(reduced)
  const [dead] = appsNamed(['Desk booking'])

  useEffect(() => {
    if (reduced) { setArchived(true); return }
    if (!running || archived) return
    const t = window.setTimeout(() => setArchived(true), ARCHIVE_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [archived, running, reduced])

  return (
    <div ref={ref} className="space-y-3">
      <Shell>
        <div className="flex items-center justify-between gap-3 border-b border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">Two apps file expenses</p>
            <p className="text-xs text-text-muted">Same job, two teams, two repos</p>
          </div>
          <FauxButton primary>
            <GitMerge className="size-3.5" />
            Merge
          </FauxButton>
        </div>
        <motion.ul
          className="divide-y divide-border"
          initial={reduced ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, amount: 0.05 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.15, delayChildren: reduced ? 0 : 0.18 } } }}
        >
          {DUPLICATES.map((d) => {
            const [app] = appsNamed([d.name])
            return (
              <motion.li
                key={d.name}
                className="flex items-center gap-3 px-3 py-2"
                variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: reduced ? 0 : 0.26, ease: EASE } } }}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-bg text-sm leading-none" aria-hidden>
                  {app?.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{d.name}</span>
                <span className="shrink-0 text-xs text-text-muted">{d.team}</span>
                <Avatar className="!bg-surface-3 !text-text" name={app?.owner?.name ?? null} size="xs" />
              </motion.li>
            )
          })}
        </motion.ul>
      </Shell>

      {dead && (
        <Shell>
          <motion.div className="flex items-center gap-3 p-3" initial={false} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}>
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-bg text-sm leading-none" aria-hidden>
              {dead.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{dead.name}</p>
              <div className="relative h-4 text-xs text-text-muted">
                <AnimatePresence initial={false} mode="wait">
                  <motion.p
                    key={archived ? 'archived' : 'live'}
                    className="absolute inset-0 truncate"
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
                  >
                    {archived ? 'Archived' : 'No commits in 34 days · no README'}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
            <span className="relative h-7 w-[5.5rem] shrink-0">
              <AnimatePresence initial={false}>
                <motion.span
                  key={archived ? 'done' : 'cta'}
                  className="absolute inset-y-0 right-0"
                  initial={reduced ? false : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
                >
                  {archived ? (
                    <Pill tone="success" className="h-7 px-2.5">
                      <Check className="size-3.5" strokeWidth={2.5} />
                      Archived
                    </Pill>
                  ) : (
                    <FauxButton>
                      <Archive className="size-3.5" />
                      Archive
                    </FauxButton>
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
          </motion.div>
        </Shell>
      )}
    </div>
  )
}

/* ── 3 · Handover pack: sections that tick in ──────────────────────────────── */

const HANDOVER_SECTIONS = ['What it is and who uses it', 'How to run and deploy it', 'Open work: four issues, one in progress', 'Secrets and services to rotate', 'Who to ask about what']
const TICK_MS = 420

function HandoverMock() {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const [ticked, setTicked] = useState(() => (reduced ? HANDOVER_SECTIONS.length : 0))
  const [app] = appsNamed(['Driver onboarding'])
  const ready = reduced || ticked >= HANDOVER_SECTIONS.length

  useEffect(() => {
    if (reduced) {
      setTicked(HANDOVER_SECTIONS.length)
      return
    }
    if (!inView || ready) return
    const t = window.setTimeout(() => setTicked((n) => n + 1), ticked === 0 ? 700 : TICK_MS)
    return () => window.clearTimeout(t)
  }, [inView, reduced, ticked, ready])

  return (
    <Shell className="p-4">
      <div ref={ref} className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent" aria-hidden>
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">Handover pack · {app?.name ?? 'Driver onboarding'}</p>
          <p className="mt-0.5 font-mono text-xs text-text-muted">{app?.owner?.name ?? 'Jonas Weber'} left in August · written from the repo and agent notes</p>
        </div>
        <Pill tone="danger"><UserRoundPlus className="size-3" aria-hidden />Owner left</Pill>
      </div>
      <ol className="mt-4 space-y-2">
        {HANDOVER_SECTIONS.map((s, i) => {
          const done = reduced || i < ticked
          return (
            <li key={s} className="flex items-center gap-2.5 text-sm">
              <span className="relative size-5 shrink-0" aria-hidden>
                <AnimatePresence initial={false}>
                  {done ? (
                    <motion.span
                      key="done"
                      className="absolute inset-0 grid place-items-center rounded-full bg-success-soft text-success"
                      initial={reduced ? false : { scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
                    >
                      <Check className="size-3" strokeWidth={2.5} />
                    </motion.span>
                  ) : (
                    <motion.span key="todo" className="absolute inset-0 grid place-items-center text-text-muted" initial={false} exit={{ opacity: 0 }}>
                      <Circle className="size-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <motion.span className="min-w-0" initial={false} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}>
                <span className="tabular-nums text-text-muted">{i + 1}. </span>
                <span className="text-text">{s}</span>
              </motion.span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <motion.span className="text-xs text-text-muted" initial={false} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}>
          Ready to hand over
        </motion.span>
        <motion.span initial={false} animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }} transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}>
          <FauxButton primary>
            <UserRoundPlus className="size-3.5" />
            Assign a new owner
          </FauxButton>
        </motion.span>
      </div>
    </Shell>
  )
}

/* ── 4 · Health flags that pop into place ────────────────────────────────────── */

const FLAG_APPS = ['Fuel card reconciliation', 'Driver onboarding', 'Expense bot', 'Desk booking', 'Customs docs']

function RiskMock() {
  const reduced = useReducedMotion() ?? false
  const apps = appsNamed(FLAG_APPS)
  return (
    <Shell className="signal-risk-mock">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-3 px-2.5 text-xs font-medium tabular-nums text-text" aria-hidden>
          Needs attention <span className="text-text-muted">{COUNTS.attention}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted" aria-hidden>
          <Check className="size-3.5 text-success" />
          Checked on every sync
        </span>
      </div>
      <motion.ul
        className="divide-y divide-border"
        initial={reduced ? false : "hidden"}
        whileInView="show"
        viewport={{ once: true, amount: 0.05 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.15, delayChildren: reduced ? 0 : 0.18 } } }}
      >
        {apps.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 p-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-bg text-sm leading-none" aria-hidden>
                {a.emoji}
              </span>
              <span className="truncate text-sm font-medium text-text">{a.name}</span>
              <span className="ml-auto shrink-0 text-xs text-text-muted">{a.owner ? a.owner.name.split(' ')[0] : 'No owner'}</span>
            </span>
            <motion.div className="origin-left" variants={{ hidden: { opacity: 0, scale: 0.85 }, show: { opacity: 1, scale: 1, transition: { duration: reduced ? 0 : 0.18, ease: EASE } } }}>
              <SampleFlags app={a} />
            </motion.div>
          </li>
        ))}
      </motion.ul>
    </Shell>
  )
}

/* ── 5 · Status: what changed, from GitHub ───────────────────────────────── */

const ACTIVITY: { tone: string; label: string; text: string }[] = [
  { tone: 'bg-success', label: 'Commit', text: 'Route planner · delivery route exports' },
  { tone: 'bg-accent', label: 'Pull request', text: 'Dock scheduler · loading-slot conflicts' },
  { tone: 'bg-warning', label: 'Owner', text: 'Driver onboarding · owner has left' },
  { tone: 'bg-danger', label: 'Health', text: 'Fuel card reconciliation · .env committed on main' },
]

function StatusMock() {
  const reduced = useReducedMotion() ?? false
  return (
    <div className="space-y-3">
      <Shell>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-text">Portfolio activity</span>
          <span className="text-xs text-text-muted">Newest first</span>
        </div>
        <motion.ul
          className="space-y-2.5 p-3"
          initial={reduced ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, amount: 0.05 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.15, delayChildren: reduced ? 0 : 0.18 } } }}
        >
          {ACTIVITY.map((d) => (
            <motion.li key={d.label} className="flex gap-2.5" variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.26, ease: EASE } } }}>
              <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', d.tone)} aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-muted">{d.label}</p>
                <p className="text-sm text-text">{d.text}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </Shell>
    </div>
  )
}
