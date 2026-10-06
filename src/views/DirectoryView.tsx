// #/directory: the company's internal app store. Find an app, see what it does and who owns it, open it, or learn
// how to get access. Built from the same apps as the portfolio; the link comes from the repo or from the app page.
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Copy, KeyRound, LayoutGrid, Mail, Search } from 'lucide-react'
import { useStore } from '../store/useStore'
import { directoryRows } from '../lib/directory'
import { toHash } from '../lib/router'
import { accessRequest } from '../lib/accessRequest'
import { plain } from '../ai/tools/applySync'
import { StageBadge } from '../components/app/AppBadges'
import { useUI } from '../components/uiState'
import { Avatar, Button, Card, Chip, EmptyState, Input, Page, PageHeader, Popover, listItem, listStagger } from '../components/ui'

export const accessExplanation = (ownerName: string, appName: string) => `This asks ${ownerName}. They'll see a request for ${appName} with its link; Tempo sends nothing itself.`
export const sendByEmailExplanation = 'Send by email opens your own mail app.'

function AccessPopover({ appName, appUrl, access, owner }: {
  appName: string
  appUrl: string
  access?: string | null
  owner: { name: string; email: string | null; avatarUrl: string | null }
}) {
  const request = accessRequest({ appName, appUrl, ownerName: owner.name, ownerEmail: owner.email })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(request.message)
      useUI.getState().notify('Message copied', 'success')
    } catch {
      useUI.getState().notify('Couldn’t copy the message. Select the text and copy it.', 'danger')
    }
  }

  return (
    <Popover
      align="end"
      className="w-[min(20rem,calc(100vw-2rem))] p-3"
      trigger={<Button size="sm" variant="ghost">Ask for access</Button>}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-2">
            <Avatar name={owner.name} src={owner.avatarUrl} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text">{owner.name}</p>
              {owner.email && <p className="truncate text-xs text-text-muted">{owner.email}</p>}
            </div>
          </div>
          {access && (
            <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs leading-5 text-text-muted">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
              <span>{access}</span>
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-text-muted">
            {accessExplanation(owner.name, appName)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Mail} onClick={() => {
              close()
              window.location.href = request.mailtoUrl
            }}>Send by email</Button>
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => {
              void copy()
              close()
            }}>Copy message</Button>
          </div>
          <p className="mt-2 text-xs text-text-muted">{sendByEmailExplanation}</p>
        </div>
      )}
    </Popover>
  )
}

export default function DirectoryView() {
  const projects = useStore((s) => s.projects)
  const members = useStore((s) => s.members)
  const meId = useStore((s) => s.meId)
  const [q, setQ] = useState('')
  const [liveOnly, setLiveOnly] = useState(false)

  const allRows = useMemo(() => directoryRows(projects, members, ''), [projects, members])
  const rows = useMemo(() => directoryRows(projects, members, q, { liveOnly }), [projects, members, q, liveOnly])
  const openable = allRows.filter((r) => r.link).length
  const total = allRows.length
  const appCount = `${total} ${total === 1 ? 'app' : 'apps'}`
  const subtitle = openable === 0
    ? `${appCount} · add an app link to open them from here`
    : `${appCount} · ${openable} you can open`

  return (
    <Page width="wide">
      <PageHeader
        title="App directory"
        subtitle={<span className="tabular-nums">{subtitle}</span>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-80">
          <Input icon={Search} size="sm" placeholder="Search apps, what they do, owners…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the app directory" />
        </div>
        <Chip selected={!liveOnly} onClick={() => setLiveOnly(false)}>
          All apps
        </Chip>
        <Chip selected={liveOnly} onClick={() => setLiveOnly(true)}>
          Can open now
        </Chip>
      </div>

      {rows.length === 0 ? (
        <Card bare>
          <EmptyState
            icon={LayoutGrid}
            title={q ? 'No apps match' : liveOnly ? 'No live links yet' : 'No apps yet'}
            body={
              q
                ? 'Try another word: an app, a team or an owner’s name.'
                : 'Tempo picks up the link from the repo’s homepage or its latest production deployment. You can also set it on the app’s page.'
            }
          />
        </Card>
      ) : (
        <motion.ul variants={listStagger} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ project: p, link, owner }) => (
            <motion.li key={p.id} variants={listItem}>
              <Card className="flex h-full flex-col p-4 transition-shadow duration-150 hover:shadow-sm">
                <div className="flex items-start gap-2">
                  <a href={toHash({ name: 'project', projectId: p.id, view: 'app' })} className="focus-ring min-w-0 flex-1 rounded-sm">
                    <span className="block truncate text-sm font-semibold text-text">{p.name}</span>
                  </a>
                  {p.appCard?.stage && <StageBadge stage={p.appCard.stage} />}
                </div>
                <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-text-muted">{plain(p.appCard?.what || 'No description yet. Sync the app to write its card.')}</p>
                {p.access && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-text-muted">
                    <KeyRound className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
                    <span>{p.access}</span>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {owner ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-text-muted">
                      <Avatar name={owner.name} src={owner.avatarUrl} size="xs" />
                      <span className="truncate">{owner.name}</span>
                    </span>
                  ) : (
                    <span className="flex-1 text-xs text-text-muted">No owner yet</span>
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {owner && owner.id !== meId && (
                      <AccessPopover
                        appName={p.name}
                        appUrl={link ?? new URL(toHash({ name: 'project', projectId: p.id, view: 'app' }), window.location.href).href}
                        access={p.access}
                        owner={owner}
                      />
                    )}
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-border-strong bg-surface px-3 text-xs font-medium text-text transition-colors hover:bg-surface-2"
                      >
                        Open app <ArrowUpRight className="size-3.5" aria-hidden />
                      </a>
                    ) : (
                      <a href={toHash({ name: 'project', projectId: p.id, view: 'app' })} className="focus-ring rounded-sm px-2 py-1 text-xs font-medium text-text-muted hover:text-text">
                        Details
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </Page>
  )
}
