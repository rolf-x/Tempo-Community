// Portfolio home (#/portfolio): every app in the workspace as a card, what needs attention first.
// Selectors return raw store slices; everything derived lives in useMemo (a selector that returns a fresh
// array or object re-renders forever).
import { isPersonal } from '../lib/model'
import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpDown, Check, ChevronDown, GitBranch, LayoutGrid, List as ListIcon, RefreshCw, Rows3, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useSession } from '../data/session'
import { syncAll, syncableApps, useSyncAll } from '../data/syncAll'
import { useClaudeWriting } from '../data/claudeWriting'
import { toHash } from '../lib/router'
import { useUI } from '../components/uiState'
import { MemberPicker } from '../components/people/MemberPicker'
import { OverlapCard, overlapOf } from '../components/portfolio/OverlapCard'
import { AppTile } from '../components/portfolio/AppTile'
import { AtAGlance } from '../components/portfolio/AtAGlance'
import { NoMatches } from '../components/portfolio/NoMatches'
import { PortfolioList } from '../components/portfolio/PortfolioList'
import { defaultPortfolioScope, portfolioStorageKey, rowsInScope, SHOW_ALL_APPS, type PortfolioScope } from '../components/portfolio/scope'
import { arrangePortfolioRows, defaultSortDirection, type PortfolioGroup, type PortfolioSort, type PortfolioViewMode, type SortDirection } from '../components/portfolio/arrange'
import { NextStepBar } from '../components/guide/NextStepBar'
import { matchesFilter, portfolioCounts, portfolioRows, type PortfolioFilter } from '../components/portfolio/derive'
import { Avatar, Button, Card, Chip, EmptyState, Menu, Page, PageHeader, SegmentedControl, cn, listItem, listStagger } from '../components/ui'

const CHIPS: { value: PortfolioFilter; label: string; key: 'apps' | 'attention' | 'stale' | 'noOwner' | 'changed' }[] = [
  { value: 'all', label: 'All', key: 'apps' },
  { value: 'attention', label: 'Needs attention', key: 'attention' },
  { value: 'stale', label: 'Stale', key: 'stale' },
  { value: 'no-owner', label: 'No owner', key: 'noOwner' },
  { value: 'changed', label: 'Changed this week', key: 'changed' },
]

const DASHBOARD_FILTER_LABEL: Partial<Record<PortfolioFilter, string>> = {
  risk: 'Risk',
  warn: 'Needs a look',
  healthy: 'Healthy',
  'stage:live': 'Stage: Live',
  'stage:building': 'Stage: Building',
  'stage:idea': 'Stage: Idea',
  'stage:stale': 'Stage: Stale',
  'stage:none': 'Stage: No card yet',
}

interface PortfolioToolbarSettings {
  view: PortfolioViewMode
  sort: PortfolioSort
  direction: SortDirection
  scope: PortfolioScope
  groups: Record<PortfolioViewMode, PortfolioGroup>
}

const SORT_LABEL: Record<PortfolioSort, string> = { status: 'Status', stage: 'Stage', 'last-commit': 'Last commit', name: 'Name', owner: 'Owner' }
const GROUP_LABEL: Record<PortfolioGroup, string> = { none: 'None', status: 'Status', stage: 'Stage', owner: 'Owner' }
const SORT_OPTIONS: Array<{ value: PortfolioSort; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'stage', label: 'Stage' },
  { value: 'last-commit', label: 'Last commit' },
  { value: 'name', label: 'Name' },
  { value: 'owner', label: 'Owner' },
]
const GROUP_OPTIONS: Array<{ value: PortfolioGroup; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'stage', label: 'Stage' },
  { value: 'owner', label: 'Owner' },
]

function toolbarDefaults(scope: PortfolioScope): PortfolioToolbarSettings {
  return { view: 'cards', sort: 'status', direction: 'asc', scope, groups: { cards: 'none', list: 'stage' } }
}

