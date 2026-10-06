// Classic landing: hero, numbers, problem, benefits, setup, calculator, questions and closing.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowRight, Check } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useSession } from '../data/session'
import { toHash } from '../lib/router'
import { canEnterApp } from '../lib/entry'
import { Mark, Wordmark } from '../components/Logo'
import { HeroPreview, Shimmer } from '../components/landing/HeroPreview'
import { Pillars } from '../components/landing/Pillars'
import { ClassicCalculator } from '../components/landing/Calculator'
import { HERO_BODY, HOW_TITLE, LATER_STEPS, MICROLINE, NUMBERS, QUESTIONS, STEPS, WHAT_YOU_GET } from '../components/landing/copy'
import { ProblemStory } from '../components/landing/ProblemStory'
import { appsNamed } from '../components/landing/sample'
import { ProviderMark, SignInButtons } from '../components/landing/SignIn'
import { ThemeSwitch } from '../components/landing/ThemeSwitch'
import { EASE, cn } from '../components/ui'
import { CountUp, HeartbeatLine, RevealWords, useSignalReveal, useSpotlight } from '../components/landing/Signal'
import '../components/landing/signal.css'

/** Scroll to a section and hand it focus. A button, not a #anchor: the router reads hash changes as routes. */
function jumpTo(id: string, reduced: boolean) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}

