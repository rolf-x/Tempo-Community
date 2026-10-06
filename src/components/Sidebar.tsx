import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { isPersonal } from '../lib/model'
import { AppWindow, LayoutGrid, LogOut, Monitor, Moon, Plus, Search, Settings, Sun, X, type LucideIcon } from 'lucide-react'
import type { Theme } from '../types'
import { useStore } from '../store/useStore'
import { activeProjects } from '../store/selectors'
import { portfolioRows } from './portfolio/derive'
import { isAtRisk } from '../lib/attention'
import { flagTone } from '../ai/tools/health'
import { toHash, useRoute, type Route } from '../lib/router'
import { canManagePeople } from '../lib/permissions'
import { requestAllApps } from './portfolio/scope'
import { useUI } from './uiState'
import { Mark } from './Logo'
import { signOutToHome, useSession } from '../data/session'
import { AppIcon, Avatar, Button, DUR, IconButton, Kbd, MOD, cn } from './ui'
import { SetupChecklist } from './guide/SetupChecklist'

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABEL: Record<Theme, string> = { system: 'Theme: follows system', light: 'Theme: light', dark: 'Theme: dark' }

export function Sidebar() {
  const reducedMotion = useReducedMotion()
  const route = useRoute()
  const open = useUI((s) => s.sidebarOpen)
  const setOpen = useUI((s) => s.setSidebarOpen)
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const projects = useStore((s) => s.projects)
  const members = useStore((s) => s.members)
  const activity = useStore((s) => s.activity)
  const meId = useStore((s) => s.meId)
  const workspace = useStore((s) => s.workspace)
  const theme = useStore((s) => s.settings.theme)
  const setSettings = useStore((s) => s.setSettings)
  const user = useSession((s) => (s.status === 'signed-in' ? s.user : null))
  const personal = isPersonal(workspace)

  const live = activeProjects(projects)
  const me = members.find((member) => member.id === meId)
  const ownAppsOnly = !!workspace && !personal && !!me && !canManagePeople(me)
  const visibleApps = ownAppsOnly ? live.filter((project) => project.ownerId === me.id) : live
  const attentionByProject = new Map(portfolioRows(visibleApps, members, activity, undefined, { personal }).map((row) => [row.project.id, row]))
  const close = () => setOpen(false)
  const newApp = () => {
    close()
    useUI.getState().setRepoPickerOpen(true)
  }
  const ThemeIcon = THEME_ICON[theme]

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-overlay md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : DUR.fast }}
            onClick={close}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <aside
        aria-label="Sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-border bg-bg transition-transform duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none',
          'md:static md:z-auto md:w-64 md:translate-x-0 md:transition-none',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between pl-4 pr-2">
          <a href={toHash({ name: 'home' })} onClick={close} className="focus-ring flex items-center gap-2 rounded-md" aria-label="Tempo homepage">
            <Mark size={22} />
            <span className="text-[15px] font-semibold tracking-tight text-text">Tempo</span>
          </a>
          <IconButton icon={X} label="Close menu" size="sm" onClick={close} className="md:hidden" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <SetupChecklist />
          <button
            type="button"
            onClick={() => {
              close()
              setCommandOpen(true)
            }}
            className="focus-ring mt-1 flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-text-muted shadow-xs transition-colors hover:border-border-strong hover:text-text"
          >
            <Search className="size-4 text-text-faint" aria-hidden />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>{MOD}K</Kbd>
          </button>

          <nav className="mt-3 space-y-0.5" aria-label="Main">
            <NavItem to={{ name: 'portfolio' }} icon={LayoutGrid} label="Portfolio" active={route.name === 'portfolio'} onClick={close} />
            <NavItem to={{ name: 'directory' }} icon={AppWindow} label="App directory" active={route.name === 'directory'} onClick={close} />
          </nav>

          <div className="mb-1 mt-6 flex items-center pl-2.5 pr-1">
            <span className="text-xs font-medium text-text-muted">{ownAppsOnly ? 'My apps' : 'Apps'}</span>
          </div>

          {!ownAppsOnly && visibleApps.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong p-3 text-center">
              <p className="text-xs text-text-muted">No apps yet. Pick your repos and Tempo writes the cards.</p>
              <Button variant="secondary" size="sm" icon={Plus} block className="mt-2.5" onClick={newApp}>
                New app
              </Button>
            </div>
          ) : (
            <nav className="space-y-0.5" aria-label="Apps">
              {ownAppsOnly && visibleApps.length === 0 && (
                <p className="px-2.5 py-1.5 text-xs text-text-muted">No apps of yours yet</p>
              )}
              {visibleApps.map((p) => {
                const active = route.name === 'project' && route.projectId === p.id
                const attention = attentionByProject.get(p.id)
                const alert = attention && isAtRisk(attention.flags)
                const alertLabel = attention?.flags.find((flag) => flagTone(flag) === 'risk')?.label ?? 'At risk'
                return (
                  <a
                    key={p.id}
                    href={toHash({ name: 'project', projectId: p.id, view: 'app' })}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'focus-ring group flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-100',
                      active ? 'bg-surface-2 font-medium text-text' : 'text-text-muted hover:bg-surface-2 hover:text-text',
                    )}
                  >
                    <AppIcon name={p.name} color={p.color} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {/* A real-risk health flag: one dot, the label in the tooltip. */}
                    {alert && <span className="size-1.5 shrink-0 rounded-full bg-danger" role="img" aria-label={alertLabel} title={alertLabel} />}
                  </a>
                )
              })}
              {ownAppsOnly && (
                <a
                  href={toHash({ name: 'portfolio' })}
                  onClick={() => { requestAllApps(); close() }}
                  className="focus-ring flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-base text-text-faint transition-colors hover:bg-surface-2 hover:text-text-muted"
                >
                  <LayoutGrid className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">All apps</span>
                </a>
              )}
              <button
                type="button"
                onClick={newApp}
                className="focus-ring mt-1 flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-base text-text-muted transition-colors hover:bg-surface-2 hover:text-text-muted"
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">New app</span>
              </button>
            </nav>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-1">
            <NavItem to={{ name: 'settings' }} icon={Settings} label="Settings" active={route.name === 'settings'} onClick={close} className="flex-1" />
            <IconButton icon={ThemeIcon} label={THEME_LABEL[theme]} size="sm" onClick={() => setSettings({ theme: THEME_NEXT[theme] })} />
          </div>
          {user && (
            <div className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5">
              <Avatar name={user.name} src={user.avatarUrl ?? undefined} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={user.email ?? undefined}>
                {user.githubLogin ?? user.name}
              </span>
              <Button size="sm" variant="ghost" icon={LogOut} onClick={() => void signOutToHome()}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

interface NavItemProps {
  to: Route
  icon: LucideIcon
  label: string
  active: boolean
  onClick?: () => void
  /** Shortcut hint, shown on hover (desktop) */
  hint?: string
  className?: string
}

function NavItem({ to, icon: Icon, label, active, onClick, hint, className }: NavItemProps) {
  return (
    <a
      href={toHash(to)}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-ring group flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-100',
        active ? 'bg-surface-2 font-medium text-text' : 'text-text-muted hover:bg-surface-2 hover:text-text',
        className,
      )}
    >
      <Icon className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-text-faint group-hover:text-text-muted')} strokeWidth={2} aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span className="hidden text-[11px] text-text-faint opacity-0 transition-opacity group-hover:opacity-100 md:inline" aria-hidden>
          {hint}
        </span>
      )}
    </a>
  )
}
