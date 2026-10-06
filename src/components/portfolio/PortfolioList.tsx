import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { STALE_DAYS } from '../../ai/tools/health'
import { navigate, toHash } from '../../lib/router'
import { useStore } from '../../store/useStore'
import { HealthFlags, StageBadge, timeAgo } from '../app/AppBadges'
import { MemberPicker } from '../people/MemberPicker'
import { AppIcon, Avatar, Card, cn } from '../ui'
import { arrangePortfolioRows, defaultSortDirection, type PortfolioGroup, type PortfolioSort, type SortDirection } from './arrange'
import type { PortfolioRow } from './derive'
import { canEditApp } from '../../lib/permissions'
import { changeProjectOwner } from '../../data/workspace'
import { useUI } from '../uiState'

interface PortfolioListProps {
  rows: PortfolioRow[]
  group: PortfolioGroup
  sort: PortfolioSort
  direction: SortDirection
  onSort: (sort: PortfolioSort, direction: SortDirection) => void
}

const COLUMNS: Array<{ label: string; sort: PortfolioSort; className?: string }> = [
  // App takes the remaining width (w-full + max-w-0 lets its text truncate); the others size to their content.
  { label: 'App', sort: 'name', className: 'w-full' },
  { label: 'Owner', sort: 'owner', className: 'hidden sm:table-cell' },
  { label: 'Stage', sort: 'stage', className: 'hidden sm:table-cell' },
  { label: 'Health', sort: 'status', className: 'hidden sm:table-cell' },
  { label: 'Last commit', sort: 'last-commit', className: 'whitespace-nowrap' },
]

const interactiveTarget = (target: EventTarget) => (target as Element).closest('a, button, input, [role="option"]')

export function PortfolioList({ rows, group, sort, direction, onSort }: PortfolioListProps) {
  const groups = useMemo(() => arrangePortfolioRows(rows, group, sort, direction), [rows, group, sort, direction])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const selectSort = (next: PortfolioSort) => onSort(next, next === sort ? (direction === 'asc' ? 'desc' : 'asc') : defaultSortDirection(next))

  return (
    <Card bare className="overflow-hidden">
      <table className="w-full border-collapse text-left" aria-label="Apps list">
        <thead className="border-b border-border bg-surface-2">
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.sort}
                scope="col"
                aria-sort={sort === column.sort ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
                className={cn('px-3 py-2 text-xs font-medium text-text-muted first:pl-4 last:pr-4', column.className)}
              >
                <button type="button" onClick={() => selectSort(column.sort)} className="focus-ring rounded-sm text-left hover:text-text">
                  {column.label}{sort === column.sort && <span className="ml-1" aria-hidden>{direction === 'asc' ? '↑' : '↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((section) => {
          const isCollapsed = collapsed.has(section.key)
          return (
            <tbody key={section.key} className="divide-y divide-border">
              {section.label && (
                <tr className="bg-surface-2/60">
                  <th colSpan={5} scope="rowgroup" className="px-3 py-2 sm:px-4">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => setCollapsed((current) => {
                        const next = new Set(current)
                        if (next.has(section.key)) next.delete(section.key)
                        else next.add(section.key)
                        return next
                      })}
                      className="focus-ring flex w-full items-center gap-1.5 rounded-sm text-left text-xs font-semibold text-text-muted hover:text-text"
                    >
                      {isCollapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                      {section.label} <span className="font-normal tabular-nums text-text-faint">{section.rows.length}</span>
                    </button>
                  </th>
                </tr>
              )}
              {!isCollapsed && section.rows.map((row) => <PortfolioListRow key={row.project.id} row={row} />)}
            </tbody>
          )
        })}
      </table>
    </Card>
  )
}

function PortfolioListRow({ row }: { row: PortfolioRow }) {
  const { project, owner, flags } = row
  const route = { name: 'project' as const, projectId: project.id, view: 'app' as const }
  const href = toHash(route)
  const lastCommitAt = project.signals?.lastCommitAt
  const commitStamp = Date.parse(lastCommitAt ?? '')
  const stale = Number.isFinite(commitStamp) && Date.now() - commitStamp >= STALE_DAYS * 86_400_000
  const workspace = useStore((state) => state.workspace)
  const me = useStore((state) => state.members.find((member) => member.id === state.meId) ?? null)
  const editable = !workspace || canEditApp(me, project)
  const openRow = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!interactiveTarget(event.target)) navigate(route)
  }
  const openRowFromKeyboard = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) navigate(route)
  }

  return (
    <tr
      tabIndex={0}
      onClick={openRow}
      onKeyDown={openRowFromKeyboard}
      className="group cursor-pointer bg-surface outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
    >
      <td className="w-full max-w-0 px-3 py-2.5 first:pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <AppIcon name={project.name} color={project.color} size="md" />
          <div className="min-w-0">
            <a href={href} className="focus-ring block truncate rounded-sm text-sm font-semibold text-text hover:text-accent">{project.name}</a>
            <p className="truncate font-mono text-[11px] text-text-muted">{project.repo?.fullName ?? 'No repo connected'}</p>
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-2.5 sm:table-cell">
        {owner?.active || !editable ? (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={owner?.name ?? null} src={owner?.avatarUrl} size="xs" />
            <span className="truncate text-xs font-medium text-text">{owner?.name ?? 'No owner'}</span>
          </div>
        ) : (
          <MemberPicker
            value={project.ownerId}
            emptyLabel="No owner"
            inviteOnAssign={{ projectId: project.id, appName: project.name }}
            onChange={(ownerId) => changeProjectOwner(project.id, ownerId).catch((error) => useUI.getState().notify(error instanceof Error ? error.message : 'Could not revoke the old invite.', 'danger'))}
            trigger={<button type="button" onClick={(event) => event.stopPropagation()} className="focus-ring rounded-sm text-xs font-medium text-warning hover:underline">Pick owner</button>}
          />
        )}
      </td>
      <td className="hidden px-3 py-2.5 sm:table-cell"><StageBadge stage={project.appCard?.stage} /></td>
      <td className="hidden px-3 py-2.5 sm:table-cell"><HealthFlags flags={flags} max={2} /></td>
      <td className={cn('whitespace-nowrap px-3 py-2.5 text-xs tabular-nums', stale ? 'font-medium text-warning' : 'text-text-muted')}>
        {timeAgo(lastCommitAt)}
      </td>
    </tr>
  )
}