export default function LandingView() {
  const settings = useStore((s) => s.settings)
  const status = useSession((s) => s.status)
  const signedIn = status === 'signed-in'
  const entered = canEnterApp({ ...settings, status })
  const reduced = useReducedMotion() ?? false
  const reveal = useSignalReveal()
  const mainRef = useRef<HTMLElement>(null)
  useSpotlight()

  return (
    <div className="signal-landing min-h-dvh bg-bg text-text">
      <button
        type="button"
        onClick={() => mainRef.current?.focus()}
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md"
      >
        Skip to content
      </button>

      <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-md">
        <Wrap className="flex h-14 items-center justify-between gap-4">
          <a href={toHash({ name: 'welcome' })} className="focus-ring rounded-md" aria-label="Tempo home">
            <Wordmark />
          </a>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Page">
            <JumpButton to="what-you-get" reduced={reduced} className="max-sm:hidden">
              What you get
            </JumpButton>
            <JumpButton to="how-it-works" reduced={reduced} className="max-sm:hidden">
              How it works
            </JumpButton>
            <JumpButton to="questions" reduced={reduced} className="max-sm:hidden">
              Questions
            </JumpButton>
            <ThemeSwitch />
            {!signedIn && (
              <LinkButton href={toHash({ name: 'login' })} variant={entered ? 'ghost' : 'secondary'} className="ml-1">
                Sign in
              </LinkButton>
            )}
            {entered && (
              <LinkButton href={toHash({ name: 'portfolio' })} variant="secondary">
                Open Tempo <ArrowRight className="size-4" aria-hidden />
              </LinkButton>
            )}
          </nav>
        </Wrap>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="signal-hero relative isolate overflow-hidden pb-9 pt-[72px] sm:pb-12 sm:pt-[88px]">
          <Wrap className="text-center">
            <motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.26, ease: EASE }} className="mx-auto max-w-4xl">
              <h1 id="hero-title" className="text-[40px] font-semibold leading-[1.1] tracking-normal text-text sm:text-[56px] lg:text-[64px]">
                Know every app your company vibe-coded.
              </h1>
              <p className="mx-auto mt-5 max-w-[58ch] text-[18px] leading-[1.6] text-text-muted">
                {HERO_BODY}
              </p>
              <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <SignInButtons size="lg" primaryGithub align="center" />
                <JumpButton to="how-it-works" reduced={reduced} variant="secondary" className="h-11 px-5 text-[0.9375rem]">
                  See how it works <ArrowDown className="size-4" aria-hidden />
                </JumpButton>
              </div>
              <p className="mt-5 text-xs text-text-muted">{MICROLINE}</p>
            </motion.div>

            <HeartbeatLine />
            <motion.div {...reveal(0.15)}>
              <HeroPreview />
            </motion.div>
          </Wrap>
        </section>

        <Section id="numbers" labelledBy="numbers-title" border>
          <h2 id="numbers-title" className="sr-only">Tempo in four numbers</h2>
          <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {NUMBERS.map((n, i) => (
              <motion.li key={n.text} {...reveal(i * 0.06)} className="signal-stat min-w-0 lg:px-7 lg:first:pl-0 lg:last:pr-0 lg:[&+li]:border-l lg:[&+li]:border-border">
                <p className="signal-number whitespace-nowrap text-[42px] font-semibold leading-[1.1] text-text xl:text-[48px]"><CountUp value={n.big} /></p>
                <p className="mt-3 text-[16px] leading-[1.6] text-text-muted">{n.text}</p>
              </motion.li>
            ))}
          </ul>
        </Section>

        <Section id="problem" labelledBy="problem-title" border>
          <motion.div {...reveal()} className="signal-problem-heading">
            <Eyebrow>The problem</Eyebrow>
            <h2 id="problem-title" className="signal-problem-title">
              <span className="text-text-muted"><RevealWords text="Building apps got easy." /></span> <span><RevealWords text={"Keeping track didn't."} offset={4} /></span>
            </h2>
          </motion.div>
          <ProblemStory />
        </Section>

        {/* The five selling points */}
        <Section id="what-you-get" labelledBy="what-title" border>
          <motion.div {...reveal()}>
            <SectionTitle
              id="what-title"
              eyebrow="What you get"
              title={WHAT_YOU_GET.title}
              body={WHAT_YOU_GET.body}
            />
          </motion.div>
          <div className="mt-12 sm:mt-16">
            <Pillars />
          </div>
        </Section>

        {/* How it works */}
        <Section id="how-it-works" labelledBy="how-title" border>
          <motion.div {...reveal()}>
            <SectionTitle id="how-title" eyebrow="How it works" title={HOW_TITLE} />
          </motion.div>
          <ol className="mt-12 grid gap-8 lg:grid-cols-3 lg:gap-6">
            {STEPS.map((s, i) => (
              <motion.li key={s.title} {...reveal(i * 0.08)} className="flex min-w-0 flex-col">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border-strong bg-surface text-sm font-medium tabular-nums text-text">{i + 1}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </div>
                <h3 className="mt-5 text-[18px] leading-[1.6] font-semibold text-text">{s.title}</h3>
                <p className="mb-5 mt-2 text-[16px] leading-[1.6] text-text-muted">{s.body}</p>
                <div className="mt-auto rounded-2xl border border-border bg-surface-2 p-4">
                  <StepVisual step={i} reduced={reduced} />
                  <p className="mt-3 text-center text-xs text-text-muted">Halden Freight · Sample data</p>
                </div>
              </motion.li>
            ))}
          </ol>
          <motion.div {...reveal(0.1)} className="signal-later mt-12">
            <p className="text-sm font-medium text-text-muted">Then, when you're ready</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {LATER_STEPS.map((s) => (
                <li key={s.title} className="signal-later-step">
                  <p className="font-medium text-text">{s.title}</p>
                  <p className="mt-1 text-sm leading-[1.55] text-text-muted">{s.body}</p>
                </li>
              ))}
            </ul>
          </motion.div>
        </Section>

        <Section id="cost" labelledBy="cost-title" border>
          <motion.div {...reveal()}>
            <SectionTitle id="cost-title" eyebrow="Your numbers" title="What forgotten apps cost you." />
            <ClassicCalculator />
          </motion.div>
        </Section>

        <Section id="questions" labelledBy="questions-title" border>
          <motion.div {...reveal()}>
            <SectionTitle id="questions-title" eyebrow="Questions" title="Before you connect GitHub." />
            <dl className="mt-10 max-w-3xl divide-y divide-border">
              {QUESTIONS.map((q) => (
                <div key={q.question} className="py-6">
                  <dt className="text-[18px] leading-[1.6] font-semibold text-text">{q.question}</dt>
                  <dd className="mt-2 text-[16px] leading-[1.6] text-text-muted">{q.answer}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </Section>

        {/* Closing */}
        <section aria-labelledby="close-title" className="signal-section relative isolate overflow-clip border-t border-border pb-[72px] pt-9 sm:pb-24 sm:pt-12">
          <Wrap className="text-center">
            <motion.div {...reveal()} className="mx-auto max-w-2xl">
              <Mark size={40} className="mx-auto" />
              <h2 id="close-title" className="mt-6 text-4xl font-medium tracking-[0.2px] text-text sm:text-[56px] sm:leading-[1.17]">
                <RevealWords text="Find the apps nobody owns." />
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-[18px] leading-[1.6] text-text-muted">{MICROLINE}</p>
              <div className="mt-8">
                <SignInButtons size="lg" primaryGithub align="center" />
              </div>
            </motion.div>
          </Wrap>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <Wrap className="flex flex-col gap-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Mark size={16} />
            <span>© 2026 Tempo</span>
          </div>
          <nav className="flex flex-wrap items-center gap-4" aria-label="Footer">
            <JumpButton to="what-you-get" reduced={reduced}>What you get</JumpButton>
            <JumpButton to="how-it-works" reduced={reduced}>How it works</JumpButton>
            <JumpButton to="questions" reduced={reduced}>Questions</JumpButton>
            <a href={toHash({ name: 'privacy' })} className="focus-ring rounded-sm transition-colors duration-150 hover:text-text">
              Privacy
            </a>
            <a href={toHash({ name: signedIn ? 'portfolio' : 'login' })} className="focus-ring rounded-sm transition-colors duration-150 hover:text-text">
              {signedIn ? 'Open Tempo' : 'Sign in'}
            </a>
          </nav>
        </Wrap>
      </footer>
    </div>
  )
}

/* ── Layout helpers ────────────────────────────────────────────────────────── */

function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1120px] px-4 sm:px-8', className)}>{children}</div>
}

