// Marketing-scale Portfolio proof. One sync pass on first view, then readable sample cards.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { AppWindow, Check, LayoutGrid, Settings, Users, type LucideIcon } from 'lucide-react'
import { toHash } from '../../lib/router'
import { Mark } from '../Logo'
import { StageBadge } from '../app/AppBadges'
import { Avatar, Card, EASE, Spinner, cn } from '../ui'
import { COUNTS, appsNamed, type SampleApp } from './sample'
import { SampleFlags } from './Signal'

const SHOW = ['Expense bot', 'Fuel card reconciliation', 'Driver onboarding']
const READ_MS = 1100
const GAP_MS = 300
const DONE = SHOW.length * 2

const NAV: { icon: LucideIcon; label: string; active?: boolean }[] = [
  { icon: LayoutGrid, label: 'Portfolio', active: true },
  { icon: AppWindow, label: 'App directory' },
  { icon: Users, label: 'People' },
  { icon: Settings, label: 'Settings' },
]

type CardState = 'idle' | 'reading' | 'done'

/** Card i reads at step 2i and stays written from step 2i+1. */
function stateAt(step: number, i: number): CardState {
  if (step === 2 * i) return 'reading'
  if (step > 2 * i) return 'done'
  return 'idle'
}

export function HeroPreview() {
  const reduced = useReducedMotion() ?? false
  const apps = appsNamed(SHOW)
  const [step, setStep] = useState(() => (reduced ? DONE : 0))
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.1 })

  useEffect(() => {
    if (reduced) {
      setStep(DONE)
      return
    }
    if (!seen || step >= DONE) return
    const t = window.setTimeout(() => setStep((s) => s + 1), step % 2 === 0 ? READ_MS : GAP_MS)
    return () => window.clearTimeout(t)
  }, [step, reduced, seen])

  const reading = step < DONE && step % 2 === 0 ? apps[step / 2] : null
  const filters = [
    { label: 'All', count: COUNTS.apps, selected: true },
    { label: 'Needs attention', count: COUNTS.attention },
    { label: 'Stale', count: COUNTS.stale },
    { label: 'No owner', count: COUNTS.noOwner },
  ]

  return (
    <div ref={ref} className="relative text-left">
      <p className="mb-4 text-center text-xs text-text-muted">Halden Freight · Sample data</p>

      <div role="group" aria-label="Portfolio preview with sample data" className="relative overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-lg">
        <p className="sr-only">Three sample apps from Halden Freight, synced from GitHub: Expense bot, Fuel card reconciliation and Driver onboarding. Sign in to connect your own.</p>

        {/* Title bar */}
        <div className="flex h-10 items-center gap-3 border-b border-border px-3 sm:h-11 sm:px-4">
          <span className="flex shrink-0 gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
          </span>
          <span className="hidden min-w-0 flex-1 justify-center sm:flex" aria-hidden>
            <span className="inline-flex h-6 max-w-xs items-center gap-1.5 truncate rounded-md bg-surface-2 px-2.5 text-xs text-text-muted">
              <Mark size={12} />
              Halden Freight · Sample data
            </span>
          </span>
          <span className="ml-auto flex h-5 min-w-0 items-center gap-1.5 text-xs tabular-nums text-text-muted" aria-hidden>
            {reading ? (
              <>
                <Spinner size={12} />
                <span className="truncate">Syncing {reading.repo}…</span>
              </>
            ) : (
              <>
                <Check className="size-3.5 shrink-0 text-success" />
                <span className="truncate">Synced {COUNTS.apps} apps · just now</span>
              </>
            )}
          </span>
        </div>

        <div className="flex">
          {/* Sidebar (decorative) */}
          <aside className="hidden w-36 shrink-0 flex-col gap-0.5 border-r border-border bg-bg p-2.5 xl:flex" aria-hidden>
            <div className="mb-2 flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-text">
              <span className="grid size-5 place-items-center rounded-md bg-accent-soft text-[10px] font-semibold text-accent">H</span>
              Halden Freight
            </div>
            {NAV.map(({ icon: Icon, label, active }) => (
              <span key={label} className={cn('flex h-7 items-center gap-2 rounded-md px-2 text-xs', active ? 'bg-surface-2 font-medium text-text' : 'text-text-muted')}>
                <Icon className="size-3.5" strokeWidth={2} />
                {label}
              </span>
            ))}
          </aside>

          <div className="min-w-0 flex-1 bg-bg p-3 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" aria-hidden>
              <div>
                <p className="text-xl font-medium text-text">Portfolio</p>
                <p className="text-xs tabular-nums text-text-muted">
                  {COUNTS.apps} apps · {COUNTS.attention} need attention
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {filters.map((f) => (
                  <span
                    key={f.label}
                    className={cn(
                      'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium tabular-nums',
                      f.selected ? 'bg-surface-3 text-text' : 'text-text-muted',
                    )}
                  >
                    {f.label}
                    <span className="text-text-muted">{f.count}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 grid items-start gap-3 lg:grid-cols-3">
              {apps.map((app, i) => (
                <div key={app.id} className="min-w-0">
                  <LiveCard app={app} state={stateAt(step, i)} reduced={reduced} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── A portfolio card that writes itself ───────────────────────────────────── */

function LiveCard({ app, state, reduced }: { app: SampleApp; state: CardState; reduced: boolean }) {
  const written = reduced || state === 'done'
  const pop = written ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }

  return (
    <motion.div whileHover={reduced ? undefined : { y: -2 }} transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}>
      <Card
        interactive
        bare
        className="signal-app-tile group relative flex flex-col rounded-[10px] p-4 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent"
      >
        <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1">
          <span className="row-span-2 grid size-7 shrink-0 place-items-center rounded-md bg-bg text-lg leading-none" aria-hidden>
            {app.emoji}
          </span>
          {/* Stretched link: the ::after covers the card, so one tab stop goes to sign-in. */}
          <a href={toHash({ name: 'login' })} className="min-w-0 text-sm font-semibold leading-snug text-text outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']">
            {app.name}
          </a>
          <motion.span className="col-start-3 row-start-1 shrink-0" initial={false} animate={pop} transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}>
            <StageBadge stage={app.stage} />
          </motion.span>
          <p className="col-span-2 col-start-2 min-w-0 truncate font-mono text-[11px] text-text-muted" title={app.repo}>{app.repo}</p>
        </div>

        {/* The final copy reserves exactly its own height during the read pass. */}
        <div className="relative mt-3" aria-hidden={!written}>
          <motion.p
            className="text-sm text-text-muted"
            initial={false}
            animate={{ opacity: written ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}
          >
            {app.what}
          </motion.p>
          <AnimatePresence initial={false}>
            {!written && (
              <motion.span
                key="skeleton"
                className="absolute inset-0 flex flex-col gap-2 py-1"
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.15, ease: EASE }}
              >
                <Shimmer className="h-3.5 w-full" active={state === 'reading'} />
                <Shimmer className="h-3.5 w-3/4" active={state === 'reading'} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="pt-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-muted">
            <Avatar className="!bg-surface-3 !text-text" name={app.owner?.name ?? null} size="xs" />
            <span className={cn('truncate', app.owner ? 'font-medium text-text' : 'text-text-muted')}>
              {app.owner ? app.owner.name : 'No owner'}
              {app.owner && !app.owner.active && <span className="font-normal text-text-muted"> · left</span>}
            </span>
            {app.last && (
              <span className="min-w-0 tabular-nums">
                <span className="mr-2" aria-hidden>·</span>
                <span className="whitespace-nowrap">{app.last}</span>
              </span>
            )}
          </div>

          <div className="relative mt-4">
            <SampleFlags app={app} />
          </div>

          <SyncLine state={state} />
        </div>
      </Card>
    </motion.div>
  )
}

/** Skeleton bar with a sheen that moves by position only. */
export function Shimmer({ className, active }: { className?: string; active: boolean }) {
  return <span className={cn('block rounded-sm bg-surface-2', active && 'signal-sweep', className)} />
}

function SyncLine({ state }: { state: CardState }) {
  const reduced = useReducedMotion() ?? false
  return (
    <div className="relative mt-3 h-5 text-xs" aria-hidden>
      <AnimatePresence mode="wait" initial={false}>
        {state === 'reading' && (
          <motion.span
            key="reading"
            className="absolute inset-0 flex items-center gap-1.5 text-[var(--landing-data)]"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15, ease: EASE }}
          >
            <Spinner size={12} />
            Reading repo and agent notes…
          </motion.span>
        )}
        {state === 'done' && (
          <motion.span
            key="done"
            className="absolute inset-0 flex items-center gap-1.5 text-success"
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
          >
            <Check className="size-3.5" />
            Card updated · just now
          </motion.span>
        )}
        {state === 'idle' && (
          <motion.span
            key="idle"
            className="absolute inset-0 flex items-center text-text-muted"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15, ease: EASE }}
          >
            Queued for sync
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