function readToolbarSettings(defaultScope: PortfolioScope, viewerId: string | null): PortfolioToolbarSettings {
  const defaults = toolbarDefaults(defaultScope)
  try {
    if (typeof window === 'undefined') return defaults
    const saved = JSON.parse(window.localStorage.getItem(portfolioStorageKey(viewerId)) ?? 'null') as Partial<PortfolioToolbarSettings> | null
    if (!saved) return defaults
    const view = saved.view === 'list' ? 'list' : 'cards'
    const sort = ['status', 'stage', 'last-commit', 'name', 'owner'].includes(saved.sort ?? '') ? saved.sort! : defaults.sort
    const direction = saved.direction === 'desc' || saved.direction === 'asc' ? saved.direction : defaultSortDirection(sort)
    const scope = saved.scope === 'my' || saved.scope === 'team' || saved.scope === 'all' ? saved.scope : defaultScope
    const validGroup = (value: unknown, fallback: PortfolioGroup) => ['none', 'status', 'stage', 'owner'].includes(String(value)) ? value as PortfolioGroup : fallback
    return {
      view,
      sort,
      direction,
      scope,
      groups: {
        cards: validGroup(saved.groups?.cards, defaults.groups.cards),
        list: validGroup(saved.groups?.list, defaults.groups.list),
      },
    }
  } catch {
    return defaults
  }
}