/** A page section that can take focus after an in-page jump; `scroll-mt` clears the sticky header. */
function Section({ id, labelledBy, border, children }: { id: string; labelledBy: string; border?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} tabIndex={-1} className={cn('signal-section relative isolate overflow-clip scroll-mt-14 py-9 outline-none sm:py-12', border && 'border-t border-border')}>
      <Wrap>{children}</Wrap>
    </section>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-2 font-mono text-xs font-medium tracking-[0.4px] text-text-muted before:size-1.5 before:rounded-[2px] before:bg-accent">{children}</p>
}

function SectionTitle({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="mt-3 text-2xl font-medium leading-[1.25] tracking-[0.2px] text-text [text-wrap:balance] sm:text-[32px]">
        <RevealWords text={title} />
      </h2>
      {body && <p className="mt-3 text-[16px] leading-[1.6] text-text-muted sm:text-[18px] leading-[1.6]">{body}</p>}
    </div>
  )
}

/* ── How it works: one small visual per step ───────────────────────────────── */

const REPOS = [
  { name: 'halden/dock-scheduler', pushed: 'now', on: true },
  { name: 'halden/route-planner', pushed: '40 min ago', on: true },
  { name: 'halden/fuel-card-reconciliation', pushed: '3 Oct', on: true },
  { name: 'halden/desk-booking', pushed: '34 d ago', on: false },
]

function StepVisual({ step, reduced }: { step: number; reduced: boolean }) {
  if (step === 0) return <ConnectVisual />
  if (step === 1) return <RepoPickVisual reduced={reduced} />
  return <CardWriteVisual reduced={reduced} />
}

function ConnectVisual() {
  return (
    <div className="flex h-[9.5rem] flex-col items-center justify-center gap-3" aria-hidden>
      <span className="inline-flex h-10 items-center gap-2 signal-pill rounded-full px-4 text-sm font-medium">
        <ProviderMark provider="github" className="size-4" />
        Sign in with GitHub
      </span>
      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-success-soft px-2 text-xs font-medium text-success">
        <Check className="size-3" strokeWidth={2.5} />
        Read-only
      </span>
    </div>
  )
}

