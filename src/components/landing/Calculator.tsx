import { useState } from 'react'
import { SPRAWL_DEFAULTS, SPRAWL_RANGES, formatMoney, sprawlEstimate, type SprawlInput } from '../../lib/sprawl'
import { COST_INTRO, COST_NOTE } from './copy'
import { SignInButtons } from './SignIn'

const FIELDS: { key: keyof SprawlInput; label: string; format: (n: number) => string }[] = [
  { key: 'apps', label: 'Apps your company runs', format: (n) => `${n}` },
  { key: 'stalePct', label: 'Share that has gone quiet (no commits in weeks)', format: (n) => `${n}%` },
  { key: 'monthlyPerApp', label: 'Cost per app, per month', format: formatMoney },
]

export function ClassicCalculator() {
  const [input, setInput] = useState<SprawlInput>(SPRAWL_DEFAULTS)
  const estimate = sprawlEstimate(input)
  return (
    <>
      <p className="mt-3 text-[16px] leading-[1.6] text-text-muted sm:text-[18px] leading-[1.6]">{COST_INTRO}</p>
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6 rounded-2xl border border-border bg-surface p-5 sm:p-8">
          {FIELDS.map((f) => {
            const id = `cost-${f.key}`
            return (
              <div key={f.key}>
                <div className="flex items-baseline justify-between gap-4">
                  <label htmlFor={id} className="text-sm font-medium text-text">{f.label}</label>
                  <output htmlFor={id} className="shrink-0 text-[18px] leading-[1.6] font-semibold tabular-nums">{f.format(input[f.key])}</output>
                </div>
                <input id={id} type="range" {...SPRAWL_RANGES[f.key]} value={input[f.key]} aria-valuetext={f.format(input[f.key])}
                  onChange={(e) => setInput((s) => ({ ...s, [f.key]: Number(e.target.value) }))}
                  className="focus-ring mt-4 w-full accent-[var(--t-accent)]" />
              </div>
            )
          })}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-8">
          <p className="text-sm text-text-muted">Estimate from your figures</p>
          <p className="mt-3 signal-number text-[44px] font-semibold leading-tight text-text tabular-nums" aria-live="polite" aria-atomic="true">
            {formatMoney(estimate.yearly)} <span className="text-[18px] leading-[1.6] text-text">a year</span>
          </p>
          <p className="mt-2 text-[18px] leading-[1.6] text-text">on apps that have gone quiet.</p>
          <p className="mt-5 text-sm text-text-muted">{COST_NOTE}</p>
          <SignInButtons primaryGithub label="Find yours free" className="mt-6" />
        </div>
      </div>
    </>
  )
}
