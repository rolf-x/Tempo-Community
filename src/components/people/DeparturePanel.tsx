import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { health } from '../../ai/tools/health'
import { formatShort } from '../../lib/dates'
import { useStore } from '../../store/useStore'
import { changeProjectOwner } from '../../data/workspace'
import type { Member, Project } from '../../types'
import { HandoverModal } from '../app/HandoverModal'
import { Avatar, Button } from '../ui'
import { MemberPicker } from './MemberPicker'
import { useUI } from '../uiState'

export const leavingDateLabel = (leavingOn: string) => formatShort(leavingOn)

export function allAppsHaveNewOwners(apps: Project[], members: Member[], departingMemberId: string, now = new Date()): boolean {
  return apps.length > 0 && apps.every((app) => (
    app.ownerId !== departingMemberId
    && !health(app, members, now, { keptAt: app.keptAt }).some((flag) => flag.kind === 'no-owner' || flag.kind === 'owner-left')
  ))
}

export function DeparturePanel({ memberId }: { memberId: string }) {
  const member = useStore((state) => state.members.find((person) => person.id === memberId) ?? null)
  const members = useStore((state) => state.members)
  const projects = useStore((state) => state.projects)
  const [handover, setHandover] = useState<Project | null>(null)
  const tracked = useRef<{ memberId: string; ids: string[] }>({ memberId, ids: [] })

  if (tracked.current.memberId !== memberId) tracked.current = { memberId, ids: [] }
  for (const project of projects) {
    if (!project.archived && project.ownerId === memberId && !tracked.current.ids.includes(project.id)) tracked.current.ids.push(project.id)
  }
  const apps = tracked.current.ids.flatMap((id) => {
    const project = projects.find((item) => item.id === id)
    return project && !project.archived ? [project] : []
  })

  if (!member?.leavingOn) return null
  const total = apps.length
  const done = allAppsHaveNewOwners(apps, members, memberId)

  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface-2 p-3" aria-labelledby={`departure-${member.id}`}>
      <h3 id={`departure-${member.id}`} className="text-sm font-medium text-text">
        {member.name} leaves on {leavingDateLabel(member.leavingOn)} · <span className="tabular-nums">{total}</span> {total === 1 ? 'app' : 'apps'}
      </h3>
      {total === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No apps need a handover.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {apps.map((app) => {
            const owner = members.find((person) => person.id === app.ownerId) ?? null
            const reassigned = !!app.ownerId && app.ownerId !== memberId
            return (
              <li key={app.id} className="min-w-0 rounded-md border border-border bg-surface px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{app.name}</span>
                    {app.repo && <span className="block truncate font-mono text-xs text-text-muted">{app.repo.fullName}</span>}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setHandover(app)}>Handover pack</Button>
                    <MemberPicker
                      value={app.ownerId}
                      onChange={(ownerId) => {
                        if (ownerId !== memberId) return changeProjectOwner(app.id, ownerId).catch((error) => {
                          useUI.getState().notify(error instanceof Error ? error.message : 'Could not revoke the old invite.', 'danger')
                        })
                      }}
                      align="end"
                      emptyLabel="No owner"
                      trigger={
                        <Button size="sm" variant="secondary" aria-label={`Owner for ${app.name}`}>
                          {reassigned && owner ? <Avatar name={owner.name} src={owner.avatarUrl} size="xs" /> : null}
                          <span className="max-w-32 truncate">{reassigned && owner ? owner.name : 'Choose owner'}</span>
                          <ChevronDown className="size-3.5 opacity-70" aria-hidden />
                        </Button>
                      }
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {done && <p className="mt-3 text-sm font-medium text-success" role="status">All {total} {total === 1 ? 'app has' : 'apps have'} a new owner.</p>}
      {handover && <HandoverModal open onClose={() => setHandover(null)} projectId={handover.id} appName={handover.name} />}
    </section>
  )
}
