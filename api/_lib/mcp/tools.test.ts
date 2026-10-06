import { describe, expect, it, vi } from 'vitest'
import type { Activity, AppTask, Member, Project } from '../../../src/types'
import { ToolError, type AppDetail, type TempoData, type WorkspaceApps } from './data'
import { AppIdsInput, CardsInput, HEALTH_KINDS, MAX_BATCH, TasksInput, findApp, getApp, getApps, listApps, normaliseRepo, submitAppCard, submitAppCards, submitHandover, submitTasks, type ToolContext } from './tools'

const NOW = new Date('2026-10-05T10:00:00Z')
const member = (id: string, name: string, patch: Partial<Member> = {}): Member => ({
  id, name, email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', isAdmin: false, active: true, leavingOn: null, ...patch,
})
const app = (id: string, name: string, patch: Partial<Project> = {}): Project => ({
  id, name, emoji: '📦', color: 'blue', description: '', createdAt: '2026-09-01T00:00:00Z', archived: false,
  ownerId: 'm_ann', repo: { fullName: 'acme/billing', url: 'https://github.com/acme/billing', private: true, defaultBranch: 'main' },
  signals: { hasReadme: true, secretFiles: [], lastCommitAt: '2026-10-04T00:00:00Z', openIssues: 1, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' },
  appCard: null, lastActivityAt: '2026-10-04T00:00:00Z', autoApply: false, ...patch,
} as Project)

const members = [member('m_ann', 'Ann'), member('m_bo', 'Bo', { active: false })]
const workspace: WorkspaceApps = {
  workspace: { id: 'ws1', name: 'Acme', kind: 'org' },
  me: 'm_ann',
  members,
  apps: [
    app('p_bill', 'Billing'),
    app('p_old', 'Old thing', { archived: true }),
    app('p_orph', 'Orphan', { ownerId: 'm_bo', repo: { fullName: 'acme/orphan', url: 'https://github.com/acme/orphan', private: true, defaultBranch: 'main' } }),
  ],
}
const activity: Activity[] = [
  { id: 'a1', projectId: 'p_bill', kind: 'commit', actor: 'Ann', title: 'Rotated STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwx', url: null, at: '2026-10-04T09:00:00Z' },
]
const detail = (patch: Partial<Project> = {}): AppDetail => ({ workspace: workspace.workspace, me: 'm_ann', members, app: app('p_bill', 'Billing', patch), activity })

function fakeData(over: Partial<TempoData> = {}): TempoData {
  return {
    listApps: vi.fn(async () => [workspace]),
    getApp: vi.fn(async () => detail()),
    submitCard: vi.fn(async () => undefined),
    submitHandover: vi.fn(async () => undefined),
    submitTasks: vi.fn(async () => undefined),
    ...over,
  }
}
const task = (id: string, problem: AppTask['problem'], patch: Partial<AppTask> = {}): AppTask => ({
  id, problem, title: `Task ${id}`, detail: null, createdAt: '2026-10-05T09:00:00Z',
  draftedBy: { client: 'Claude Code', clientId: 'c1', memberId: 'm_ann', at: '2026-10-05T09:00:00Z' }, fixedAt: null, ...patch,
})
const ctx = (data: TempoData): ToolContext => ({ data, client: 'Claude Code', baseUrl: 'https://tempo.test', now: () => NOW })

describe('normaliseRepo', () => {
  it.each([
    ['git@github.com:Acme/Billing.git', 'acme/billing'],
    ['https://github.com/acme/billing', 'acme/billing'],
    ['https://github.com/acme/billing.git/', 'acme/billing'],
    ['acme/billing', 'acme/billing'],
    ['billing', null],
  ])('%s → %s', (input, out) => expect(normaliseRepo(input)).toBe(out))
})

describe('list_apps', () => {
  it('lists live apps with owner, card state and health, and skips archived ones', async () => {
    const out = await listApps(ctx(fakeData()))
    expect(out.apps.map((a) => a.id)).toEqual(['p_bill', 'p_orph'])
    expect(out.apps[0]).toMatchObject({ name: 'Billing', workspace: 'Acme', repo: 'acme/billing', owner: 'Ann', card: 'none' })
    expect(out.apps[1].health.join(' ')).toMatch(/left/i)
    expect(out.reviewUrl).toBe('https://tempo.test/#/review')
  })
  it('says which apps still need a card and how many tasks are open', async () => {
    const withTasks: WorkspaceApps = {
      ...workspace,
      apps: [
        app('p_bill', 'Billing', { appCard: { what: 'w', who: 'u', stage: 'live', status: 's', updatedAt: '2026-10-04T12:00:00Z', source: 'ai', checkedAt: null } }),
        // Open: its flag (owner has left) is still on. Fixed on the page: the flag is gone. Fixed in the data: fixedAt is set.
        app('p_orph', 'Orphan', { ownerId: 'm_bo', tasks: [task('t1', 'owner-left'), task('t2', 'no-readme'), task('t3', 'owner-left', { fixedAt: '2026-10-05T10:00:00Z' })] }),
        app('p_fact', 'Facts only', { appCard: { what: 'w', who: 'u', stage: 'live', status: 's', updatedAt: '2026-10-04T12:00:00Z', source: 'fallback', checkedAt: null } }),
      ],
    }
    const out = await listApps(ctx(fakeData({ listApps: vi.fn(async () => [withTasks]) })))
    // Ann (a plain member) owns Billing and Facts only; Orphan is Bo's, so she can't edit it and Claude isn't asked for its card.
    expect(out.apps.map((a) => [a.id, a.canEdit, a.needsCard, a.openTasks])).toEqual([['p_bill', true, false, 0], ['p_orph', false, false, 1], ['p_fact', true, true, 0]])
  })
})

describe('find_app', () => {
  it('matches a git remote to the app', async () => {
    expect((await findApp(ctx(fakeData()), { repo: 'git@github.com:ACME/billing.git' })).matches.map((a) => a.id)).toEqual(['p_bill'])
  })
  it('matches part of a name', async () => {
    expect((await findApp(ctx(fakeData()), { name: 'orph' })).matches.map((a) => a.id)).toEqual(['p_orph'])
  })
  it('says how to add an app when nothing matches', async () => {
    const out = await findApp(ctx(fakeData()), { repo: 'acme/unknown' })
    expect(out.matches).toEqual([])
    expect(out.hint).toMatch(/Tempo/)
  })
})

describe('get_app', () => {
  it('returns the app with health, recent activity and owner, with secrets redacted', async () => {
    const out = await getApp(ctx(fakeData()), { appId: 'p_bill' })
    expect(out).toMatchObject({ id: 'p_bill', owner: 'Ann', repo: 'acme/billing' })
    expect(out.recentActivity).toHaveLength(1)
    expect(JSON.stringify(out)).not.toContain('sk_live_abcdefghijklmnopqrstuvwx')
  })
  it('leaves out entries of a kind Tempo no longer has, which rows saved before the removal can still carry', async () => {
    const old = { ...activity[0], id: 'a0', kind: 'heartbeat' as Activity['kind'], title: 'Shipped it' }
    const out = await getApp(ctx(fakeData({ getApp: vi.fn(async () => ({ ...detail(), activity: [old, ...activity] })) })), { appId: 'p_bill' })
    expect(out.recentActivity.map((a) => a.kind)).toEqual(['commit'])
  })
  it('names each flag by kind, and lists only the open tasks', async () => {
    const out = await getApp(ctx(fakeData({ getApp: vi.fn(async () => detail({
      ownerId: null,
      repo: { fullName: 'acme/billing', url: 'https://github.com/acme/billing', private: false, defaultBranch: 'main' },
      tasks: [
        task('t1', 'no-owner', { title: 'Pick an owner', detail: 'Ask Ann.' }),
        task('t2', 'public-repo', { fixedAt: '2026-10-05T10:00:00Z' }),
        task('t3', 'no-readme'),
      ],
    })) })), { appId: 'p_bill' })
    expect(out.healthDetail.map((f) => [f.kind, f.label])).toEqual([['no-owner', 'No owner'], ['public-repo', 'Public repo']])
    expect(out.tasks).toEqual([{ problem: 'no-owner', title: 'Pick an owner', detail: 'Ask Ann.' }])
    // No owner: only an admin may edit it, and Ann is a plain member.
    expect(out).toMatchObject({ canEdit: false, needsCard: false, openTasks: 1 })
  })
  it('has an empty tasks list when the app has none', async () => {
    expect((await getApp(ctx(fakeData()), { appId: 'p_bill' })).tasks).toEqual([])
  })
})

describe('submit_app_card', () => {
  it('cleans the draft and sends it with the client name', async () => {
    const data = fakeData()
    const out = await submitAppCard(ctx(data), {
      appId: 'p_bill', what: 'Bills customers. [Pay](https://evil.example)', who: 'Finance', stage: 'live', status: 'Shipped v2.',
    })
    expect(data.submitCard).toHaveBeenCalledWith('p_bill', { what: 'Bills customers. Pay', who: 'Finance', stage: 'live', status: 'Shipped v2.' }, 'Claude Code')
    expect(out.message).toMatch(/draft/i)
    expect(out.reviewUrl).toBe('https://tempo.test/#/review')
  })
})

describe('submit_handover', () => {
  it("keeps only links into the app's own repo", async () => {
    const data = fakeData()
    await submitHandover(ctx(data), {
      appId: 'p_bill', summary: 'Bills customers.', howToRun: ['npm run dev'], whereThingsAre: [], risks: [], contacts: [], unknowns: [],
      openWork: [
        { title: 'Fix invoices', evidenceUrl: 'https://github.com/acme/billing/issues/4' },
        { title: 'Phish', evidenceUrl: 'https://evil.example/login' },
      ],
    })
    const doc = vi.mocked(data.submitHandover).mock.calls[0][1]
    expect(doc.openWork).toEqual([{ title: 'Fix invoices', evidenceUrl: 'https://github.com/acme/billing/issues/4' }, { title: 'Phish' }])
  })
})

describe('submit_tasks', () => {
  const flagged = (patch: Partial<Project> = {}) => fakeData({ getApp: vi.fn(async () => detail({ ownerId: null, signals: { hasReadme: false, secretFiles: [], lastCommitAt: '2026-10-04T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' }, ...patch })) })

  it('cleans the tasks and sends them with the client name', async () => {
    const data = flagged()
    const out = await submitTasks(ctx(data), { appId: 'p_bill', tasks: [
      { problem: 'no-owner', title: 'Assign [Ann](https://evil.example) as owner', detail: 'She wrote most of src/.' },
      { problem: 'no-readme', title: 'Add a README', detail: null },
      { problem: 'no-readme', title: 'add a readme' },
    ] })
    expect(data.submitTasks).toHaveBeenCalledWith('p_bill', [
      { problem: 'no-owner', title: 'Assign Ann as owner', detail: 'She wrote most of src/.' },
      { problem: 'no-readme', title: 'Add a README', detail: null },
    ], 'Claude Code')
    expect(out.message).toBe('Added 2 tasks to Billing in Tempo. Each closes on its own once Tempo sees the problem fixed.')
    expect(out.appUrl).toBe('https://tempo.test/#/app/p_bill')
  })

  it('says it in the singular for one task', async () => {
    const out = await submitTasks(ctx(flagged()), { appId: 'p_bill', tasks: [{ problem: 'no-readme', title: 'Add a README' }] })
    expect(out.message).toBe('Added 1 task to Billing in Tempo. It closes on its own once Tempo sees the problem fixed.')
  })

  it('refuses a problem the app is not flagged for, and names the ones it is', async () => {
    const data = flagged()
    await expect(submitTasks(ctx(data), { appId: 'p_bill', tasks: [{ problem: 'no-readme', title: 'a' }, { problem: 'stale', title: 'Archive it' }] }))
      .rejects.toThrow(/does not flag stale.*no-owner \(No owner\), no-readme \(No README\)/)
    expect(data.submitTasks).not.toHaveBeenCalled()
  })

  it('refuses every task on an app with no flags, and says so', async () => {
    const data = fakeData()
    await expect(submitTasks(ctx(data), { appId: 'p_bill', tasks: [{ problem: 'secrets', title: 'Rotate keys' }] })).rejects.toThrow(/Flagged now: none/)
    expect(data.submitTasks).not.toHaveBeenCalled()
  })

  it('clears the open tasks with an empty list, even on an app with no flags', async () => {
    const data = fakeData()
    const out = await submitTasks(ctx(data), { appId: 'p_bill', tasks: [] })
    expect(data.submitTasks).toHaveBeenCalledWith('p_bill', [], 'Claude Code')
    expect(out.message).toBe('Cleared the open tasks on Billing in Tempo.')
  })

  it('refuses tasks that are all empty rather than clearing the list', async () => {
    const data = flagged()
    await expect(submitTasks(ctx(data), { appId: 'p_bill', tasks: [{ problem: 'no-readme', title: ' \u200b ' }] })).rejects.toThrow(/needs a title/)
    expect(data.submitTasks).not.toHaveBeenCalled()
  })

  it('refuses more than three tasks for one problem', async () => {
    const data = flagged()
    const tasks = ['a', 'b', 'c', 'd'].map((title) => ({ problem: 'no-readme' as const, title }))
    await expect(submitTasks(ctx(data), { appId: 'p_bill', tasks })).rejects.toThrow(/at most 3 tasks/)
    expect(data.submitTasks).not.toHaveBeenCalled()
  })

  it('redacts a secret in a task', async () => {
    const data = flagged()
    await submitTasks(ctx(data), { appId: 'p_bill', tasks: [{ problem: 'no-readme', title: 'Document it', detail: 'Set DATABASE_URL=postgres://u:supersecretpw@db.example.com/x' }] })
    expect(JSON.stringify(vi.mocked(data.submitTasks).mock.calls[0][1])).not.toContain('supersecretpw')
  })

  it('passes a refusal from the database through as a plain message', async () => {
    const data = flagged()
    vi.mocked(data.submitTasks).mockRejectedValueOnce(new ToolError("Only the app's owner or an admin can change this app."))
    await expect(submitTasks(ctx(data), { appId: 'p_bill', tasks: [{ problem: 'no-readme', title: 'Add a README' }] })).rejects.toThrow(/owner or an admin/)
  })
})

describe('get_apps', () => {
  it('reads each app once, like get_app, and reports an app it could not read without failing the rest', async () => {
    const data = fakeData({
      getApp: vi.fn(async (id: string) => {
        if (id === 'p_gone') throw new ToolError('No such app, or you have no access to it.', 'P0002')
        return detail()
      }),
    })
    const out = await getApps(ctx(data), { appIds: ['p_bill', 'p_gone', 'p_bill'] })
    expect(data.getApp).toHaveBeenCalledTimes(2)
    expect(out.apps).toHaveLength(2)
    expect(out.apps[0]).toEqual(await getApp(ctx(fakeData()), { appId: 'p_bill' }))
    expect(out.apps[1]).toEqual({ id: 'p_gone', error: 'No such app, or you have no access to it.' })
  })

  it(`takes 1 to ${MAX_BATCH} apps`, () => {
    expect(AppIdsInput.safeParse({ appIds: [] }).success).toBe(false)
    expect(AppIdsInput.safeParse({ appIds: Array.from({ length: MAX_BATCH }, (_, i) => `p${i}`) }).success).toBe(true)
    expect(AppIdsInput.safeParse({ appIds: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `p${i}`) }).success).toBe(false)
  })
})

