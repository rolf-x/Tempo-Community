// Tool output schemas. One source for zod validation and the JSON Schema sent to the model.
// Length limits live in the tools layer (it truncates); the schemas only reject wrong shapes and enums.
import { z } from 'zod'
import type { HealthKind } from './tools/health'

export const Stage = z.enum(['idea', 'building', 'live', 'stale'])

export const SyncAppOut = z.object({
  card: z.object({ what: z.string().min(1), who: z.string(), stage: Stage, status: z.string().min(1) }),
})

export const HandoverOut = z.object({
  summary: z.string().min(1),
  howToRun: z.array(z.string()),
  whereThingsAre: z.array(z.object({ path: z.string(), what: z.string() })),
  openWork: z.array(z.object({ title: z.string(), evidenceUrl: z.string().optional() })),
  risks: z.array(z.string()),
  contacts: z.array(z.string()),
  unknowns: z.array(z.string()),
})
export type HandoverOut = z.infer<typeof HandoverOut>

/** The problems Tempo flags on an app (health flags): what a task is about. */
export const TASK_PROBLEMS = ['no-owner', 'owner-leaving', 'owner-left', 'secrets', 'public-repo', 'stale', 'no-readme', 'no-repo'] as const satisfies readonly HealthKind[]

/** Tasks for the problems Tempo flags on one app. Lengths are cut by the tools layer (cleanTasksDraft), not here. */
export const WriteTasksOut = z.object({
  tasks: z.array(z.object({ problem: z.enum(TASK_PROBLEMS), title: z.string().min(1), detail: z.string() })),
})

export const TOOLS = {
  sync_app: SyncAppOut,
  handover: HandoverOut,
  write_tasks: WriteTasksOut,
} as const

export type ToolName = keyof typeof TOOLS
export type ToolOutput<T extends ToolName> = z.infer<(typeof TOOLS)[T]>

export function toJsonSchema(name: ToolName): Record<string, unknown> {
  const { $schema: _drop, ...schema } = z.toJSONSchema(TOOLS[name]) as Record<string, unknown>
  return schema
}

/** Sent to the model as the tool description (Anthropic `description`, OpenAI `function.description`). */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  sync_app: 'Return the app card (what, who, stage, status) for one app, from its repo facts.',
  handover: 'Return a handover document for one app: summary, how to run, where things are, open work, risks, contacts and unknowns, using only the facts given.',
  write_tasks: 'Return 1 to 3 concrete tasks for each problem listed for one app (problem = the kind given, title, detail), each a specific step for this repository, using only the facts given.',
}