/** The repo checklist: ticks arrive one after another while it's on screen. */
function RepoPickVisual({ reduced }: { reduced: boolean }) {
  return (
    <motion.ul
      className="flex h-[9.5rem] flex-col justify-center gap-1.5"
      aria-hidden
      initial={reduced ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, amount: 0.05 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.18, delayChildren: reduced ? 0 : 0.18 } } }}
    >
      {REPOS.map((r) => (
        <li key={r.name} className="flex h-7 items-center gap-2.5 rounded-md bg-surface px-2.5 text-xs shadow-xs">
          <span className={cn('relative grid size-4 shrink-0 place-items-center rounded-full border', r.on ? 'border-border-strong bg-surface-3 text-text' : 'border-border-strong')}>
            {r.on && (
              <motion.span className="grid place-items-center" variants={{ hidden: { opacity: 0, scale: 0.4 }, show: { opacity: 1, scale: 1, transition: { duration: reduced ? 0 : 0.18, ease: EASE } } }}>
                <Check className="size-2.5" strokeWidth={3} />
              </motion.span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono font-medium text-text">{r.name}</span>
          <span className="shrink-0 tabular-nums text-text-muted">{r.pushed}</span>
        </li>
      ))}
    </motion.ul>
  )
}

const WRITE_READ_MS = 1500

/** The draft resolves once on first view, then remains readable. */
function CardWriteVisual({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const [written, setWritten] = useState(reduced)
  const [app] = appsNamed(['Route planner'])

  useEffect(() => {
    if (reduced) {
      setWritten(true)
      return
    }
    if (!inView || written) return
    const t = window.setTimeout(() => setWritten(true), WRITE_READ_MS)
    return () => window.clearTimeout(t)
  }, [inView, reduced, written])

  return (
    <div ref={ref} className="flex h-[9.5rem] flex-col justify-center" aria-hidden>
      <div className="rounded-lg border border-border bg-surface p-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-bg text-sm leading-none">{app.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{app.name}</span>
          <motion.span
            className="inline-flex h-5 items-center gap-1 rounded-full bg-success-soft px-2 text-xs font-medium text-success"
            initial={false}
            animate={written ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
          >
            Live
          </motion.span>
        </div>
        <div className="relative mt-2.5 min-h-12">
          <motion.p className="absolute inset-0 text-xs text-text-muted" initial={false} animate={{ opacity: written ? 1 : 0, y: written ? 0 : 4 }} transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}>
            {app.what}
          </motion.p>
          <motion.span className="absolute inset-0 flex flex-col justify-between py-0.5" initial={false} animate={{ opacity: written ? 0 : 1 }} transition={{ duration: reduced ? 0 : 0.15, ease: EASE }}>
            <Shimmer className="h-3 w-full" active={!written} />
            <Shimmer className="h-3 w-2/3" active={!written} />
          </motion.span>
        </div>
        <div className="mt-2.5 flex min-h-4 flex-wrap items-center gap-1.5 text-xs">
          <motion.span className="flex items-center gap-1.5 text-success" initial={false} animate={{ opacity: written ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}>
            <Check className="size-3.5" />
            Owner: {app.owner?.name} · Card updated
          </motion.span>
        </div>
      </div>
    </div>
  )
}

/* ── Buttons ───────────────────────────────────────────────────────────────── */

const BUTTON = 'focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-[background-color,border-color,color] duration-150'
const VARIANT = {
  ghost: 'text-text-muted hover:bg-surface-2 hover:text-text',
  secondary: 'signal-ghost border border-border-strong bg-transparent text-text',
  primary: 'signal-pill',
} as const

/** A real link drawn like a Button (hash routes stay real links). */
function LinkButton({ href, variant, className, children }: { href: string; variant: keyof typeof VARIANT; className?: string; children: ReactNode }) {
  return (
    <a href={href} data-spot={variant === 'secondary' ? '' : undefined} className={cn(BUTTON, VARIANT[variant], className)}>
      {children}
    </a>
  )
}

/** In-page jump drawn like a Button. */
function JumpButton({ to, reduced, variant = 'ghost', className, children }: { to: string; reduced: boolean; variant?: keyof typeof VARIANT; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => jumpTo(to, reduced)} data-spot={variant === 'secondary' ? '' : undefined} className={cn(BUTTON, VARIANT[variant], className)}>
      {children}
    </button>
  )
}
