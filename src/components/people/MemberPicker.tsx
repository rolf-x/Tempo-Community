// Pick a workspace member (assignee or app owner). Owner pickers can also accept a commit-share
// suggestion, and in a team workspace they can invite someone who isn't in Tempo yet: the "Invite someone new" form
// adds them, makes them the owner and makes their invite link.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Check, Copy, Plus, UserMinus, UserPlus } from 'lucide-react'
import type { OwnerSuggestion } from '../../ai/tools/matchMember'
import { suggestionSinceLabel } from '../../ai/tools/matchMember'
import { createInviteForApps, type AppInvite } from '../../data/inviteForApps'
import { inviteMessage } from '../../lib/inviteMessage'
import { isPersonal } from '../../lib/model'
import { canManagePeople } from '../../lib/permissions'
import { toHash } from '../../lib/router'
import { useStore } from '../../store/useStore'
import type { Member } from '../../types'
import { Avatar, Button, Input, Popover, cn } from '../ui'
import { useUI } from '../uiState'

interface InviteOnAssign {
  projectId: string
  appName: string
}

interface InviteState {
  memberId: string
  name: string
  email: string | null
  status: 'loading' | 'ready' | 'error'
  invite?: AppInvite
  error?: string
}

export interface MemberPickerProps {
  value: string | null
  onChange: (memberId: string | null) => void | Promise<void>
  /** The element that opens the picker (a button). */
  trigger: ReactElement<{ onClick?: (e: React.MouseEvent<HTMLElement>) => void }>
  /** Label for the empty choice. */
  emptyLabel?: string
  align?: 'start' | 'end'
  suggestion?: OwnerSuggestion | null
  /** Suggestions stay visible to app owners, but only managers get the one-click assignment. */
  canAssignSuggestion?: boolean
  /** When present, assigning a placeholder creates an invite scoped to this app. */
  inviteOnAssign?: InviteOnAssign
  /**
   * False for a picker that only chooses among people who are already here (the Portfolio's owner filter): no
   * "Add" or "Invite" row, so it never creates anyone. Default true.
   */
  canAdd?: boolean
}

export interface InviteForm {
  name: string
  email: string
}

export interface InviteFormError {
  field: 'name' | 'email'
  message: string
}

export function memberChoiceLabel(member: Pick<Member, 'id' | 'name' | 'userId'>, selectedId: string | null, ownerChoice: boolean): string {
  return ownerChoice && !!member.userId && member.id !== selectedId ? `Make ${member.name} the owner` : member.name
}

export function needsOwnerInvite(member: Pick<Member, 'id' | 'userId'>, meId: string | null, ownerChoice: boolean): boolean {
  return ownerChoice && member.id !== meId && !member.userId
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

export const looksLikeEmail = (text: string) => EMAIL.test(text.trim())

/** The form starts from what was typed in the search: an email fills the email, anything else fills the name. */
export function inviteFormDefaults(search: string): InviteForm {
  const text = search.trim()
  return looksLikeEmail(text) ? { name: '', email: text } : { name: text, email: '' }
}

/** What stops the form from being sent, or null. The email is optional, but when it is there it has to be one. */
export function inviteFormError(form: InviteForm, members: Pick<Member, 'name' | 'email'>[]): InviteFormError | null {
  const email = form.email.trim()
  if (!form.name.trim()) return { field: 'name', message: 'Add their name.' }
  if (email && !looksLikeEmail(email)) return { field: 'email', message: "That email doesn't look right." }
  const taken = email ? members.find((member) => member.email?.trim().toLowerCase() === email.toLowerCase()) : null
  if (taken) return { field: 'email', message: `${taken.name} already has that email. Pick them from the list.` }
  return null
}

/** The last row of an owner picker in a team workspace. */
export function inviteRowLabel(search: string, exactMatch = false): string {
  const text = search.trim()
  return text && !exactMatch ? `Invite “${text}”` : 'Invite someone new'
}

/** The people a search shows. Owner pickers in a team also match an email. */
export function pickerList(members: Member[], search: string, value: string | null, meId: string | null, byEmail: boolean): Member[] {
  const needle = search.trim().toLowerCase()
  return members
    .filter((m) => m.active || m.id === value)
    .filter((m) => !needle || m.name.toLowerCase().includes(needle) || !!m.githubLogin?.toLowerCase().includes(needle) || (byEmail && !!m.email?.toLowerCase().includes(needle)))
    .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)))
}

interface AssignDeps {
  onChange: MemberPickerProps['onChange']
  inviteOnAssign?: InviteOnAssign
  meId: string | null
  /** Shows the invite step under the list; null clears it. */
  showInvite: (state: InviteState | null) => void
}

