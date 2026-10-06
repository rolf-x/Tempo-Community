// HandoverOut → clean markdown. Pure.
import type { HandoverOut } from '../schemas'

const NONE = 'None found in the repo.'
// One line per item: a line break inside a string must not start a heading or a list.
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i.replace(/\s*[\r\n]+\s*/g, ' ')}`).join('\n') : NONE)

/** The only links a handover writes: a GitHub web address with nothing in it that could close the markdown link. */
export function isEvidenceUrl(url: string): boolean {
  if (/[\s()<>[\]`]/.test(url)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && !parsed.username && !parsed.password
  } catch {
    return false
  }
}
const openWorkItem = (w: HandoverOut['openWork'][number]) => (w.evidenceUrl && isEvidenceUrl(w.evidenceUrl) ? `[${w.title.replace(/[[\]]/g, '')}](${w.evidenceUrl})` : w.title)

export function handoverMarkdown(d: HandoverOut, appName: string): string {
  const parts = [
    `# Handover: ${appName}`,
    `## Summary\n\n${d.summary.trim()}`,
    `## How to run\n\n${list(d.howToRun.map((c) => `\`${c}\``))}`,
    `## Where things are\n\n${list(d.whereThingsAre.map((w) => `\`${w.path}\`: ${w.what}`))}`,
    `## Open work\n\n${list(d.openWork.map(openWorkItem))}`,
    `## Risks\n\n${list(d.risks)}`,
    `## Contacts\n\n${list(d.contacts)}`,
    `## Unknowns\n\n${list(d.unknowns)}`,
  ]
  return parts.join('\n\n') + '\n'
}
