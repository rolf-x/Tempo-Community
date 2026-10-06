import { Ellipsis, Menu as MenuIcon, Trash } from 'lucide-react'
import { useStore } from '../store/useStore'
import { navigate, useRoute, type Route } from '../lib/router'
import { useUI } from './uiState'
import { AppIcon, IconButton, Menu } from './ui'
import { canEditApp } from '../lib/permissions'

const TITLE: Record<Exclude<Route['name'], 'project'>, string> = {
  home: '',
  welcome: '',
  login: '',
  setup: '',
  directory: 'App directory',
  join: '',
  privacy: '',
  notFound: '',
  portfolio: 'Portfolio',
  review: 'Check cards',
  settings: 'Settings',
}

export function Topbar() {
  const route = useRoute()
  const projects = useStore((s) => s.projects)
  const deleteProject = useStore((s) => s.deleteProject)
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)
  const workspace = useStore((s) => s.workspace)
  const me = useStore((s) => s.members.find((member) => member.id === s.meId) ?? null)
  const project = route.name === 'project' ? projects.find((p) => p.id === route.projectId) : undefined
  const canEditProject = !workspace || !!project && canEditApp(me, project)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-5">
      <IconButton icon={MenuIcon} label="Menu" onClick={() => setSidebarOpen(true)} className="-ml-1 md:hidden" />

      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-text">
        {route.name === 'project' ? (
          project && (
            <>
              <AppIcon name={project.name} color={project.color} />
              <span className="truncate">{project.name}</span>
            </>
          )
        ) : (
          <>
            <span>{TITLE[route.name]}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        {project && canEditProject && (
          <Menu
            align="end"
            trigger={<IconButton icon={Ellipsis} label="App options" />}
            items={[
              {
                label: 'Delete app',
                icon: Trash,
                danger: true,
                onSelect: () => {
                  deleteProject(project.id)
                  navigate({ name: 'portfolio' })
                },
              },
            ]}
          />
        )}
      </div>
    </header>
  )
}
