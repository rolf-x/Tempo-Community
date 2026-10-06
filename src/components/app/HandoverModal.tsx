// Handover pack: the generated document, rendered, with copy and download. Loads when opened; retry on error.
// A pack an agent wrote over MCP is a draft: it can be copied or downloaded only after a person marks it checked.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Download, RefreshCw } from 'lucide-react'
import { aiHandover, type HandoverOutcome } from '../../ai/router'
import { HandoverOut } from '../../ai/schemas'
import { cleanHandoverDraft } from '../../ai/tools/mcpDrafts'
import { handoverMarkdown } from '../../ai/tools/handoverMarkdown'
import { handoverByline } from '../../lib/draftedBy'
import { canEditApp } from '../../lib/permissions'
import { useStore } from '../../store/useStore'
import { useUI } from '../uiState'
import { Button, Modal, Skeleton } from '../ui'
import type { StoredHandover } from '../../types'

const INLINE = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`]+`)/g

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="focus-ring rounded-sm text-accent hover:underline">{link[1]}</a>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Renders the subset of markdown handoverMarkdown emits: # / ## headings, "- " lists, paragraphs, links, code. */
export function MarkdownLite({ md }: { md: string }) {
  const out: ReactNode[] = []
  let items: string[] = []
  const flush = () => {
    if (!items.length) return
    out.push(<ul key={`u${out.length}`} className="list-disc space-y-1 pl-5 text-sm leading-6 text-text">{items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>)
    items = []
  }
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) { items.push(line.slice(2)); continue }
    flush()
    if (line.startsWith('# ')) out.push(<h2 key={out.length} className="text-lg font-semibold text-text">{inline(line.slice(2))}</h2>)
    else if (line.startsWith('## ')) out.push(<h3 key={out.length} className="pt-2 text-sm font-semibold text-text">{inline(line.slice(3))}</h3>)
    else if (line.trim()) out.push(<p key={out.length} className="text-sm leading-6 text-text">{inline(line)}</p>)
  }
  flush()
  return <div className="space-y-2">{out}</div>
}

/**
 * A handover pack an agent wrote over MCP, checked against the schema and cleaned again here (agents can write straight
 * to the database) and rendered as markdown. null when the app has none, or the stored pack doesn't have the right shape.
 */
export function storedHandoverMarkdown(handover: StoredHandover | null | undefined, repoFullName: string | null | undefined, appName: string): string | null {
  if (!handover) return null
  const doc = HandoverOut.safeParse(handover.doc)
  if (!doc.success) return null
  try {
    return handoverMarkdown(cleanHandoverDraft(doc.data, repoFullName), appName)
  } catch {
    return null
  }
}

/** Only a person's check makes an agent's pack usable; anything but a timestamp is still a draft. */
export const isCheckedHandover = (handover: StoredHandover | null | undefined) => typeof handover?.checkedAt === 'string'

export function HandoverModal({ open, onClose, projectId, appName }: { open: boolean; onClose: () => void; projectId: string; appName: string }) {
  const project = useStore((s) => s.projects.find((item) => item.id === projectId))
  const members = useStore((s) => s.members)
  const workspace = useStore((s) => s.workspace)
  const me = useStore((s) => s.members.find((member) => member.id === s.meId) ?? null)
  const checkHandover = useStore((s) => s.checkHandover)
  const handover = project?.handover
  const repoName = project?.repo?.fullName
  const storedMd = useMemo(() => storedHandoverMarkdown(handover, repoName, appName), [handover, repoName, appName])
  const stored = storedMd !== null
  const storedRef = useRef(stored)
  storedRef.current = stored
  // true once the person asks for a rebuild (or there was nothing written by an agent): then the repo-facts path shows.
  const [rebuilt, setRebuilt] = useState(false)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; out: HandoverOutcome }>({ status: 'loading' })
  const run = useRef(0)

  const generate = useCallback(async () => {
    const id = ++run.current
    setState({ status: 'loading' })
    try {
      const out = await aiHandover(projectId)
      if (id === run.current) setState({ status: 'done', out })
    } catch (e) {
      if (id === run.current) setState({ status: 'error', message: e instanceof Error ? e.message : "Couldn't write the handover pack." })
    }
  }, [projectId])

  useEffect(() => {
    if (!open) {
      run.current++ // drop a late answer after closing
      return
    }
    // An agent-written pack comes first and costs nothing; the repo-facts path runs only when asked or when there is none.
    setRebuilt(!storedRef.current)
    if (!storedRef.current) void generate()
  }, [open, generate])

  const rebuild = () => {
    setRebuilt(true)
    void generate()
  }

  const showStored = stored && !rebuilt
  const draft = showStored && !isCheckedHandover(handover)
  const canCheck = !!project && (!workspace || canEditApp(me, project))
  const ready = (showStored && !draft) || (!showStored && state.status === 'done')
  const md = showStored ? storedMd : state.status === 'done' ? state.out.markdown : ''
  const description = showStored && handover
    ? handoverByline(handover.draftedBy, members)
    : state.status === 'done' ? (state.out.source === 'ai' ? 'Written by AI from the repo and agent notes' : 'Written from repo data') : undefined
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md)
      useUI.getState().notify('Handover copied as markdown', 'success')
    } catch {
      useUI.getState().notify("Couldn't copy. Use Download instead.", 'danger')
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `handover-${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Handover pack"
      description={description}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {showStored && <Button variant="ghost" icon={RefreshCw} onClick={rebuild}>Rebuild from repo facts</Button>}
          {draft && canCheck && <Button variant="primary" icon={Check} onClick={() => checkHandover(projectId)}>Mark as checked</Button>}
          {stored && rebuilt && <Button variant="ghost" onClick={() => setRebuilt(false)}>Show agent pack</Button>}
          <Button icon={Copy} disabled={!ready} onClick={copy}>Copy markdown</Button>
          <Button icon={Download} disabled={!ready} onClick={download}>Download .md</Button>
        </div>
      }
    >
      {draft && (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-text" role="note">
          {canCheck
            ? 'Unchecked draft. Read it first: once you mark it checked, it can be copied and downloaded.'
            : "Unchecked draft. The app's owner or an admin reads it and marks it checked before it can be shared."}
        </p>
      )}
      {showStored && <MarkdownLite md={md} />}
      {!showStored && state.status === 'loading' && (
        <div className="space-y-3" role="status" aria-label="Writing the handover pack">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      )}
      {!showStored && state.status === 'error' && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-danger">{state.message}</p>
          <Button size="sm" onClick={() => void generate()}>Try again</Button>
        </div>
      )}
      {!showStored && state.status === 'done' && <MarkdownLite md={md} />}
    </Modal>
  )
}
