// "Overlap & cleanup": apps that may do the same thing, and apps nobody has touched in 30+ days.
// Hints for a human, so every action is a plain link or an undoable Archive.
import { useMemo } from 'react'
import { Archive, Copy } from 'lucide-react'
import type { Activity, Project } from '../../types'
import { useStore } from '../../store/useStore'
import { useUI } from '../uiState'
import { toHash } from '../../lib/router'
import { DEAD_DAYS, findDeadApps, findDuplicates, type DeadApp, type DuplicateGroup } from '../../ai/tools/overlap'
import { AppIcon, Button, Card, SectionHeader } from '../ui'
import { canEditApp } from '../../lib/permissions'

export function overlapOf(projects: Project[], activity: Activity[], now = new Date()): { groups: DuplicateGroup[]; dead: DeadApp[] } {
  return { groups: findDuplicates(projects), dead: findDeadApps(projects, activity, now) }
}

const link = (id: string) => toHash({ name: 'project', projectId: id, view: 'app' })

function AppLink({ p }: { p: Project }) {
  return (
    <a href={link(p.id)} className="focus-ring inline-flex items-center gap-1 rounded-sm align-middle font-medium text-text underline-offset-2 hover:underline">
      <AppIcon name={p.name} color={p.color} />
      {p.name}
    </a>
  )
}

export function OverlapCard({ groups, dead }: { groups: DuplicateGroup[]; dead: DeadApp[] }) {
  const projects = useStore((s) => s.projects)
  const updateProject = useStore((s) => s.updateProject)
  const setUndo = useStore((s) => s.setUndo)
  const notify = useUI((s) => s.notify)
  const workspace = useStore((s) => s.workspace)
  const me = useStore((s) => s.members.find((member) => member.id === s.meId) ?? null)
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  if (!groups.length && !dead.length) return null

  const archive = (p: Project) => {
    updateProject(p.id, { archived: true })
    notify(`Archived “${p.name}”`)
    setUndo({ label: `Archived “${p.name}”`, restore: () => { updateProject(p.id, { archived: false }); setUndo(null) } })
  }

  return (
    <section aria-label="Overlap and cleanup" className="mb-5">
      <SectionHeader title="Overlap & cleanup" />
      <Card bare className="divide-y divide-border">
        {groups.map((g) => {
          const apps = g.appIds.map((id) => byId.get(id)).filter((p): p is Project => !!p)
          return (
            <div key={g.appIds.join('+')} className="flex items-start gap-3 p-3.5">
              <Copy className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="text-text-muted">
                  {apps.length} apps may do the same thing:{' '}
                  {apps.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && (i === apps.length - 1 ? ' and ' : ', ')}
                      <AppLink p={p} />
                    </span>
                  ))}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">{g.reason}</p>
              </div>
            </div>
          )
        })}
        {dead.length > 0 && (
          <div className="p-3.5">
            <p className="text-sm text-text-muted">
              {dead.length} {dead.length === 1 ? 'app looks' : 'apps look'} abandoned{' '}
              <span className="text-text-muted">(no activity in {DEAD_DAYS}+ days)</span>
            </p>
            <ul className="mt-2 space-y-1.5">
              {dead.map((d) => {
                const p = byId.get(d.appId)
                if (!p) return null
                return (
                  <li key={d.appId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <AppLink p={p} /> <span className="text-xs tabular-nums text-text-muted">· {d.days} days</span>
                    </span>
                    {(!workspace || canEditApp(me, p)) && <Button size="sm" icon={Archive} onClick={() => archive(p)} aria-label={`Archive ${p.name}`}>
                      Archive
                    </Button>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Card>
    </section>
  )
}
