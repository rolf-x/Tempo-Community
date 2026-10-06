// App page side panel: where the running app lives and how to get access. Feeds the app directory.
import { useState } from 'react'
import { Globe, KeyRound } from 'lucide-react'
import type { Project } from '../../types'
import { useStore } from '../../store/useStore'
import { appLink } from '../../lib/directory'
import { Card, Input, SectionHeader } from '../ui'

export function WhereItLives({ project, editable }: { project: Project; editable: boolean }) {
  const updateProject = useStore((s) => s.updateProject)
  const found = project.signals?.liveUrl ?? null
  const [url, setUrl] = useState<string | null>(null)
  const [access, setAccess] = useState<string | null>(null)
  const link = appLink(project)

  const saveUrl = () => {
    if (url === null) return
    const v = url.trim()
    updateProject(project.id, { liveUrl: v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null })
    setUrl(null)
  }
  const saveAccess = () => {
    if (access === null) return
    updateProject(project.id, { access: access.trim().slice(0, 200) || null })
    setAccess(null)
  }

  return (
    <section aria-label="Where it lives">
      <SectionHeader title="Where it lives" />
      <Card className="space-y-3">
        {editable ? (
          <>
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <Globe className="size-3.5" aria-hidden /> App link
              </span>
              <Input
                size="sm"
                value={url ?? project.liveUrl ?? ''}
                placeholder={found ?? 'https://…'}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={saveUrl}
                onKeyDown={(e) => e.key === 'Enter' && saveUrl()}
                aria-label="App link"
              />
              {found && !project.liveUrl && <span className="mt-1 block text-xs text-text-faint">Found in the repo. Type a link to override it.</span>}
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <KeyRound className="size-3.5" aria-hidden /> How to get access
              </span>
              <Input
                size="sm"
                value={access ?? project.access ?? ''}
                placeholder="e.g. Ask in #ops for an account"
                onChange={(e) => setAccess(e.target.value)}
                onBlur={saveAccess}
                onKeyDown={(e) => e.key === 'Enter' && saveAccess()}
                aria-label="How to get access"
              />
            </label>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-1.5 text-text-muted">
              <Globe className="size-3.5 shrink-0 text-text-faint" aria-hidden />
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className="focus-ring truncate rounded-sm text-accent underline-offset-2 hover:underline">
                  {link.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                'No link yet'
              )}
            </p>
            <p className="flex items-start gap-1.5 text-text-muted">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
              {project.access ?? 'Ask the owner for access'}
            </p>
          </div>
        )}
      </Card>
    </section>
  )
}
