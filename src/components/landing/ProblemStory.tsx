import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CalendarDays, Check, Clock3, Compass, Copy, CreditCard, FileText, Folder, GitBranch, KeyRound, LayoutGrid,
  ReceiptText, Route, TriangleAlert, UserRoundX, type LucideIcon,
} from 'lucide-react'
import { Mark } from '../Logo'
import { cn } from '../ui'
import { PROBLEMS, PROBLEM_CLOSE, PROBLEM_TAGS } from './copy'
import { RevealWords } from './Signal'
import { COUNTS, appsNamed, type SampleApp } from './sample'

type Tone = 'risk' | 'stale' | 'ok'

const [expense, onboarding, fuel, route] = appsNamed(['Expense bot', 'Driver onboarding', 'Fuel card reconciliation', 'Route planner'])
const owner = onboarding.owner?.name ?? ''
const initials = owner.split(' ').map((part) => part[0]).join('')

/** Card tone follows the status its vignette ends on. */
const TONES: Tone[] = ['stale', 'risk', 'risk', 'ok']
const LIGHT_STEP = 500

const DUPES = [
  { team: 'Finance', repo: expense.repo },
  { team: 'Ops', repo: 'halden/ops-expense-bot' },
  { team: 'Dispatch', repo: 'halden/dispatch-expense-bot' },
]

/** The four problems, resolved: one app per row, each with its health flag and evidence. */
const ROWS: { app: SampleApp; icon: LucideIcon; tone: Tone; flagIcon: LucideIcon; label: string; evidence: string }[] = [
  { app: expense, icon: ReceiptText, tone: 'stale', flagIcon: Copy, label: 'Duplicate · 3 teams', evidence: '3 repos · Finance, Ops, Dispatch' },
  { app: onboarding, icon: Compass, tone: 'risk', flagIcon: UserRoundX, label: 'Owner left', evidence: `${owner} · left in August` },
  { app: fuel, icon: CreditCard, tone: 'risk', flagIcon: TriangleAlert, label: 'Secret file committed', evidence: '.env on main · a3f9c21 · 3 Oct' },
  { app: route, icon: Route, tone: 'ok', flagIcon: Check, label: 'Shipped this week', evidence: 'delivery route exports · this week' },
]

/** Timing for one animated part: start state, duration and delay (added to the card's own delay). */
function at(from: { o?: number; t?: string }, dur: number, delay = 0): CSSProperties {
  return { '--s-o': from.o ?? 0, '--s-t': from.t ?? 'translateY(10px)', '--dur': `${dur}ms`, '--d': `${delay}ms` } as CSSProperties
}

/**
 * Each part plays once when it scrolls into view. Only transform and opacity animate, and every final
 * frame already holds its space, so nothing shifts. Reduced motion shows the final frame straight away.
 */