/**
 * Makes `id` the choice. An owner picker also makes the invite link when the person hasn't joined Tempo yet.
 * Resolves true when the invite step is showing, so the picker should stay open.
 */
export async function assignAndInvite(id: string | null, { onChange, inviteOnAssign, meId, showInvite }: AssignDeps): Promise<boolean> {
  await onChange(id)
  showInvite(null)
  const member = id ? useStore.getState().members.find((person) => person.id === id) : null
  if (!member || !inviteOnAssign || !needsOwnerInvite(member, meId, true)) return false
  const who = { memberId: member.id, name: member.name, email: member.email }
  showInvite({ ...who, status: 'loading' })
  try {
    const made = await createInviteForApps([inviteOnAssign.projectId], member.email)
    showInvite({ ...who, status: 'ready', invite: made })
  } catch (error) {
    showInvite({ ...who, status: 'error', error: error instanceof Error ? error.message : 'The owner changed, but Tempo could not make the invite link. Try again.' })
  }
  return true
}

/** The "Invite someone new" form, sent: adds the person, makes them the owner, then makes their invite link. */
export async function makeOwnerAndInvite(
  form: InviteForm,
  deps: AssignDeps & { members: Member[]; addMember: (person: Partial<Member> & { name: string }) => Member },
): Promise<{ error: InviteFormError } | { member: Member; kept: boolean }> {
  const error = inviteFormError(form, deps.members)
  if (error) return { error }
  const member = deps.addMember({ name: form.name.trim(), email: form.email.trim() || null, userId: null, active: true })
  return { member, kept: await assignAndInvite(member.id, deps) }
}

export function MemberPicker({ value, onChange, trigger, emptyLabel = 'Unassigned', align = 'start', suggestion, canAssignSuggestion = true, inviteOnAssign, canAdd = true }: MemberPickerProps) {
  return (
    <Popover trigger={trigger} align={align} role="listbox" className="w-72 p-1.5">
      {(close) => (
        <MemberPickerPanel
          value={value}
          onChange={onChange}
          emptyLabel={emptyLabel}
          suggestion={suggestion}
          canAssignSuggestion={canAssignSuggestion}
          inviteOnAssign={inviteOnAssign}
          canAdd={canAdd}
          close={close}
        />
      )}
    </Popover>
  )
}

export interface MemberPickerPanelProps extends Omit<MemberPickerProps, 'trigger' | 'align'> {
  close: () => void
  /** Where the panel starts (the tests render it already searched, or already on the form). */
  initialQuery?: string
  initialStep?: 'list' | 'invite'
}

