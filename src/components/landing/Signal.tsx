import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'
import { Clock3, TriangleAlert } from 'lucide-react'
import { cn, EASE } from '../ui'
import type { SampleApp } from './sample'

export function useSignalReveal() {
  const reduced = useReducedMotion() ?? false
  return (delay = 0) => ({
    initial: reduced ? false as const : { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.05 },
    transition: { duration: reduced ? 0 : 0.26, ease: EASE, delay: reduced ? 0 : delay },
  })
}

// Four identical beats across the full width.
const HEARTBEAT_TRACE = (() => {
  let d = 'M0 60', x = 0
  while (x < 1000) {
    d += ' L' + (x + 70) + ' 60 Q' + (x + 82) + ' 50 ' + (x + 94) + ' 60 L' + (x + 112) + ' 60 L' + (x + 118) + ' 68 L' + (x + 128) + ' 14 L' + (x + 138) + ' 104 L' + (x + 146) + ' 60 L' + (x + 168) + ' 60 Q' + (x + 186) + ' 40 ' + (x + 204) + ' 60 L' + (x + 250) + ' 60'
    x += 250
  }
  return d
})()

export function HeartbeatLine() {
  const gradient = useId()
  return (
    <svg className="signal-ecg" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={gradient} x1="0" x2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--data)" /></linearGradient></defs>
      <path className="signal-ecg-base" d={HEARTBEAT_TRACE} />
      <path className="signal-ecg-beat" d={HEARTBEAT_TRACE} pathLength={1000} stroke={`url(#${gradient})`} />
    </svg>
  )
}

/** A heading that rises and comes into focus word by word, once, when it scrolls into view (brand v2.1).
 * The words stay real text separated by spaces, so screen readers read the line as written. */
export function RevealWords({ text, offset = 0 }: { text: string; offset?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.6 })
  const words = text.split(' ')
  return (
    <span ref={ref} className="signal-words" data-in={seen}>
      {words.map((word, i) => (
        <Fragment key={i}>
          <span className="signal-word" style={{ '--i': i + offset } as CSSProperties}>{word}</span>
          {i < words.length - 1 && ' '}
        </Fragment>
      ))}
    </span>
  )
}

/** Cursor light for buttons and cards marked `data-spot`: sets --mx/--my on the element under the pointer. */
export function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return
    let current: HTMLElement | null = null
    const clear = () => {
      current?.style.removeProperty('--mx')
      current?.style.removeProperty('--my')
      current = null
    }
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.signal-landing [data-spot]') ?? null
      if (el !== current) clear()
      if (!el) return
      current = el
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', clear)
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', clear); clear() }
  }, [])
}

/** Zero claims stay zero; only the non-zero figure counts up. The accessible value is always final. */
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.5 })
  const reduced = useReducedMotion() ?? false
  const target = Number(value.match(/\d+/)?.[0] ?? 0)
  const [count, setCount] = useState(target)
  const played = useRef(false)
  useEffect(() => {
    if (reduced) { setCount(target); return }
    if (!seen || played.current || target === 0) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 900, 1)
      setCount(Math.floor(target * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else played.current = true
    }
    setCount(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [seen, reduced, target])
  return <span ref={ref}><span className="sr-only">{value}</span><span aria-hidden="true">{value.replace(/\d+/, String(reduced ? target : count))}</span></span>
}

/** Keep the sample's existing labels; make their supporting repo evidence visible, never tooltip-only. */
export function SampleFlags({ app }: { app: SampleApp }) {
  return <div className="flex flex-col gap-2">
    {app.flags.map((flag) => {
      const risk = flag.severity === 'high'
      const Icon = risk ? TriangleAlert : Clock3
      return <div key={flag.kind} className={cn('signal-flag rounded-lg px-2.5 py-2', risk ? 'text-danger' : 'text-warning')}>
        <span className="flex items-start gap-1.5 text-xs font-medium leading-normal"><Icon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />{flag.label}</span>
        {/* Wrap only at the separators, never inside "21 d ago" or a name. */}
        <span className="mt-1 block font-mono text-[11px] leading-relaxed text-text-muted">
          {[app.repo, flag.kind === 'owner-left' ? app.owner?.name : app.last].map((segment, i) => <Fragment key={i}>
            {i > 0 && ' · '}
            <span className="whitespace-nowrap">{segment}</span>
          </Fragment>)}
        </span>
      </div>
    })}
  </div>
}
