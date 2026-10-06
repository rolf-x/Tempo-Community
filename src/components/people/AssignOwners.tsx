// The "Assign owners" window (the next-step bar and the setup checklist open it): every app in the workspace with no
// owner, or whose owner left, one row each. The list is fixed when the window opens, so an app that gets an owner stays
// in it, with a check, until the window closes. It is not limited by the portfolio's My apps / Team's apps scope.
import { useMemo, useState, type MouseEvent } from 'react'
import { Check, CircleCheck } from 'lucide-react'
import { health } from '../../ai/tools/health'
import { suggestionSinceLabel, type OwnerSuggestion } from '../../ai/tools/matchMember'
import { changeProjectOwner } from '../../data/workspace'
import { isPersonal } from '../../lib/model'
import { toHash } from '../../lib/router'
import { useStore } from '../../store/useStore'
import type { Member, Project } from '../../types'
import { useUI } from '../uiState'
import { AppIcon, Button, Modal, cn } from '../ui'
import { MemberPicker } from './MemberPicker'
import { useOwnerSuggestions } from './useOwnerSuggestions'

const needsOwner = (project: Project, members: Member[], personal: boolean, now: Date) =>
  health(project, members, now, { personal, keptAt: project.keptAt }).some((flag) => flag.kind === 'no-owner' || flag.kind === 'owner-left')

/** The apps that need an owner now: none, or one who left. Archived apps are left out. A–Z. */
export function appsNeedingOwner(projects: Project[], members: Member[], personal: boolean, now = new Date()): Project[] {
  return projects
    .filter((project) => !project.archived && needsOwner(project, members, personal, now))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface OwnerRowData {
  project: Project
  owner: Member | null
  /** An owner has been picked since the window opened: the row shows who, with a check. */
  assigned: boolean
  suggestion: OwnerSuggestion | null
}

/** The rows for the apps listed when the window opened, read fresh so a new owner shows at once. */
export function ownerRows(
  ids: string[],
  projects: Project[],
  members: Member[],
  personal: boolean,
  suggestions: Record<string, OwnerSuggestion | null> = {},
  now = new Date(),
): OwnerRowData[] {
  return ids.flatMap((id) => {
    const project = projects.find((item) => item.id === id)
    if (!project || project.archived) return []
    const owner = members.find((member) => member.id === project.ownerId) ?? null
    const assigned = !!project.ownerId && !needsOwner(project, members, personal, now)
    return [{ project, owner, assigned, suggestion: assigned ? null : suggestions[id] ?? null }]
  })
}

const plural = (count: number) => `${count} ${count === 1 ? 'app' : 'apps'}`

/** The line under the title: how many are left. */
export function summaryLine(rows: OwnerRowData[]): string | null {
  if (!rows.length) return null
  const left = rows.filter((row) => !row.assigned).length
  return left ? `${left} of ${plural(rows.length)} still ${left === 1 ? 'needs' : 'need'} an owner.` : 'Every app has an owner.'
}

function RowStatus({ row }: { row: OwnerRowData }) {
  const { owner, assigned, suggestion } = row
  if (assigned && owner) {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
        <Check className="size-3.5 shrink-0 text-success" strokeWidth={2.5} aria-hidden />
        <span className="min-w-0 truncate"><span className="font-medium text-text">{owner.name}</span> is the owner</span>
      </p>
    )
  }
  return (
    <>
      {owner && <p className="mt-0.5 truncate text-xs text-text-muted">{owner.name} has left</p>}
      {suggestion && (
        <p className="mt-0.5 text-xs leading-5 text-text-muted">
          Suggested: <span className="font-medium text-text">{suggestion.name}</span>,{' '}
          <span className="tabular-nums">{suggestion.share}%</span> of commits since {suggestionSinceLabel(suggestion.since)}
        </p>
      )}
    </>
  )
}

export interface AssignOwnersBodyProps {
  rows: OwnerRowData[]
  /** The app name was followed: the window has nothing more to show over the new page. */
  onOpenApp?: () => void
}

/** The window's content: a row for each app, or the all-done line. */
export function AssignOwnersBody({ rows, onOpenApp }: AssignOwnersBodyProps) {
  if (!rows.length) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-sm font-medium text-text" role="status">
        <CircleCheck className="size-4 text-success" aria-hidden />
        Every app has an owner.
      </p>
    )
  }
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window leaves this one as it is.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    onOpenApp?.()
  }
  return (
    // min-h: a picker opens under its row inside this scrolling window, so leave it room.
    <div className="min-h-[22rem]">
      <ul aria-label="Apps that need an owner" className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => {
          const { project, assigned } = row
          return (
            <li key={project.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <AppIcon name={project.name} color={project.color} size="sm" />
              <div className="min-w-0 flex-1 basis-44">
                <a
                  href={toHash({ name: 'project', projectId: project.id, view: 'app' })}
                  onClick={open}
                  className="focus-ring block truncate rounded-sm text-sm font-medium text-text hover:underline"
                >
                  {project.name}
                </a>
                <RowStatus row={row} />
              </div>
              <MemberPicker
                value={project.ownerId}
                align="end"
                emptyLabel="No owner"
                suggestion={row.suggestion}
                inviteOnAssign={{ projectId: project.id, appName: project.name }}
                onChange={(ownerId) => changeProjectOwner(project.id, ownerId).catch((error) => useUI.getState().notify(error instanceof Error ? error.message : 'Could not revoke the old invite.', 'danger'))}
                trigger={
                  <Button size="sm" variant={assigned ? 'ghost' : 'secondary'} aria-label={`${assigned ? 'Change owner' : 'Pick owner'} for ${project.name}`} className={cn(assigned && 'text-text-muted')}>
                    {assigned ? 'Change' : 'Pick owner'}
                  </Button>
                }
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AssignOwners() {
  const open = useUI((s) => s.assignOwnersOpen)
  const projects = useStore((s) => s.projects)
  const members = useStore((s) => s.members)
  const activity = useStore((s) => s.activity)
  const personal = useStore((s) => isPersonal(s.workspace))
  const close = () => useUI.getState().setAssignOwnersOpen(false)

  // Fixed when the window opens (set while rendering, so the first frame already has the list); kept while it closes
  // so the exit animation doesn't empty it.
  const [listed, setListed] = useState(() => ({ open, ids: open ? appsNeedingOwner(projects, members, personal).map((app) => app.id) : [] as string[] }))
  if (listed.open !== open) setListed({ open, ids: open ? appsNeedingOwner(projects, members, personal).map((app) => app.id) : listed.ids })

  const listedApps = useMemo(() => listed.ids.flatMap((id) => projects.find((project) => project.id === id) ?? []), [listed.ids, projects])
  const suggestions = useOwnerSuggestions(open, listedApps, members, activity)
  const rows = useMemo(() => ownerRows(listed.ids, projects, members, personal, suggestions), [listed.ids, projects, members, personal, suggestions])
  const summary = summaryLine(rows)

  return (
    <Modal
      open={open}
      onClose={close}
      title="Assign owners"
      description={summary ? <span aria-live="polite">{summary}</span> : undefined}
      size="lg"
      footer={<Button variant="primary" onClick={close}>Done</Button>}
    >
      <AssignOwnersBody rows={rows} onOpenApp={close} />
    </Modal>
  )
}