/** What is inside the picker's popover. It lives only while the popover is open, so it starts fresh each time. */
export function MemberPickerPanel({ value, onChange, emptyLabel = 'Unassigned', suggestion, canAssignSuggestion = true, inviteOnAssign, canAdd = true, close, initialQuery = '', initialStep = 'list' }: MemberPickerPanelProps) {
  const members = useStore((s) => s.members)
  const meId = useStore((s) => s.meId)
  const addMember = useStore((s) => s.addMember)
  const workspace = useStore((s) => s.workspace)
  const me = useStore((s) => s.members.find((member) => member.id === s.meId) ?? null)
  const [q, setQ] = useState(initialQuery)
  const [step, setStep] = useState<'list' | 'invite'>(initialStep)
  const [form, setForm] = useState<InviteForm>(() => inviteFormDefaults(initialQuery))
  const [formError, setFormError] = useState<InviteFormError | null>(null)
  const [sending, setSending] = useState(false)
  const [invite, setInvite] = useState<InviteState | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const selectedOwner = members.find((member) => member.id === value) ?? null
  const reassign = !!suggestion && !!selectedOwner?.active && !!selectedOwner.userId && suggestion.memberId !== selectedOwner.id
  // An owner picker in a team workspace can bring in someone new. A personal workspace or a signed-out browser keeps
  // the plain "Add" row.
  const teamInvite = !!inviteOnAssign && !!workspace && !isPersonal(workspace)
  // In a workspace only owners and admins may add people (the database refuses anyone else), so the others never see
  // the Add or Invite rows. A signed-out browser keeps its local list.
  const mayAdd = canAdd && (!workspace || canManagePeople(me))
  const needle = q.trim().toLowerCase()

  const list = useMemo(() => pickerList(members, q, value, meId, teamInvite), [members, q, value, meId, teamInvite])
  const exact = members.some((m) => m.name.toLowerCase() === needle || (teamInvite && !!needle && m.email?.toLowerCase() === needle))

  // In a window, bring the popover into view: its body scrolls, so the picker could open below the fold.
  useEffect(() => {
    const panel = root.current?.parentElement
    if (panel?.closest('[aria-modal="true"]')) panel.scrollIntoView?.({ block: 'nearest' })
  }, [step, invite?.status])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      useUI.getState().notify(`${label} copied`, 'success')
    } catch {
      useUI.getState().notify(`Couldn't copy the ${label.toLowerCase()}. Select it instead.`, 'danger')
    }
  }

  const deps: AssignDeps = { onChange, inviteOnAssign, meId, showInvite: setInvite }
  const pick = async (id: string | null) => {
    const kept = await assignAndInvite(id, deps)
    setQ('')
    setStep('list')
    if (!kept) close()
  }
  const openForm = () => {
    setForm(inviteFormDefaults(q))
    setFormError(null)
    setStep('invite')
  }
  const back = () => {
    setStep('list')
    setFormError(null)
    requestAnimationFrame(() => search.current?.focus({ preventScroll: true }))
  }
  const sendForm = async () => {
    setSending(true)
    try {
      const sent = await makeOwnerAndInvite(form, { ...deps, members: useStore.getState().members, addMember })
      if ('error' in sent) return setFormError(sent.error)
      setQ('')
      setStep('list')
      if (!sent.kept) close()
    } finally {
      setSending(false)
    }
  }

  const acceptSuggestion = () => {
    if (!suggestion) return
    const existing = suggestion.memberId ? useStore.getState().members.find((member) => member.id === suggestion.memberId) : null
    const member = existing ?? addMember({
      name: suggestion.name,
      email: suggestion.email,
      githubLogin: suggestion.login,
      userId: null,
      active: true,
    })
    void pick(member.id)
  }
  const message = invite?.status === 'ready' && invite.invite ? inviteMessage({
    inviterName: me?.name || 'A teammate',
    inviteeName: invite.name,
    inviteeEmail: invite.email,
    workspaceName: workspace?.name || 'your workspace',
    appNames: inviteOnAssign ? [inviteOnAssign.appName] : [],
    url: invite.invite.url,
    expiresAt: invite.invite.expiresAt,
  }, Date.now()) : null

  return (
    <div
      ref={root}
      onKeyDown={(e) => {
        // Esc steps back from the form, or closes the picker. It stops here so a window around the picker stays open.
        if (e.key !== 'Escape') return
        e.stopPropagation()
        if (step === 'invite') back()
        else close()
      }}
    >
      {step === 'invite' ? (
        <form
          noValidate
          className="space-y-2.5 px-1 pb-1 pt-0.5"
          onSubmit={(e) => {
            e.preventDefault()
            void sendForm()
          }}
        >
          <div>
            <p className="text-sm font-medium text-text">Invite someone new</p>
            <p className="mt-0.5 text-xs leading-5 text-text-muted">They become the owner now. Tempo makes a link they use to join.</p>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Name</span>
            <Input
              size="sm"
              autoFocus={!form.name}
              value={form.name}
              invalid={formError?.field === 'name'}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Email <span className="font-normal text-text-faint">(optional)</span></span>
            <Input
              size="sm"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoFocus={!!form.name}
              value={form.email}
              invalid={formError?.field === 'email'}
              onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
            />
          </label>
          {formError && <p role="alert" className="text-xs leading-5 text-danger">{formError.message}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" variant="primary" loading={sending}>Make owner and invite</Button>
            <button type="button" onClick={back} className="focus-ring rounded-sm text-xs text-text-muted hover:text-text">Back</button>
          </div>
        </form>
      ) : (
        <>
          {suggestion && !q.trim() && (
            <div className="mb-1.5 rounded-md border border-border bg-surface px-2.5 py-2">
              <p className="text-xs leading-5 text-text-muted">
                {reassign ? <>
                  <span className="font-medium text-text">{suggestion.name}</span> made{' '}
                  <span className="tabular-nums">{suggestion.share}%</span> of commits since {suggestionSinceLabel(suggestion.since)}. Make them the owner?
                </> : <>
                  Suggested: <span className="font-medium text-text">{suggestion.name}</span>,{' '}
                  <span className="tabular-nums">{suggestion.share}%</span> of commits since {suggestionSinceLabel(suggestion.since)}.
                </>}
              </p>
              {canAssignSuggestion && !suggestion.memberId && <p className="mt-1 text-xs leading-5 text-text-muted">{suggestion.name} isn't in Tempo yet. Assigning them makes their invite link.</p>}
              {canAssignSuggestion && suggestion.memberId && members.find((member) => member.id === suggestion.memberId)?.userId === null && suggestion.memberId !== meId && (
                <p className="mt-1 text-xs leading-5 text-text-muted">{suggestion.name} hasn't joined Tempo yet. Assigning them makes their invite link.</p>
              )}
              {canAssignSuggestion && <Button size="sm" variant="secondary" className="mt-2" onClick={acceptSuggestion}>{reassign ? `Make ${suggestion.name.split(/\s+/)[0]} the owner` : `Assign ${suggestion.name.split(/\s+/)[0]}`}</Button>}
            </div>
          )}
          <Input
            ref={search}
            size="sm"
            autoFocus
            placeholder={teamInvite ? 'Search by name or email…' : 'Search people…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={teamInvite ? 'Search by name or email' : 'Search people'}
          />
          <ul className="mt-1.5 max-h-64 overflow-y-auto">
            <Row onClick={() => void pick(null)} selected={value === null}>
              <span className="grid size-[22px] place-items-center rounded-full border border-dashed border-border-strong text-text-faint">
                <UserMinus className="size-3" aria-hidden />
              </span>
              {emptyLabel}
            </Row>
            {list.map((m) => (
              <Row key={m.id} onClick={() => void pick(m.id)} selected={m.id === value}>
                <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {memberChoiceLabel(m, value, !!inviteOnAssign)}
                  {m.id === meId && m.name !== 'You' && <span className="text-text-muted"> (you)</span>}
                  {!m.active && <span className="text-text-muted"> · left</span>}
                  {m.active && !m.userId && m.id !== meId && <span className="text-text-muted"> · invite pending</span>}
                  {teamInvite && needle && !m.name.toLowerCase().includes(needle) && !!m.email?.toLowerCase().includes(needle) && <span className="text-text-muted"> · {m.email}</span>}
                </span>
              </Row>
            ))}
            {mayAdd && !teamInvite && q.trim() && !exact && (
              <Row onClick={() => void pick(addMember({ name: q.trim() }).id)} selected={false}>
                <span className="grid size-[22px] place-items-center rounded-full bg-accent-soft text-accent">
                  <Plus className="size-3" aria-hidden />
                </span>
                <span className="truncate">Add “{q.trim()}”</span>
              </Row>
            )}
          </ul>
          {mayAdd && teamInvite && (
            <ul className="mt-1 border-t border-border pt-1">
              <Row onClick={openForm} selected={false}>
                <span className="grid size-[22px] place-items-center rounded-full bg-accent-soft text-accent">
                  <UserPlus className="size-3" aria-hidden />
                </span>
                <span className="truncate">{inviteRowLabel(q, exact)}</span>
              </Row>
            </ul>
          )}
        </>
      )}
      {invite && (
        <div className="mt-2 border-t border-border px-1 pt-2" aria-live="polite">
          {invite.status === 'loading' && <p className="text-xs text-text-muted">Making {invite.name}'s invite link…</p>}
          {invite.status === 'error' && (
            <div className="space-y-1.5">
              <p className="text-xs leading-5 text-danger">{invite.error}</p>
              {!workspace ? (
                <a href={toHash({ name: 'login' })} className="focus-ring inline-block rounded-sm text-xs font-medium text-accent hover:underline">Sign in to invite</a>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void pick(invite.memberId)}>Try again</Button>
              )}
            </div>
          )}
          {invite.status === 'ready' && invite.invite && message && (
            <div className="space-y-2">
              <p className="text-xs leading-5 text-text-muted">{invite.name}'s invite is ready to send.</p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => {
                  if (message.mailtoUrl) window.location.href = message.mailtoUrl
                  else void copy(`Subject: ${message.subject}\n\n${message.emailBody}`, 'Email text')
                }}>Send by email</Button>
                <Button size="sm" variant="ghost" onClick={() => void copy(message.slackMessage, 'Slack message')}>Copy for Slack</Button>
                <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy(invite.invite!.url, 'Link')}>Copy link</Button>
              </div>
              <button type="button" onClick={close} className="focus-ring rounded-sm text-xs text-text-muted hover:text-text">Done</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ children, onClick, selected }: { children: React.ReactNode; onClick: () => void; selected: boolean }) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onClick}
        className={cn('focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-surface-2', selected && 'bg-surface-2')}
      >
        {children}
        {selected && <Check className="ml-auto size-3.5 shrink-0 text-accent" aria-hidden />}
      </button>
    </li>
  )
}
