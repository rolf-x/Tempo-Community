// The company app directory: every app people can open, what it does, who owns it and how to get access.
import type { Member, Project } from '../types'

export const appLink = (p: Project): string | null => p.liveUrl || p.signals?.liveUrl || null

export interface DirectoryRow {
  project: Project
  link: string | null
  owner: Member | null
}

export function directoryRows(projects: Project[], members: Member[], query: string, opts: { liveOnly?: boolean } = {}): DirectoryRow[] {
  const q = query.trim().toLowerCase()
  return projects
    .filter((p) => !p.archived)
    .map((p) => ({ project: p, link: appLink(p), owner: members.find((m) => m.id === p.ownerId) ?? null }))
    .filter((r) => !opts.liveOnly || r.link)
    .filter((r) => !q || [r.project.name, r.project.appCard?.what, r.project.appCard?.who, r.owner?.name, r.project.access].some((t) => t?.toLowerCase().includes(q)))
    .sort((a, b) => Number(!!b.link) - Number(!!a.link) || a.project.name.localeCompare(b.project.name))
}
