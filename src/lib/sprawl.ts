// The sprawl calculator's arithmetic (landing page). Every input is the visitor's own; nothing here is a claim about
// what Tempo saves. The page labels the result as an estimate and shows these assumptions next to it.
export interface SprawlInput {
  /** Internal apps the company runs */
  apps: number
  /** Share the visitor estimates has no commits in weeks, 0–100 */
  stalePct: number
  /** Monthly hosting, database and API cost per app, in dollars */
  monthlyPerApp: number
}

export interface SprawlEstimate {
  /** Apps with no commits in weeks (rounded) */
  staleApps: number
  /** Dollars a month on those apps */
  monthly: number
  /** Dollars a year on those apps */
  yearly: number
}

export const SPRAWL_DEFAULTS: SprawlInput = { apps: 40, stalePct: 30, monthlyPerApp: 80 }

export const SPRAWL_RANGES = {
  apps: { min: 5, max: 300, step: 5 },
  stalePct: { min: 0, max: 80, step: 5 },
  monthlyPerApp: { min: 0, max: 500, step: 10 },
} as const

export function sprawlEstimate({ apps, stalePct, monthlyPerApp }: SprawlInput): SprawlEstimate {
  const staleApps = Math.round((Math.max(0, apps) * Math.min(100, Math.max(0, stalePct))) / 100)
  const monthly = staleApps * Math.max(0, monthlyPerApp)
  return { staleApps, monthly, yearly: monthly * 12 }
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export const formatMoney = (n: number): string => usd.format(Math.round(n))

/** Position of a value inside its range, 0–100, for the slider's filled track. */
export const fillPercent = (value: number, min: number, max: number): number => (max <= min ? 0 : Math.round(((value - min) / (max - min)) * 100))
