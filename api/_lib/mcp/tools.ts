// Tempo's MCP tools and prompts. Each tool is a thin wrapper over the pure tools layer in src/ai/tools; everything an
// agent writes goes through the same cleaning as an in-app sync and lands as an unchecked draft.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { HandoverOut, Stage } from '../../../src/ai/schemas.js'
import { handoverSystem, syncAppSystem, TASK_RULES } from '../../../src/ai/prompts.js'
import { health, type HealthKind } from '../../../src/ai/tools/health.js'
import { cleanCardDraft, cleanHandoverDraft, cleanTasksDraft } from '../../../src/ai/tools/mcpDrafts.js'
import { redactDeep, redactSecrets } from '../../../src/ai/tools/repoFacts.js'
import { withoutRetiredActivity } from '../../../src/lib/activityFeed.js'
import { needsCard } from '../../../src/lib/claudeWork.js'
import { canEditApp } from '../../../src/lib/permissions.js'
import { todayISO } from '../../../src/lib/dates.js'
import { openTasks } from '../../../src/lib/tasks.js'
import type { Member, Project } from '../../../src/types'
import { ToolError, type AppDetail, type TempoData, type WorkspaceRef } from './data.js'

export interface ToolContext {
  data: TempoData
  /** The client's name for drafts and tasks, e.g. "Claude Code". */
  client: string
  /** Tempo's public address, for links back to the app. */
  baseUrl: string
  now?: () => Date
}

const MAX_MATCHES = 10

