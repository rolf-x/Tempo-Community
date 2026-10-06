import { useEffect, useState } from 'react'
import { Building2, Check, ChevronDown, Copy, Ellipsis, Link2, LogOut, UserPlus } from 'lucide-react'
import type { Member } from '../../types'
import { createInvite, listInvites, removeMember, renameWorkspace, revokeInvite, setMemberAdmin, upgradeToOrg as convertToOrg, type InviteLink } from '../../data/workspace'
import { inviteMessage } from '../../lib/inviteMessage'
import { inviteAnswerSummary, inviteListStatus, invitePersonName, inviteReminderText, type WorkspaceInvite } from '../../lib/invites'
import { addDays, isValidISODate, todayISO } from '../../lib/dates'
import { toHash } from '../../lib/router'
import { isPersonal } from '../../lib/model'
import { canManagePeople } from '../../lib/permissions'
import { signOutToHome, useSession } from '../../data/session'
import { useStore } from '../../store/useStore'
import { Avatar, Button, IconButton, Input, Modal, Popover, cn } from '../ui'
import { useUI } from '../uiState'
import { DeparturePanel, leavingDateLabel } from '../people/DeparturePanel'
import { Field, Section } from './Section'

const dateLabel = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export const isInviteEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

export function WorkspaceCard() {
  const workspace = useStore((s) => s.workspace)
  const members = useStore((s) => s.members)
  const projects = useStore((s) => s.projects)
  const meId = useStore((s) => s.meId)
  const addMember = useStore((s) => s.addMember)
  const setMemberLeavingOn = useStore((s) => s.setMemberLeavingOn)
  const me = members.find((m) => m.id === meId) ?? null
  const isOwner = me?.role === 'owner'
  // Outside a shared workspace (dev guest mode) everything stays local and open.
  const manager = !workspace || canManagePeople(me)
  const user = useSession((s) => (s.status === 'signed-in' ? s.user : null))
  const personal = isPersonal(workspace)

  const [name, setName] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [inviteInput, setInviteInput] = useState('')
  const [removing, setRemoving] = useState<Member | null>(null)
  const [revoking, setRevoking] = useState<WorkspaceInvite | null>(null)
  const [invite, setInvite] = useState<(InviteLink & { email: string; appIds: string[]; appNames: string[]; inviteeName: string | null }) | null>(null)
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const commitName = () => {
    const v = (name ?? '').trim()
    setNameError(null)
    if (workspace && v && v !== workspace.name)
      void renameWorkspace(v).catch((e) => setNameError(e instanceof Error ? e.message : "Tempo couldn't rename the workspace. Try again."))
    setName(null)
  }
  const refreshInvites = async () => {
    if (!workspace || !manager) return
    setInvitesLoading(true)
    setInvitesError(null)
    try {
      setInvites(await listInvites())
    } catch (e) {
      setInvitesError(e instanceof Error ? e.message : 'Tempo could not load the invites. Try again.')
    } finally {
      setInvitesLoading(false)
    }
  }
  useEffect(() => {
    void refreshInvites()
  // The workspace id and permission are the only inputs that change which invite list is visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, workspace?.id])

  const makeInvite = async (previous?: WorkspaceInvite, email?: string) => {
    setInviting(true)
    setInviteError(null)
    setInvite(null)
    try {
      const recipient = previous?.email ?? email?.trim() ?? ''
      const appIds = previous?.appIds ?? []
      const made = await createInvite(recipient || null, appIds)
      setInvite({
        ...made,
        email: recipient,
        appIds,
        appNames: previous?.apps.map((app) => app.name) ?? [],
        inviteeName: previous ? messageName(previous) : null,
      })
      await refreshInvites()
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Tempo couldn't create an invite link. Try again.")
    } finally {
      setInviting(false)
    }
  }
  const message = () => invite && inviteMessage({
    inviterName: me?.name || user?.name || 'A teammate',
    inviteeName: invite.inviteeName,
    inviteeEmail: invite.email,
    workspaceName: workspace?.name || 'your workspace',
    appNames: invite.appNames,
    url: invite.url,
    expiresAt: invite.expiresAt,
  }, Date.now())
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      useUI.getState().notify(`${label} copied`, 'success')
    } catch {
      useUI.getState().notify('Couldn’t copy. Select the link instead.', 'danger')
    }
  }
  const makeMemberInvite = async (member: Member, appIds: string[], appNames: string[]) => {
    setInviting(true)
    setInviteError(null)
    try {
      const made = await createInvite(member.email, appIds)
      setInvite({ ...made, email: member.email ?? '', appIds, appNames, inviteeName: member.name })
      await copy(made.url, 'Link')
      await refreshInvites()
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Tempo couldn't create an invite link. Try again.")
    } finally {
      setInviting(false)
    }
  }
  const sendEmail = () => {
    const draft = message()
    if (!draft) return
    if (draft.mailtoUrl) window.location.href = draft.mailtoUrl
    else useUI.getState().notify('This invite is too long for a mail link. Use Copy email text.', 'danger')
  }
  const confirmRemove = async () => {
    if (!removing) return
    const m = removing
    setRemoving(null)
    try {
      await removeMember(m.id)
    } catch (e) {
      useUI.getState().notify(e instanceof Error ? e.message : 'Couldn’t remove that person.', 'danger')
    }
  }
  const confirmRevoke = async () => {
    if (!revoking) return
    const item = revoking
    setRevoking(null)
    try {
      await revokeInvite(item.token)
      setInvites((current) => current.filter((inviteItem) => inviteItem.id !== item.id))
      useUI.getState().notify('Invite revoked', 'success')
    } catch (e) {
      useUI.getState().notify(e instanceof Error ? e.message : 'Couldn’t revoke that invite.', 'danger')
    }
  }

  const toggleAdmin = async (m: Member) => {
    try {
      await setMemberAdmin(m.id, !m.isAdmin)
      useUI.getState().notify(m.isAdmin ? `${m.name} is no longer an admin` : `${m.name} is now an admin`, 'success')
    } catch (e) {
      useUI.getState().notify(e instanceof Error ? e.message : 'Couldn’t change their role.', 'danger')
    }
  }

  // One field: empty makes the reusable team link, an email makes a personal link, a name adds a placeholder person.
  const invitePerson = () => {
    const value = inviteInput.trim()
    if (!value) {
      void makeInvite()
      return
    }
    if (isInviteEmail(value)) {
      void makeInvite(undefined, value)
      return
    }
    addMember({ name: value })
    setInviteInput('')
  }

  const hasLeft = members.some((m) => !m.active)

  return (
    <Section title="Workspace" description={personal ? 'Your personal workspace.' : 'The people who own and work on your apps.'}>
      {user && (
        <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
          <Avatar name={user.name} src={user.avatarUrl ?? undefined} size="sm" />
          <p className="min-w-0 flex-1 truncate text-sm text-text-muted">
            Signed in as <span className="font-medium text-text">{user.githubLogin ?? user.email ?? user.name}</span>
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon={LogOut}
            onClick={() => void signOutToHome()}
          >
            Sign out
          </Button>
        </div>
      )}
      <Field label="Name" htmlFor="ws-name">
        {workspace && (isOwner || !me) ? (
          <>
            <Input
              id="ws-name"
              value={name ?? workspace.name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {nameError && <p role="alert" className="mt-1.5 text-sm text-danger">{nameError}</p>}
          </>
        ) : workspace ? (
          <p id="ws-name" className="text-sm text-text">
            {workspace.name} <span className="text-text-muted">· only the owner can rename it</span>
          </p>
        ) : (
          <p id="ws-name" className="text-sm text-text">Local workspace (this browser)</p>
        )}
      </Field>

      {personal ? (
        <CreateOrganization />
      ) : (<>
      <div>
        <div className="mb-1.5 text-xs font-medium text-text-muted">Members</div>
        {workspace && !personal && <p className="mb-2 text-xs text-text-muted">The owner and admins invite people and edit every app. Members edit the apps they own.</p>}
        <ul className="space-y-1">
          {members.map((m) => {
            const ownedApps = projects.filter((project) => project.ownerId === m.id && !project.archived)
            return (
            <li key={m.id} className="flex min-h-10 min-w-0 items-center gap-3 rounded-md px-1 py-1.5">
              <Avatar name={m.name} src={m.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', m.active ? 'text-text' : 'text-text-muted')}>{m.name}</span>
                {m.githubLogin && <span className="block truncate text-xs text-text-muted">@{m.githubLogin}</span>}
                {m.active && m.leavingOn && <span className="block truncate text-xs text-text-muted">Leaves {leavingDateLabel(m.leavingOn)}</span>}
              </span>
              {!m.active && <span className="inline-flex h-5 items-center rounded-full bg-surface-2 px-2 text-xs font-medium text-text-muted">Left</span>}
              {isOwner && workspace && m.active && m.role !== 'owner' && m.userId ? (
                <Popover
                  align="end"
                  role="menu"
                  className="w-72"
                  trigger={
                    <button
                      type="button"
                      className="focus-ring inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2 text-xs font-medium text-text-muted hover:bg-surface-3 hover:text-text"
                      aria-label={`Change ${m.name}'s role, currently ${m.isAdmin ? 'Admin' : 'Member'}`}
                    >
                      {m.isAdmin ? 'Admin' : 'Member'}
                      <ChevronDown className="size-3" aria-hidden />
                    </button>
                  }
                >
                  {(close) => (
                    <div>
                      {([
                        { admin: false, label: 'Member', description: 'Edits the apps they own and sees the rest' },
                        { admin: true, label: 'Admin', description: 'Invites people and edits every app' },
                      ] as const).map((option) => {
                        const current = !!m.isAdmin === option.admin
                        return (
                          <button
                            key={option.label}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              close()
                              if (!current) void toggleAdmin(m)
                            }}
                            className="focus-ring flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-3"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-text">{option.label}</span>
                              <span className="mt-0.5 block text-xs leading-4 text-text-muted">{option.description}</span>
                            </span>
                            {current && <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-label="Current role" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Popover>
              ) : (
                <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-xs font-medium text-text-muted">
                  {m.role === 'owner' ? 'Owner' : m.userId && m.isAdmin ? 'Admin' : 'Member'}
                </span>
              )}
              {manager && !m.active ? (
                <Button size="sm" variant="secondary" loading={inviting} onClick={() => void makeMemberInvite(m, [], [])}>
                  Invite again
                </Button>
              ) : manager && m.active && m.id !== meId && m.role !== 'owner' ? (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {!m.userId && ownedApps.length >= 2 && (
                    <Button size="sm" variant="secondary" loading={inviting} onClick={() => void makeMemberInvite(m, ownedApps.map((app) => app.id), ownedApps.map((app) => app.name))}>
                      Invite for all {m.name}'s apps
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`}>
                    Remove
                  </Button>
                </div>
              ) : (
                <span className="w-[62px]" aria-hidden />
              )}
              {manager && m.active && (
                <MemberLeavingMenu member={m} onSetLeavingOn={setMemberLeavingOn} />
              )}
            </li>
            )
          })}
        </ul>
        {hasLeft && <p className="mt-1.5 text-xs text-text-muted">Their apps show as “Owner has left”.</p>}
        <div className="mt-3 space-y-3">
          {members.filter((member) => member.active && member.leavingOn).map((member) => <DeparturePanel key={member.id} memberId={member.id} />)}
        </div>
      </div>

      {manager && (<>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          invitePerson()
        }}
      >
        <Input value={inviteInput} onChange={(e) => setInviteInput(e.target.value)} placeholder="Name or email (optional)" aria-label="Name or email" />
        <Button type="submit" variant={invite ? 'secondary' : 'primary'} icon={inviteInput.trim() ? UserPlus : Link2} loading={inviting}>
          {inviteInput.trim() ? 'Invite' : 'Invite link'}
        </Button>
      </form>

      <div>
        {inviteError && (
          <p className="mt-2 text-sm text-danger">
            {inviteError}{' '}
            <a href={toHash({ name: 'login' })} className="focus-ring rounded-sm underline">
              Sign in
            </a>
          </p>
        )}
        {invite && (
          <div className="mt-2 space-y-2">
            <Input readOnly value={invite.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={sendEmail}>Send by email</Button>
              <Button variant="secondary" onClick={() => { const draft = message(); if (draft) void copy(draft.slackMessage, 'Slack message') }}>Copy for Slack</Button>
              <Button variant="secondary" icon={Copy} onClick={() => void copy(invite.url, 'Link')}>Copy link</Button>
            </div>
            <button type="button" className="focus-ring rounded-sm text-xs text-text-muted underline underline-offset-2 hover:text-text" onClick={() => {
              const draft = message()
              if (draft) void copy(`Subject: ${draft.subject}\n\n${draft.emailBody}`, 'Email text')
            }}>Copy email text</button>
            <p className="text-xs text-text-muted">Tempo doesn't send email for you yet.</p>
            <p className="text-xs text-text-muted">Send by email opens your own mail app.</p>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-text-muted">Invites</span>
          <Button size="sm" variant="ghost" loading={invitesLoading} onClick={() => void refreshInvites()}>Refresh</Button>
        </div>
        {invitesError && <p className="mb-2 text-sm text-danger" role="alert">{invitesError}</p>}
        {!invitesLoading && !invitesError && invites.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-text-muted">No invites yet.</p>
        )}
        {invites.length > 0 && (
          <ul className="space-y-2">
            {invites.map((item) => {
              const now = Date.now()
              const baseState = inviteListStatus(item, now)
              const answer = inviteAnswerSummary(item, projects, members)
              const state = answer?.label ?? baseState
              const reminder = inviteReminderText(item, now)
              const when = baseState === 'Joined'
                ? item.usedAt!
                : baseState === 'Declined'
                  ? item.declinedAt ?? item.usedAt ?? item.createdAt
                  : baseState === 'Expired'
                    ? item.expiresAt
                    : item.createdAt
              return (
                <li key={item.id} className="min-w-0 rounded-lg border border-border px-3 py-3">
                  <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{invitePersonName(item)}</span>
                      {item.email && <span className="block truncate text-xs text-text-muted">{item.email}</span>}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text">{state}</span>
                    <span className="w-full text-xs text-text-muted sm:w-auto">{dateLabel(when)}</span>
                  </div>
                  {item.apps.length > 0 && (
                    <p className="mt-2 text-xs leading-5 text-text-muted">{item.apps.map((app) => app.name).join(', ')}</p>
                  )}
                  {answer?.derivable && answer.declinedApps.length > 0 && (
                    <p className="mt-2 text-xs leading-5 text-text-muted">Declined: {answer.declinedApps.join(', ')}</p>
                  )}
                  {answer && !answer.derivable && (
                    <p className="mt-2 text-xs leading-5 text-text-muted">Current ownership cannot reliably show which apps were declined.</p>
                  )}
                  {item.declineNote && (
                    <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-2 text-xs leading-5 text-text">
                      Not mine: {item.declineNote}
                    </p>
                  )}
                  {reminder && <p className="mt-2 text-xs font-medium text-text">{reminder}</p>}
                  <div className="mt-2">
                    {baseState === 'Sent' && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setInvite({
                          url: item.url,
                          expiresAt: item.expiresAt,
                          email: item.email ?? '',
                          appIds: item.appIds,
                          appNames: item.apps.map((app) => app.name),
                          inviteeName: messageName(item),
                        })}>
                          Send it again
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setRevoking(item)}>Revoke</Button>
                      </div>
                    )}
                    {baseState === 'Expired' && (
                      <Button size="sm" variant="secondary" loading={inviting} onClick={() => void makeInvite(item)}>
                        Make a new link
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </>)}
      {!manager && <p className="text-xs text-text-muted">Only the owner and admins can invite or remove people.</p>}
      </>)}

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ''}?`}
        description="They lose access to the workspace. Their apps show as “Owner has left”."
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" icon={Check} onClick={() => void confirmRemove()}>
              Remove
            </Button>
          </>
        }
      >
        {null}
      </Modal>
      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this invite?"
        description="This link will stop working. You can make a fresh one later."
        footer={<>
          <Button onClick={() => setRevoking(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirmRevoke()}>Revoke invite</Button>
        </>}
      >
        {null}
      </Modal>
    </Section>
  )
}

function MemberLeavingMenu({ member, onSetLeavingOn }: { member: Member; onSetLeavingOn: (memberId: string, leavingOn: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    setEditing(false)
    setError(null)
  }
  const edit = () => {
    setDate(member.leavingOn ?? '')
    setEditing(true)
    setError(null)
  }
  const save = () => {
    if (!isValidISODate(date) || date <= todayISO()) {
      setError('Choose a date after today.')
      return
    }
    onSetLeavingOn(member.id, date)
    close()
  }

  return (
    <Popover
      align="end"
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setEditing(false)
          setError(null)
        }
      }}
      className={editing ? 'w-64 p-3' : 'w-48'}
      trigger={<IconButton icon={Ellipsis} label={`More for ${member.name}`} size="sm" />}
    >
      {editing ? (
        <form onSubmit={(event) => { event.preventDefault(); save() }}>
          <label htmlFor={`leaving-date-${member.id}`} className="mb-1.5 block text-xs font-medium text-text-muted">Leaving date</label>
          <Input
            id={`leaving-date-${member.id}`}
            type="date"
            size="sm"
            required
            min={addDays(todayISO(), 1)}
            value={date}
            onChange={(event) => { setDate(event.target.value); setError(null) }}
            invalid={!!error}
            className="w-full"
          />
          {error && <p className="mt-1.5 text-xs text-danger" role="alert">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" size="sm" variant="secondary">Save</Button>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" variant="ghost" block className="justify-start" onClick={edit}>Set leaving date</Button>
          {member.leavingOn && (
            <Button size="sm" variant="ghost" block className="justify-start" onClick={() => { onSetLeavingOn(member.id, null); close() }}>
              Clear leaving date
            </Button>
          )}
        </div>
      )}
    </Popover>
  )
}

/** A personal workspace can become an organization so people and ownership are shared. */
function CreateOrganization() {
  const workspace = useStore((s) => s.workspace)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await convertToOrg(name.trim() || workspace?.name || 'My team')
      useUI.getState().notify('You’re now an organization. Invite your team below.', 'success')
    } catch (e) {
      useUI.getState().notify(e instanceof Error ? e.message : 'Couldn’t create the organization.', 'danger')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-dashed border-border-strong p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-text">
        <Building2 className="size-4 text-accent" aria-hidden /> Working with others?
      </p>
      <p className="mt-1 text-sm text-text-muted">Turn this into an organization to invite people and assign app owners. Your apps stay as they are.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" aria-label="Organization name" maxLength={80} />
        <Button type="submit" loading={busy}>
          Create organization
        </Button>
      </form>
    </div>
  )
}

/** The name to greet in an invite message: none for the reusable team link. */
function messageName(invite: Parameters<typeof invitePersonName>[0]): string | null {
  const name = invitePersonName(invite)
  return name === 'Team link' ? null : name
}
