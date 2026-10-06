// Date helpers. Due dates are local `YYYY-MM-DD` strings; all math goes through UTC noon to dodge DST.
const DAY = 86_400_000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')
const toUTC = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12)
}
const fromUTC = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isValidISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return fromUTC(toUTC(s)) === s
}

export const addDays = (iso: string, n: number) => fromUTC(toUTC(iso) + n * DAY)
export const daysBetween = (from: string, to: string) => Math.round((toUTC(to) - toUTC(from)) / DAY)
export const weekdayName = (iso: string) => WEEKDAYS[new Date(toUTC(iso)).getUTCDay()]
export const dayOfMonth = (iso: string) => Number(iso.slice(8, 10))
export const monthShort = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]
export const formatShort = (iso: string) => `${dayOfMonth(iso)} ${monthShort(iso)}`
export const formatCalendarDate = (iso: string) => `${formatShort(iso.slice(0, 10))} ${iso.slice(0, 4)}`

/** Monday-first grid of ISO dates covering the month of `iso`, in full weeks (4–6 rows). */
export function monthGrid(iso: string): string[] {
  const first = `${iso.slice(0, 7)}-01`
  const last = addDays(addDays(first, 32).slice(0, 7) + '-01', -1)
  const start = addDays(first, -((new Date(toUTC(first)).getUTCDay() + 6) % 7))
  const end = addDays(last, (7 - new Date(toUTC(last)).getUTCDay()) % 7)
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}