export default function PortfolioView() {
  const reducedMotion = useReducedMotion()
  const projects = useStore((s) => s.projects)
  const members = useStore((s) => s.members)
  const activity = useStore((s) => s.activity)
  const workspace = useStore((s) => s.workspace)
  const meId = useStore((s) => s.meId)
  const personal = isPersonal(workspace)
  const organization = !!workspace && !personal
  const me = members.find((member) => member.id === meId) ?? null
  const setRepoPickerOpen = useUI((s) => s.setRepoPickerOpen)
  const addApps = () => setRepoPickerOpen(true)
  // Sync all: signed in (the demo has no GitHub behind it) and at least one app the person can sync.
  const signedIn = useSession((s) => s.status === 'signed-in')
  const demo = useStore((s) => s.settings.demo)
  const syncing = useSyncAll((s) => s.running)
  const syncDone = useSyncAll((s) => s.done)
  const syncTotal = useSyncAll((s) => s.total)
  const claudeWriting = useClaudeWriting((s) => s.phase === 'waiting' || s.phase === 'writing')
  const canSyncAll = useMemo(() => signedIn && !demo && syncableApps(projects, me, workspace).length > 0, [signedIn, demo, projects, me, workspace])

  const [filter, setFilter] = useState<PortfolioFilter>('all')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState<PortfolioToolbarSettings>(() => readToolbarSettings(defaultPortfolioScope(me), meId))
  useEffect(() => {
    const showAll = () => setToolbar((current) => ({ ...current, scope: 'all' }))
    window.addEventListener(SHOW_ALL_APPS, showAll)
    return () => window.removeEventListener(SHOW_ALL_APPS, showAll)
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem(portfolioStorageKey(meId), JSON.stringify(toolbar))
    } catch { /* Storage can be unavailable in privacy modes. */ }
  }, [toolbar, meId])

  const rows = useMemo(() => portfolioRows(projects, members, activity, undefined, { personal }), [projects, members, activity, personal])
  const scope = organization ? toolbar.scope : 'all'
  const scopedRows = useMemo(() => rowsInScope(rows, scope, me?.id ?? null, members), [rows, scope, me?.id, members])
  const scopedProjectIds = useMemo(() => new Set(scopedRows.map((row) => row.project.id)), [scopedRows])
  const counts = useMemo(() => portfolioCounts(scopedRows), [scopedRows])
  const overlap = useMemo(() => overlapOf(scopedRows.map((row) => row.project), activity.filter((event) => scopedProjectIds.has(event.projectId))), [scopedRows, activity, scopedProjectIds])
  const shown = useMemo(() => scopedRows.filter((r) => matchesFilter(r, filter, ownerId)), [scopedRows, filter, ownerId])
  const owner = useMemo(() => (ownerId ? members.find((m) => m.id === ownerId) ?? null : null), [members, ownerId])
  const group = toolbar.groups[toolbar.view]
  const cardGroups = useMemo(() => arrangePortfolioRows(shown, group, toolbar.sort, toolbar.direction), [shown, group, toolbar.sort, toolbar.direction])

  const title = workspace?.name ?? 'Your apps'
  const filtered = filter !== 'all' || ownerId !== null

  if (rows.length === 0) {
    return (
      <Page>
        <PageHeader title={personal ? 'My apps' : 'Your apps'} subtitle={personal ? 'Every app you build, with its card and health.' : 'Every app your team builds, with its card, owner and health.'} />
        <NextStepBar />
        <Card bare>
          <EmptyState
            icon={LayoutGrid}
            title="No apps yet"
            body="Pick the GitHub repos your team builds in. Tempo reads each one and writes its card for you."
            action={
              <div className="flex flex-col items-center gap-3">
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" icon={GitBranch} onClick={() => setRepoPickerOpen(true)}>Add apps from GitHub</Button>
                </div>
              </div>
            }
          />
        </Card>
      </Page>
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title={title}
        subtitle={
          <span className="tabular-nums">
            {counts.apps} {counts.apps === 1 ? 'app' : 'apps'} · {counts.live} live ·{' '}
            <span className="inline-flex items-center gap-1.5">
              {counts.attention > 0 && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />}
              {counts.attention} {counts.attention === 1 ? 'needs' : 'need'} attention
            </span>
          </span>
        }
        // On a phone the buttons take their own row, so the title keeps its width.
        className="max-sm:[&>div:last-child]:basis-full"
        actions={
          <>
            {(canSyncAll || syncing) && (
              <Button icon={RefreshCw} loading={syncing} disabled={claudeWriting} onClick={() => void syncAll()}>
                {syncing ? `Syncing ${syncDone} of ${syncTotal}` : claudeWriting ? 'Claude is writing…' : 'Sync all'}
              </Button>
            )}
            <Button variant="primary" icon={GitBranch} onClick={addApps}>
              Add apps
            </Button>
          </>
        }
      />

      <NextStepBar projectIds={scopedProjectIds} />
      {scopedRows.length > 0 && <AtAGlance rows={scopedRows} personal={personal} filter={filter} onFilter={setFilter} />}

      <div className="mb-5 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Portfolio controls">
        {organization && (
          <SegmentedControl
            value={scope}
            onChange={(next) => setToolbar((current) => ({ ...current, scope: next }))}
            options={[{ value: 'my', label: 'My apps' }, { value: 'team', label: "Team's apps" }, { value: 'all', label: 'All apps' }]}
            size="sm"
            collapseLabels="never"
            aria-label="App scope"
          />
        )}
        {CHIPS.filter((chip) => !((personal || scope !== 'all') && chip.value === 'no-owner')).map((c) => {
          const quiet = counts[c.key] === 0 && filter !== c.value
          return (
            <Chip key={c.value} selected={filter === c.value} onClick={() => setFilter(c.value)}>
              <span className={cn(quiet && 'text-text-faint')}>{c.label}</span>
              <span className={cn('tabular-nums', quiet ? 'text-text-faint' : 'text-text-muted')}>{counts[c.key]}</span>
            </Chip>
          )
        })}
        {!personal && <MemberPicker
          value={ownerId}
          onChange={setOwnerId}
          emptyLabel="Anyone"
          canAdd={false}
          trigger={
            <Chip selected={ownerId !== null} className="pl-2" aria-label={owner ? `Owner: ${owner.name}` : 'Filter by owner'}>
              {owner ? <Avatar name={owner.name} src={owner.avatarUrl} size="xs" /> : <Users className="size-3.5" strokeWidth={2} aria-hidden />}
              {owner?.name ?? 'Owner'}
              <ChevronDown className="-mr-0.5 size-3.5 opacity-70" aria-hidden />
            </Chip>
          }
        />}
        {DASHBOARD_FILTER_LABEL[filter] && (
          <Chip selected onClick={() => setFilter('all')} aria-label={`Remove ${DASHBOARD_FILTER_LABEL[filter]} filter`}>
            {DASHBOARD_FILTER_LABEL[filter]} <span aria-hidden>×</span>
          </Chip>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Menu
            trigger={<Button size="sm" variant="secondary" icon={Rows3}>Group: {GROUP_LABEL[group]}</Button>}
            items={GROUP_OPTIONS.map((option) => ({
              label: option.label,
              icon: group === option.value ? Check : undefined,
              onSelect: () => setToolbar((current) => ({ ...current, groups: { ...current.groups, [current.view]: option.value } })),
            }))}
          />
          <Menu
            align="end"
            trigger={<Button size="sm" variant="secondary" icon={ArrowUpDown}>Sort: {SORT_LABEL[toolbar.sort]}</Button>}
            items={SORT_OPTIONS.map((option) => ({
              label: option.label,
              icon: toolbar.sort === option.value ? Check : undefined,
              onSelect: () => setToolbar((current) => ({ ...current, sort: option.value, direction: defaultSortDirection(option.value) })),
            }))}
          />
          <SegmentedControl
            value={toolbar.view}
            onChange={(view) => setToolbar((current) => ({ ...current, view }))}
            options={[{ value: 'cards', label: 'Cards', icon: LayoutGrid }, { value: 'list', label: 'List', icon: ListIcon }]}
            size="sm"
            collapseLabels="never"
            aria-label="Portfolio view"
          />
        </div>
      </div>

      <OverlapCard groups={overlap.groups} dead={overlap.dead} />

      {scope !== 'all' && scopedRows.length === 0 ? (
        <Card bare>
          <EmptyState
            compact
            icon={LayoutGrid}
            title={scope === 'my' ? 'No apps of yours yet' : 'No team apps yet'}
            body={scope === 'my' ? 'Apps you own will show here.' : 'Apps owned by other team members will show here.'}
            action={<Button onClick={() => setToolbar((current) => ({ ...current, scope: 'all' }))}>See all apps</Button>}
          />
        </Card>
      ) : shown.length === 0 ? (
        <NoMatches
          filter={filter}
          ownerFiltered={ownerId !== null}
          onClear={() => {
            setFilter('all')
            setOwnerId(null)
          }}
        />
      ) : toolbar.view === 'list' ? (
        <PortfolioList
          rows={shown}
          group={group}
          sort={toolbar.sort}
          direction={toolbar.direction}
          onSort={(sort, direction) => setToolbar((current) => ({ ...current, sort, direction }))}
        />
      ) : (
        <div className="space-y-5">
          {cardGroups.map((section) => (
            <section key={section.key}>
              {section.label && <h2 className="mb-2 text-xs font-semibold text-text-muted">{section.label} <span className="font-normal tabular-nums text-text-faint">{section.rows.length}</span></h2>}
              <motion.ul variants={reducedMotion ? undefined : listStagger} initial={reducedMotion ? false : 'hidden'} animate="show" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={section.label ? `${section.label} apps` : 'Apps'}>
                {section.rows.map((row) => (
                  <motion.li key={row.project.id} variants={reducedMotion ? undefined : listItem} layout={!reducedMotion} className="min-w-0">
                    <AppTile row={row} href={toHash({ name: 'project', projectId: row.project.id, view: 'app' })} />
                  </motion.li>
                ))}
              </motion.ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs tabular-nums text-text-muted">
        {filtered ? `${shown.length} of ${scopedRows.length} apps shown. ` : ''}
        Health flags are signals from repo data, not a security audit.
      </p>
    </Page>
  )
}