export function ProblemStory() {
  const ref = useRef<HTMLDivElement>(null)
  // Part → its start delay. Cards that arrive together light one after another, LIGHT_STEP apart.
  const [seen, setSeen] = useState<Map<string, number>>(() => new Map())

  useEffect(() => {
    const elements = ref.current?.querySelectorAll<HTMLElement>('[data-story-part]')
    if (!elements) return
    const showAll = () => setSeen(new Map(Array.from(elements, (el) => [el.dataset.storyPart!, 0])))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches || !('IntersectionObserver' in window)) { showAll(); return }
    const observer = new IntersectionObserver((entries) => {
      const keys = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => { observer.unobserve(entry.target); return (entry.target as HTMLElement).dataset.storyPart! })
        .sort()
      if (!keys.length) return
      setSeen((previous) => {
        const next = new Map(previous)
        let card = 0
        for (const key of keys) next.set(key, /^\d$/.test(key) ? LIGHT_STEP * card++ : 0)
        return next
      })
    }, { threshold: 0.3 })
    elements.forEach((el) => observer.observe(el))
    const onPreference = () => {
      if (reduced.matches) { observer.disconnect(); showAll() }
    }
    reduced.addEventListener('change', onPreference)
    return () => { observer.disconnect(); reduced.removeEventListener('change', onPreference) }
  }, [])

  const is = (key: string) => seen.has(key)

  return (
    <div ref={ref} className="signal-story" data-lit={seen.size > 0}>
      <ul className="signal-problem-grid">
        {PROBLEMS.map((line, i) => (
          <li
            key={line}
            data-story-part={String(i)}
            data-seen={is(String(i))}
            data-tone={TONES[i]}
            data-spot=""
            className="signal-problem-card"
            style={{ '--story-delay': `${seen.get(String(i)) ?? 0}ms` } as CSSProperties}
          >
            <span className="signal-problem-lamp" aria-hidden="true" />
            <div className="signal-problem-text"><span className="signal-problem-tag">{PROBLEM_TAGS[i]}</span><p className="signal-problem-line">{line}</p></div>
            <div className="signal-vignette" aria-hidden="true">
              <span className="signal-stage-glow p-anim" style={at({ o: 0, t: 'scale(.8)' }, 1400, i === 3 ? 600 : 650)} />
              {i === 0 && <Duplicates />}
              {i === 1 && <DepartedOwner />}
              {i === 2 && <ExposedFile />}
              {i === 3 && <Meeting />}
            </div>
          </li>
        ))}
      </ul>
      <p className="signal-problem-caption">Halden Freight · Sample data</p>

      <div className="signal-problem-close p-anim" data-story-part="close" data-seen={is('close')} style={at({ o: 0, t: 'translateY(18px)' }, 1000)}>
        <p>
          <span className="signal-close-a">{PROBLEM_CLOSE[0]}</span>{' '}
          <span className="signal-close-b"><RevealWords text={PROBLEM_CLOSE[1]} offset={2} /></span>
        </p>
      </div>

      <div
        className="signal-plist p-anim"
        data-story-part="list"
        data-seen={is('list')}
        role="group"
        aria-label="Portfolio, Halden Freight sample data"
        style={at({ o: 0, t: 'translateY(24px)' }, 800, 250)}
      >
        <div className="signal-plist-head">
          <Mark size={20} tick={false} />
          <span className="signal-plist-title">Portfolio</span>
          <span className="signal-plist-count">{ROWS.length} of {COUNTS.apps} apps</span>
          <span className="signal-plist-sample">Halden Freight · Sample data</span>
        </div>
        <ul>
          {ROWS.map(({ app, icon: Icon, tone, flagIcon, label, evidence }, i) => (
            <li key={app.id} className="signal-prow p-anim" style={at({ o: 0, t: `translateY(${-24 - i * 12}px) scale(.98)` }, 900, 550 + i * 130)}>
              <span className="signal-prow-glyph" aria-hidden="true"><Icon /></span>
              <span className="signal-prow-app">
                <span className="signal-prow-name">{app.name}</span>
                <span className="signal-prow-repo">{app.repo}</span>
              </span>
              <Flag tone={tone} icon={flagIcon} label={label} evidence={evidence} className="p-anim" style={at({ o: 0, t: 'translateY(6px) scale(.96)' }, 600, 1000 + i * 130)} />
              <span className="signal-prow-last">{app.last}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Flag({ tone, icon, label, evidence, className, style }: { tone: Tone; icon?: LucideIcon; label: string; evidence?: string; className?: string; style?: CSSProperties }) {
  const Icon = icon ?? (tone === 'risk' ? TriangleAlert : tone === 'stale' ? Clock3 : Check)
  return (
    <span className={cn('signal-pflag', className)} data-tone={tone} style={style}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      {evidence && <span className="signal-pflag-evidence">{evidence}</span>}
    </span>
  )
}

function Mock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('signal-mock', className)}>{children}</div>
}

/** Three copies of one tool drift in from three teams and settle into a single stack. */
function Duplicates() {
  const from = ['translate(-46px, -34px) rotate(-7deg)', 'translate(64px, -18px) rotate(6deg)', 'translate(-58px, 30px) rotate(-4deg)']
  return (
    <div className="signal-scene signal-dupes">
      <div className="signal-dupe-stack">
        {DUPES.map((dupe, i) => (
          <div key={dupe.team} className="signal-dupe p-anim" style={{ ...at({ o: 1, t: from[i] }, 1100, i * 70), '--i': i } as CSSProperties}>
            <ReceiptText className="signal-dupe-icon" />
            <span className="signal-dupe-name">Expense bot</span>
            <span className="signal-dupe-team">{dupe.team}</span>
            <span className="signal-dupe-repo">{dupe.repo}</span>
          </div>
        ))}
      </div>
      <Flag tone="stale" icon={Copy} label="Duplicate · 3 teams" evidence="3 repos · same job" className="p-anim" style={at({ o: 0, t: 'translateY(12px) scale(.94)' }, 700, 800)} />
    </div>
  )
}

/** The owner's avatar empties out, the name is struck through, and the flags land. */
function DepartedOwner() {
  return (
    <Mock>
      <div className="signal-mock-head">
        <span className="signal-mock-glyph"><Compass /></span>
        <span className="signal-mock-title">{onboarding.name}</span>
        <GitBranch className="signal-mock-meta" />
      </div>
      <div className="signal-kv">
        <div className="signal-owner">
          <span className="signal-owner-label">Owner</span>
          <span className="signal-avatar">
            <span className="signal-avatar-fill p-anim" style={at({ o: 1, t: 'none' }, 700, 150)}>{initials}</span>
          </span>
          <span className="signal-owner-name">
            {owner}
            <span className="signal-strike p-anim" style={at({ o: 1, t: 'scaleX(0)' }, 600, 450)} />
          </span>
        </div>
        <div className="signal-owner">
          <span className="signal-owner-label">How to run</span>
          <span className="signal-owner-none">No handover</span>
        </div>
      </div>
      <div className="signal-mock-flags">
        <Flag tone="risk" icon={UserRoundX} label="Owner left" evidence={`${owner} · left in August`} className="p-anim" style={at({ o: 0, t: 'translateY(12px) scale(.94)' }, 700, 650)} />
        <Flag tone="stale" label={onboarding.flags[1]?.label ?? 'No commits in 21 days'} className="p-anim" style={at({ o: 0, t: 'translateY(12px) scale(.94)' }, 700, 850)} />
      </div>
    </Mock>
  )
}

/** A read sweeps the repo, the .env row lights up, and the flag lands. */
function ExposedFile() {
  const files: { name: string; icon: LucideIcon }[] = [
    { name: 'src', icon: Folder },
    { name: 'README.md', icon: FileText },
    { name: 'package.json', icon: FileText },
  ]
  return (
    <Mock>
      <div className="signal-mock-head">
        <GitBranch className="signal-mock-meta" />
        <span className="signal-mock-title signal-mono">{fuel.repo}</span>
        <span className="signal-branch">main</span>
      </div>
      <div className="signal-files">
        <ul>
          {files.map(({ name, icon: Icon }) => (
            <li key={name}><Icon />{name}</li>
          ))}
          <li className="signal-env">
            <KeyRound />.env<span className="signal-env-meta">a3f9c21</span>
            <span className="signal-env-hit p-anim" style={at({ o: 0, t: 'none' }, 500, 650)}>
              <KeyRound />.env<span className="signal-env-meta">a3f9c21</span>
            </span>
          </li>
        </ul>
        <span className="signal-scan" />
      </div>
      <Flag tone="risk" label="Secret file committed" evidence=".env on main · a3f9c21 · 3 Oct" className="p-anim" style={at({ o: 0, t: 'translateY(12px) scale(.94)' }, 700, 800)} />
    </Mock>
  )
}

/** The weekly status meeting leaves its slot, and the portfolio snapshot takes it. */
function Meeting() {
  return (
    <Mock>
      <div className="signal-mock-head">
        <CalendarDays className="signal-mock-meta" />
        <span className="signal-mock-title">Friday</span>
        <span className="signal-mock-aside">This week</span>
      </div>
      <div className="signal-day">
        {['10:00', '10:30', '11:00', '11:30'].map((time) => (
          <div key={time} className="signal-hour"><span>{time}</span></div>
        ))}
        <div className="signal-slot signal-meeting p-anim" style={at({ o: 1, t: 'none' }, 700, 250)}>
          <span className="signal-meeting-title">What shipped this week?</span>
          <span className="signal-meeting-meta">
            <span className="signal-faces">{[0, 1, 2, 3, 4].map((n) => <span key={n} />)}</span>
            8 people · 1 h
          </span>
        </div>
        <div className="signal-slot signal-portfolio-slot p-anim" style={at({ o: 0, t: 'translateX(16px)' }, 800, 600)}>
          <span className="signal-portfolio-head"><LayoutGrid />Portfolio<Flag tone="ok" label="Changed" /></span>
          <span className="signal-portfolio-line">{route.name} · delivery route exports</span>
          <span className="signal-portfolio-line">{fuel.name} · fuel charge matching</span>
        </div>
      </div>
    </Mock>
  )
}
