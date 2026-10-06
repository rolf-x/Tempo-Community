import { useEffect, useRef, useState } from 'react'
import { plain } from '../ai/tools/applySync'
import { CheckCircle2, Pencil, Undo2 } from 'lucide-react'
import { DraftBadge, StageBadge } from '../components/app/AppBadges'
import { CardEvidenceRows } from '../components/app/SyncPreview'
import { Button, Card, Kbd, Page, PageHeader, Textarea } from '../components/ui'
import { toHash } from '../lib/router'
import { useStore } from '../store/useStore'
import { isUncheckedAICard, type Project } from '../types'
import { canEditApp } from '../lib/permissions'
import { redraftFactCards } from '../ai/redraft'
import { useRedraftState } from '../ai/redraftState'
import { workspaceAI } from '../ai/workspaceAI'
import { useUI } from '../components/uiState'
import { draftedByLine } from '../lib/draftedBy'

export default function ReviewView() {
  const projects = useStore((state) => state.projects)
  const checkCard = useStore((state) => state.checkCard)
  const checkAllCards = useStore((state) => state.checkAllCards)
  const editCard = useStore((state) => state.editCard)
  const updateProject = useStore((state) => state.updateProject)
  const setUndo = useStore((state) => state.setUndo)
  const workspace = useStore((state) => state.workspace)
  const members = useStore((state) => state.members)
  const me = useStore((state) => state.members.find((member) => member.id === state.meId) ?? null)
  const settings = useStore((state) => state.settings)
  const writingIds = useRedraftState((state) => state.writingIds)
  const reviewIds = useRef<string[] | null>(null)
  if (!reviewIds.current) reviewIds.current = projects.filter((project) => !project.archived).map((project) => project.id)

  const inReview = reviewIds.current.map((id) => projects.find((project) => project.id === id)).filter((project): project is Project => (
    !!project
    && !project.archived
    && project.appCard?.source === 'ai'
    && (!workspace || canEditApp(me, project))
  ))
  const pending = inReview.filter((project) => isUncheckedAICard(project.appCard))
  const current = pending[0]
  const total = inReview.length
  const checked = total - pending.length
  const [reviewedHere, setReviewedHere] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ what: '', who: '' })
  const [error, setError] = useState<string | null>(null)
  const offerAll = reviewedHere >= 3 && pending.length > 0
  const provider = workspaceAI(settings).provider
  const canDraftAgain = !!current && provider !== 'none' && provider !== 'demo' && (!workspace || canEditApp(me, current))
  const writing = !!current && writingIds.has(current.id)

  useEffect(() => {
    setEditing(false)
    setError(null)
    setDraft({ what: current?.appCard?.what ?? '', who: current?.appCard?.who ?? '' })
  }, [current?.id, current?.appCard?.what, current?.appCard?.who])

  const accept = () => {
    if (!current) return
    checkCard(current.id)
    setReviewedHere((count) => count + 1)
  }
  const save = () => {
    if (!current) return
    const what = draft.what.trim()
    const who = draft.who.trim()
    if (!what || !who) {
      setError("What it is and who it's for need text. Add both, then save.")
      return
    }
    editCard(current.id, { what, who })
    setReviewedHere((count) => count + 1)
  }
  const archive = () => {
    if (!current) return
    const id = current.id
    const name = current.name
    updateProject(id, { archived: true })
    setUndo({
      label: `Archived “${name}”`,
      restore: () => {
        useStore.getState().updateProject(id, { archived: false })
        useStore.getState().setUndo(null)
      },
    })
    setReviewedHere((count) => count + 1)
  }
  const draftAgain = async () => {
    if (!current || !canDraftAgain) return
    const events = await redraftFactCards({ projectIds: [current.id], concurrency: 1 })
    if (events.some((event) => event.type === 'failed')) {
      useUI.getState().notify("Tempo couldn't write this card. Its facts are still here. Draft again.", 'danger')
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (!current || editing) return
      const key = event.key.toLowerCase()
      if (key === 'a') accept()
      else if (key === 'e') setEditing(true)
      else if (key === 'n') archive()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!total) {
    return (
      <Page width="narrow">
        <PageHeader title="Check cards" subtitle="No app cards need checking." />
        <BackToPortfolio />
      </Page>
    )
  }

  if (!current) {
    return (
      <Page width="narrow">
        <PageHeader title={`${total} of ${total} checked`} subtitle="Every app card is ready to use." />
        <Card className="flex flex-col items-start gap-3">
          <CheckCircle2 className="size-6 text-success" aria-hidden />
          <p className="text-sm text-text-muted">The “Drafted by Tempo” badges are gone.</p>
          <BackToPortfolio />
        </Card>
      </Page>
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title={`Check cards · ${checked} of ${total}`}
        subtitle="Read each card beside the repo facts Tempo used."
        actions={offerAll ? (
          <Button variant="primary" onClick={() => checkAllCards(pending.map((project) => project.id))}>
            Accept the other {pending.length}
          </Button>
        ) : undefined}
      />

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)]">
        <Card className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-medium text-text">{current.name}</h2>
              <p className="mt-0.5 break-all font-mono text-xs text-text-muted">{current.repo?.fullName ?? 'No repo connected'}</p>
            </div>
            <StageBadge stage={current.appCard?.stage} />
          </div>

          {editing ? (
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-text">
                What it is
                <Textarea className="mt-1.5" rows={4} value={draft.what} onChange={(event) => setDraft((value) => ({ ...value, what: event.target.value }))} autoFocus />
              </label>
              <label className="block text-sm font-medium text-text">
                Who it's for
                <Textarea className="mt-1.5" rows={3} value={draft.who} onChange={(event) => setDraft((value) => ({ ...value, who: event.target.value }))} />
              </label>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={save}>Save card</Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-5 text-sm leading-6 text-text">{plain(current.appCard?.what ?? '')}</p>
              <p className="mt-2 text-sm leading-6 text-text-muted">{current.appCard?.who}</p>
              {current.appCard?.status && <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm leading-5 text-text-muted">{current.appCard.status}</p>}
              {current.appCard?.draftedBy
                ? <p className="mt-4 break-words text-xs text-text-muted">{draftedByLine(current.appCard.draftedBy, members)}</p>
                : <DraftBadge card={current.appCard} className="mt-4" />}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant={offerAll ? 'secondary' : 'primary'} onClick={accept}>Looks right <Kbd>A</Kbd></Button>
                {canDraftAgain && <Button variant="secondary" loading={writing} onClick={() => void draftAgain()}>Draft again</Button>}
                <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit <Kbd>E</Kbd></Button>
                <Button variant="ghost" icon={Undo2} onClick={archive}>Not an app <Kbd>N</Kbd></Button>
              </div>
            </>
          )}
        </Card>

        <section className="min-w-0" aria-labelledby="card-evidence-title">
          <h2 id="card-evidence-title" className="mb-2 text-sm font-medium text-text-muted">Evidence</h2>
          <CardEvidenceRows project={current} />
        </section>
      </div>
    </Page>
  )
}

function BackToPortfolio() {
  return <a href={toHash({ name: 'portfolio' })} className="focus-ring inline-flex rounded-sm text-sm font-medium text-accent hover:underline">Back to the portfolio</a>
}