describe('submit_app_cards', () => {
  const card = (appId: string) => ({ appId, what: `What ${appId}`, who: 'Finance', stage: 'live' as const, status: 'Shipped.' })
  const flaggedData = (over: Partial<TempoData> = {}) => fakeData({
    getApp: vi.fn(async () => detail({ signals: { hasReadme: false, secretFiles: [], lastCommitAt: '2026-10-04T00:00:00Z', openIssues: 0, openPrs: 0, syncedAt: '2026-10-04T00:00:00Z' } })),
    ...over,
  })

  it('saves each card and its tasks through the same checks as the one-app tools', async () => {
    const data = flaggedData()
    const out = await submitAppCards(ctx(data), { cards: [
      { ...card('p_a'), what: 'Bills. [Pay](https://evil.example)', tasks: [{ problem: 'no-readme', title: 'Add a README' }] },
      card('p_b'),
    ] })
    expect(data.submitCard).toHaveBeenNthCalledWith(1, 'p_a', { what: 'Bills. Pay', who: 'Finance', stage: 'live', status: 'Shipped.' }, 'Claude Code')
    expect(data.submitCard).toHaveBeenNthCalledWith(2, 'p_b', expect.objectContaining({ what: 'What p_b' }), 'Claude Code')
    expect(data.submitTasks).toHaveBeenCalledTimes(1)
    expect(data.submitTasks).toHaveBeenCalledWith('p_a', [{ problem: 'no-readme', title: 'Add a README', detail: null }], 'Claude Code')
    expect(out.results).toEqual([{ appId: 'p_a', card: 'saved', tasks: 'saved' }, { appId: 'p_b', card: 'saved' }])
    expect(out.message).toBe('Saved 2 cards of 2 as unchecked drafts. A person checks each one in Tempo before it counts.')
    expect(out.reviewUrl).toBe('https://tempo.test/#/review')
  })

  it("reports one app's refusal and carries on with the others", async () => {
    const data = flaggedData({
      submitCard: vi.fn(async (id: string) => { if (id === 'p_b') throw new ToolError("Only the app's owner or an admin can change this app.", '42501') }),
    })
    const out = await submitAppCards(ctx(data), { cards: [card('p_a'), card('p_b'), { ...card('p_c'), tasks: [{ problem: 'stale', title: 'Archive it' }] }] })
    expect(out.results).toEqual([
      { appId: 'p_a', card: 'saved' },
      { appId: 'p_b', card: "Only the app's owner or an admin can change this app." },
      { appId: 'p_c', card: 'saved', tasks: expect.stringMatching(/does not flag stale/) },
    ])
    expect(out.message).toMatch(/^Saved 2 cards of 3/)
  })

  it('stops at the 30-saves-a-minute limit and lists the apps to send again', async () => {
    let calls = 0
    const data = flaggedData({
      submitCard: vi.fn(async () => { calls += 1; if (calls === 2) throw new ToolError('Too many agent writes in a minute. Try again shortly.', '54000') }),
    })
    const out = await submitAppCards(ctx(data), { cards: [card('p_a'), card('p_b'), { ...card('p_c'), tasks: [{ problem: 'no-readme', title: 'Add a README' }] }] })
    expect(data.submitCard).toHaveBeenCalledTimes(2)
    expect(data.submitTasks).not.toHaveBeenCalled()
    expect(out.results.map((r) => [r.appId, r.card === 'saved', r.tasks])).toEqual([
      ['p_a', true, undefined],
      ['p_b', false, undefined],
      ['p_c', false, expect.stringMatching(/^Not saved yet/)],
    ])
    expect(out.message).toBe('Saved 1 card of 3 as unchecked drafts. A person checks each one in Tempo before it counts. Tempo takes 30 saves a minute: wait a minute, then send these again: p_b, p_c.')
  })

  it('redacts a secret in what it answers', async () => {
    const data = flaggedData({ submitCard: vi.fn(async () => { throw new ToolError('Refused DATABASE_URL=postgres://u:supersecretpw@db.example.com/x', '22023') }) })
    expect(JSON.stringify(await submitAppCards(ctx(data), { cards: [card('p_a')] }))).not.toContain('supersecretpw')
  })

  it(`takes 1 to ${MAX_BATCH} cards, each shaped like submit_app_card with optional tasks`, () => {
    const many = (n: number) => ({ cards: Array.from({ length: n }, (_, i) => card(`p${i}`)) })
    expect(CardsInput.safeParse(many(0)).success).toBe(false)
    expect(CardsInput.safeParse(many(MAX_BATCH)).success).toBe(true)
    expect(CardsInput.safeParse(many(MAX_BATCH + 1)).success).toBe(false)
    expect(CardsInput.safeParse({ cards: [{ ...card('p'), stage: 'done' }] }).success).toBe(false)
    expect(CardsInput.safeParse({ cards: [{ ...card('p'), tasks: Array.from({ length: 11 }, () => ({ problem: 'no-readme', title: 'x' })) }] }).success).toBe(false)
  })
})