/** git@github.com:owner/name.git | https://github.com/owner/name(.git) | owner/name → owner/name (lower case). */
export function normaliseRepo(input: string): string | null {
  const m = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(input.trim().replace(/(\.git)?\/*$/, ''))
  return m ? m[1].toLowerCase() : null
}

const ownerName = (project: Project, members: Member[]) => members.find((m) => m.id === project.ownerId)?.name ?? null
const cardState = (project: Project) => (!project.appCard ? 'none' : project.appCard.checkedAt === null ? 'draft' : 'checked')

/** The problems Tempo flags on an app right now: what the app page shows, and what a task may be about. */
const flagsOf = (project: Project, members: Member[], workspace: WorkspaceRef, now: Date) =>
  health(project, members, now, { personal: workspace.kind === 'personal', keptAt: project.keptAt })

function summary(project: Project, members: Member[], workspace: WorkspaceRef, me: string, now: Date) {
  const flags = flagsOf(project, members, workspace, now)
  // The same rule the database applies to every write (0005): the app's owner or an admin.
  const canEdit = canEditApp(members.find((m) => m.id === me), project)
  return {
    id: project.id,
    name: project.name,
    workspace: workspace.name,
    repo: project.repo?.fullName ?? null,
    stage: project.appCard?.stage ?? null,
    card: cardState(project) as 'none' | 'draft' | 'checked',
    /** Whether you may write its card and tasks. Tempo refuses writes on any other app. */
    canEdit,
    /** Tempo is waiting for a card from you: none yet, only Tempo's own facts, or one the repo has moved past. Only on apps you can edit. */
    needsCard: canEdit && needsCard(project),
    owner: ownerName(project, members),
    health: flags.map((f) => f.label),
    /** Tasks added for flagged problems that are still open. */
    openTasks: openTasks(project.tasks, new Set(flags.map((f) => f.kind))).length,
    lastActivityAt: project.lastActivityAt,
  }
}
type AppSummary = ReturnType<typeof summary>

async function allApps(ctx: ToolContext): Promise<AppSummary[]> {
  const now = ctx.now?.() ?? new Date()
  return (await ctx.data.listApps()).flatMap((ws) =>
    ws.apps.filter((p) => !p.archived).map((p) => summary(p, ws.members, ws.workspace, ws.me, now)))
}

export async function listApps(ctx: ToolContext) {
  return redactDeep({ apps: await allApps(ctx), reviewUrl: `${ctx.baseUrl}/#/review` })
}

export async function findApp(ctx: ToolContext, args: { repo?: string; name?: string }) {
  const apps = await allApps(ctx)
  const repo = args.repo ? normaliseRepo(args.repo) : null
  const name = args.name?.trim().toLowerCase()
  const matches = apps.filter((a) => (repo && a.repo?.toLowerCase() === repo) || (name && a.name.toLowerCase().includes(name))).slice(0, MAX_MATCHES)
  return redactDeep({
    matches,
    hint: matches.length ? null : `No app in your Tempo workspaces matches. Add the repo in Tempo first: ${ctx.baseUrl}/#/`,
  })
}

export async function getApp(ctx: ToolContext, args: { appId: string }) {
  const d: AppDetail = await ctx.data.getApp(args.appId)
  const now = ctx.now?.() ?? new Date()
  const p = d.app
  const card = p.appCard
  const flags = flagsOf(p, d.members, d.workspace, now)
  return redactDeep({
    ...summary(p, d.members, d.workspace, d.me, now),
    description: p.description,
    liveUrl: p.liveUrl ?? p.signals?.liveUrl ?? null,
    // kind is what submit_tasks takes as a task's problem.
    healthDetail: flags.map((f) => ({ kind: f.kind, label: f.label, severity: f.severity })),
    tasks: openTasks(p.tasks, new Set(flags.map((f) => f.kind))).map((t) => ({ problem: t.problem, title: t.title, detail: t.detail })),
    currentCard: card ? {
      what: card.what, who: card.who, stage: card.stage, status: card.status, updatedAt: card.updatedAt,
      checked: card.checkedAt !== null, draftedBy: card.draftedBy?.client ?? null,
    } : null,
    evidence: card?.evidence ?? null,
    signals: p.signals,
    recentActivity: withoutRetiredActivity(d.activity).map((a) => ({ kind: a.kind, actor: a.actor, title: a.title, at: a.at, url: a.url })),
    handover: p.handover ? { writtenBy: p.handover.draftedBy?.client ?? null, at: p.handover.draftedBy?.at ?? null, checked: typeof p.handover.checkedAt === 'string' } : null,
    appUrl: `${ctx.baseUrl}/#/app/${encodeURIComponent(p.id)}`,
  })
}

export const CardInput = z.object({
  appId: z.string().min(1).max(100),
  what: z.string().min(1).max(2000),
  who: z.string().max(2000),
  stage: Stage,
  status: z.string().min(1).max(4000),
})

export async function submitAppCard(ctx: ToolContext, args: z.infer<typeof CardInput>) {
  const { appId, ...card } = args
  await ctx.data.submitCard(appId, cleanCardDraft(card), ctx.client)
  return { message: 'Saved as an unchecked draft. A person checks it in Tempo before it counts.', reviewUrl: `${ctx.baseUrl}/#/review` }
}

export const HandoverInput = HandoverOut.extend({ appId: z.string().min(1).max(100) })

export async function submitHandover(ctx: ToolContext, args: z.infer<typeof HandoverInput>) {
  const { appId, ...doc } = args
  const { app } = await ctx.data.getApp(appId)
  await ctx.data.submitHandover(appId, cleanHandoverDraft(doc, app.repo?.fullName), ctx.client)
  return { message: 'Saved as an unchecked draft on the app page in Tempo. A person reads it and marks it checked before it can be shared.', appUrl: `${ctx.baseUrl}/#/app/${encodeURIComponent(appId)}` }
}

export const HEALTH_KINDS = ['no-owner', 'owner-leaving', 'owner-left', 'secrets', 'public-repo', 'stale', 'no-readme', 'no-repo'] as const satisfies readonly HealthKind[]
const MAX_TASKS = 10
const MAX_TASKS_PER_PROBLEM = 3

export const TasksInput = z.object({
  appId: z.string().min(1).max(100),
  tasks: z.array(z.object({
    problem: z.enum(HEALTH_KINDS),
    title: z.string().min(1).max(500),
    detail: z.string().max(2000).nullish(),
  })).max(MAX_TASKS),
})

const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export async function submitTasks(ctx: ToolContext, args: z.infer<typeof TasksInput>) {
  const d = await ctx.data.getApp(args.appId)
  const flags = flagsOf(d.app, d.members, d.workspace, ctx.now?.() ?? new Date())
  const flagged = new Set<HealthKind>(flags.map((f) => f.kind))
  const notFlagged = [...new Set(args.tasks.map((t) => t.problem))].filter((kind) => !flagged.has(kind))
  if (notFlagged.length) {
    const now = flags.length ? flags.map((f) => `${f.kind} (${f.label})`).join(', ') : 'none'
    throw new ToolError(redactSecrets(`Tempo does not flag ${notFlagged.join(', ')} on ${d.app.name} right now, so it takes no task for it. Flagged now: ${now}.`))
  }
  const tasks = cleanTasksDraft(args.tasks)
  if (args.tasks.length && !tasks.length) throw new ToolError('Each task needs a title.')
  const crowded = HEALTH_KINDS.find((kind) => tasks.filter((t) => t.problem === kind).length > MAX_TASKS_PER_PROBLEM)
  if (crowded) throw new ToolError(`Add at most ${MAX_TASKS_PER_PROBLEM} tasks for each problem. ${crowded} has more.`)
  await ctx.data.submitTasks(args.appId, tasks, ctx.client)
  const appUrl = `${ctx.baseUrl}/#/app/${encodeURIComponent(args.appId)}`
  return redactDeep({
    message: tasks.length
      ? `Added ${countLabel(tasks.length, 'task')} to ${d.app.name} in Tempo. ${tasks.length === 1 ? 'It closes' : 'Each closes'} on its own once Tempo sees the problem fixed.`
      : `Cleared the open tasks on ${d.app.name} in Tempo.`,
    appUrl,
  })
}

// ── Many apps at once ──────────────────────────────────────────────────────────────────────────────────────────────
// Reading and saving up to 10 apps per call cuts the calls (and the approvals an AI app asks for) about tenfold. Each
// app goes through exactly the same checks as the one-app tools; one app's refusal doesn't stop the others, except the
// database's 30-writes-a-minute limit, which stops the batch so Claude sends the rest a minute later.

export const MAX_BATCH = 10

export const AppIdsInput = z.object({ appIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BATCH) })

const failure = (error: unknown) => (error instanceof ToolError ? error.message : 'Tempo could not do that right now. Try again shortly.')
const rateLimited = (error: unknown) => error instanceof ToolError && error.code === '54000'

export async function getApps(ctx: ToolContext, args: z.infer<typeof AppIdsInput>) {
  const ids = [...new Set(args.appIds)]
  const apps = await Promise.all(ids.map(async (appId) => {
    try {
      return await getApp(ctx, { appId })
    } catch (error) {
      return { id: appId, error: failure(error) }
    }
  }))
  return { apps }
}

export const CardsInput = z.object({
  cards: z.array(CardInput.extend({ tasks: TasksInput.shape.tasks.optional() })).min(1).max(MAX_BATCH),
})

const RETRY = 'Not saved yet: Tempo takes 30 saves a minute. Send it again in a minute.'

export async function submitAppCards(ctx: ToolContext, args: z.infer<typeof CardsInput>) {
  const results: Array<{ appId: string; card: 'saved' | string; tasks?: 'saved' | string }> = []
  let full = false
  // One app after another: the limit is counted per person, so a burst would only hit it sooner.
  for (const { tasks, ...card } of args.cards) {
    if (full) {
      results.push({ appId: card.appId, card: RETRY, ...(tasks ? { tasks: RETRY } : {}) })
      continue
    }
    const result: (typeof results)[number] = { appId: card.appId, card: 'saved' }
    try {
      await submitAppCard(ctx, card)
    } catch (error) {
      result.card = rateLimited(error) ? RETRY : failure(error)
      full = rateLimited(error)
    }
    if (tasks) {
      if (full) result.tasks = RETRY
      else {
        try {
          await submitTasks(ctx, { appId: card.appId, tasks })
          result.tasks = 'saved'
        } catch (error) {
          result.tasks = rateLimited(error) ? RETRY : failure(error)
          full = rateLimited(error)
        }
      }
    }
    results.push(result)
  }
  const saved = results.filter((r) => r.card === 'saved').length
  const retry = results.filter((r) => r.card === RETRY || r.tasks === RETRY).map((r) => r.appId)
  return redactDeep({
    message: `Saved ${countLabel(saved, 'card')} of ${args.cards.length} as unchecked drafts. A person checks each one in Tempo before it counts.`
      + (retry.length ? ` Tempo takes 30 saves a minute: wait a minute, then send these again: ${retry.join(', ')}.` : ''),
    results,
    reviewUrl: `${ctx.baseUrl}/#/review`,
  })
}

// ── Registration ─────────────────────────────────────────────────────────────────────────────────────────────────

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

async function answer(run: () => Promise<unknown>) {
  try {
    return text(await run())
  } catch (error) {
    const message = error instanceof ToolError ? error.message : 'Tempo could not do that right now. Try again shortly.'
    return { isError: true, content: [{ type: 'text' as const, text: message }] }
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

export const SERVER_INSTRUCTIONS = `Tempo is a portfolio of the apps a team builds: owners, health, what changed, what's next.
Use find_app with this repo's git remote (or list_apps) to find the app, get_app to read where it stands, then write
what you learn from the repo with submit_app_card or submit_handover. For several apps, read and save up to 10 at a time
with get_apps and submit_app_cards (each card can carry its tasks). Cards and handover packs are unchecked drafts until
a person checks them in Tempo. After saving the card, call submit_tasks with 1 to 3 concrete tasks for each problem under
healthDetail (use its kind as the task's problem); skip it when there are none. Tasks show on the app page and close on
their own once Tempo sees the problem fixed. Write only on apps where canEdit is true: Tempo refuses the rest.
Never include secrets, credentials or personal data.`

/**
 * The instructions for this Tempo. Off live they start by saying which Tempo this is: workspaces on staging can share
 * names with live ones, so a staging test's drafts could land in live Tempo's workspace of the same name.
 */
export function serverInstructions(site: { label: string; live: boolean }, origin: string): string {
  if (site.live) return SERVER_INSTRUCTIONS
  return `This is ${site.label}, at ${origin}: a separate Tempo with its own workspaces, apart from live Tempo even where `
    + `names match. When the person names a Tempo, use the one they name.\n${SERVER_INSTRUCTIONS}`
}

export function registerTempo(server: McpServer, ctx: ToolContext) {
  server.registerTool('list_apps', {
    title: 'List apps',
    description: 'Every app in your Tempo workspaces: owner, stage, whether you can edit it (canEdit), whether its card is checked or still needed (needsCard), health flags and how many tasks are open. Write cards and tasks only for apps with canEdit.',
    inputSchema: z.object({}),
    annotations: READ,
  }, () => answer(() => listApps(ctx)))

  server.registerTool('find_app', {
    title: 'Find an app',
    description: "Find the Tempo app for a repo (pass the git remote URL or owner/name) or by part of its name.",
    inputSchema: z.object({ repo: z.string().max(300).optional(), name: z.string().max(100).optional() }),
    annotations: READ,
  }, (args) => answer(() => findApp(ctx, args)))

  server.registerTool('get_app', {
    title: 'Get an app',
    description: 'One app: its current card, health flags with kind and severity (healthDetail), the open tasks, repo signals, evidence, the last 10 activity rows and whether a handover pack exists.',
    inputSchema: z.object({ appId: z.string().min(1).max(100) }),
    annotations: READ,
  }, (args) => answer(() => getApp(ctx, args)))

  server.registerTool('submit_app_card', {
    title: 'Draft the app card',
    description: 'Save a draft of the app card (what, who, stage, status) for a person to check. Limits: what 240 characters, who 160, status 400. '
      + 'stage is idea, building, live or stale. Fields a person edited by hand are kept. Use the sync_app prompt for the full rules.',
    inputSchema: CardInput,
    annotations: { ...WRITE, idempotentHint: true },
  }, (args) => answer(() => submitAppCard(ctx, args)))

  server.registerTool('get_apps', {
    title: 'Get several apps',
    description: `Up to ${MAX_BATCH} apps at once, each exactly as get_app returns it (or an error for that app). Use it instead of many get_app calls.`,
    inputSchema: AppIdsInput,
    annotations: READ,
  }, (args) => answer(() => getApps(ctx, args)))

  server.registerTool('submit_app_cards', {
    title: 'Draft several app cards',
    description: `Save up to ${MAX_BATCH} app cards at once, each with its tasks, instead of many submit_app_card and submit_tasks calls. `
      + 'Each card follows submit_app_card (what 240 characters, who 160, status 400; stage idea, building, live or stale); its optional tasks '
      + 'follow submit_tasks and replace that app\'s open tasks. Each app is checked on its own: the answer says what was saved for each. '
      + 'Tempo takes 30 saves a minute (a card and its tasks are two); past that, the answer lists the apps to send again a minute later.',
    inputSchema: CardsInput,
    annotations: { ...WRITE, idempotentHint: true },
  }, (args) => answer(() => submitAppCards(ctx, args)))

  server.registerTool('submit_tasks', {
    title: 'Add tasks for flagged problems',
    description: 'Add 1 to 3 concrete tasks for each problem Tempo flags on the app: get_app lists them under healthDetail, and a task\'s problem is that item\'s kind. '
      + `${TASK_RULES} At most 10 tasks in all. `
      + "This replaces the app's open tasks, so send every task you want to keep in one call; [] clears them. A task closes on its own once Tempo sees its problem fixed. "
      + 'Only problems flagged right now are accepted.',
    inputSchema: TasksInput,
    annotations: { ...WRITE, idempotentHint: true },
  }, (args) => answer(() => submitTasks(ctx, args)))

  server.registerTool('submit_handover', {
    title: 'Save a handover pack',
    description: 'Save a handover pack for the engineer taking the app over. Plain text; openWork evidenceUrl must be an issue, pull request or '
      + "commit page of the app's own repo, other links are dropped. At most 20 items per list. Use the handover prompt for the full rules.",
    inputSchema: HandoverInput,
    annotations: { ...WRITE, idempotentHint: true },
  }, (args) => answer(() => submitHandover(ctx, args)))

  const today = () => todayISO(ctx.now?.() ?? new Date())
  const steps = (write: string) => `Steps:
1. Find the app: call find_app with this repository's git remote URL (\`git remote get-url origin\`), or list_apps.
2. Call get_app for its current card, health flags and recent activity.
3. Read this repository: README, agent notes (CLAUDE.md, AGENTS.md, progress files), recent commits, open issues and pull requests.
${write}`
  const saveIt = (submit: string) => `4. Write it by the rules below and save it with ${submit}. Tell me what you saved and that it waits for a person to check it.`
  // The card first, then a task or three for each problem Tempo flags (they replace the app's open tasks, so one call).
  const saveCardAndTasks = `4. Write the card by the rules below and save it with submit_app_card.
5. Then call submit_tasks once, with 1 to 3 concrete tasks for each problem in healthDetail (a task's problem is that item's kind; at most 10 tasks in all). ${TASK_RULES} It replaces the app's open tasks, and each task closes on its own once Tempo sees its problem fixed. Skip this step when healthDetail is empty.
6. Tell me what you saved: the card waits for a person to check it, and the tasks show on the app page in Tempo.`

  server.registerPrompt('sync_app', {
    title: 'Draft the app card',
    description: 'Read this repo, draft its app card in Tempo and add tasks for the problems Tempo flags.',
  }, () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `${steps(saveCardAndTasks)}

${syncAppSystem({ today: today() }).replace('Answer only by calling the sync_app tool.', 'Save the card by calling submit_app_card.')}` } }],
  }))

  server.registerPrompt('handover', {
    title: 'Write a handover pack',
    description: 'Read this repo and write a handover pack for the next owner, saved in Tempo.',
  }, () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `${steps(saveIt('submit_handover'))}

${handoverSystem({ today: today(), owner: null }).replace('Answer only by calling the handover tool.', 'Save the pack by calling submit_handover.')}` } }],
  }))
}