describe('the submit_tasks input', () => {
  const one = { problem: 'no-readme', title: 'Add a README' }
  it('takes up to ten tasks and an optional detail', () => {
    expect(TasksInput.safeParse({ appId: 'p', tasks: Array.from({ length: 10 }, () => ({ ...one, detail: 'x' })) }).success).toBe(true)
    expect(TasksInput.safeParse({ appId: 'p', tasks: [] }).success).toBe(true)
    expect(TasksInput.safeParse({ appId: 'p', tasks: Array.from({ length: 11 }, () => one) }).success).toBe(false)
  })
  it('refuses an unknown problem, an empty title and long text', () => {
    expect(TasksInput.safeParse({ appId: 'p', tasks: [{ ...one, problem: 'unknown' }] }).success).toBe(false)
    expect(TasksInput.safeParse({ appId: 'p', tasks: [{ ...one, title: '' }] }).success).toBe(false)
    expect(TasksInput.safeParse({ appId: 'p', tasks: [{ ...one, title: 'x'.repeat(501) }] }).success).toBe(false)
    expect(TasksInput.safeParse({ appId: 'p', tasks: [{ ...one, detail: 'x'.repeat(2001) }] }).success).toBe(false)
  })
  it('knows all eight health flags', () => {
    expect([...HEALTH_KINDS].sort()).toEqual(['no-owner', 'no-readme', 'no-repo', 'owner-leaving', 'owner-left', 'public-repo', 'secrets', 'stale'])
  })
})

describe('errors', () => {
  it('passes a refusal from the database through as a plain message', async () => {
    const data = fakeData({ submitCard: vi.fn(async () => { throw new ToolError("Only the app's owner or an admin can change this app.") }) })
    await expect(submitAppCard(ctx(data), { appId: 'p_bill', what: 'x', who: 'y', stage: 'live', status: 'z' })).rejects.toThrow(/owner or an admin/)
  })
})
