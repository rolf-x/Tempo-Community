// What leaves the browser for an AI provider. Every prompt input is built here and passes through redactDeep as its
// last step, so a free-text field added later (an app name, a label) is covered without anyone having to remember it.
// The privacy page lists exactly these fields. Pure.
import type { Project } from '../../types'
import type { HealthKind } from './health'
import { redactDeep, type RepoFacts } from './repoFacts'

export function syncAppInput(project: Pick<Project, 'name' | 'description'>, facts: RepoFacts): string {
  return JSON.stringify(redactDeep({
    app: { name: project.name, description: project.description },
    facts,
  }))
}

export interface HandoverInput {
  project: Pick<Project, 'name' | 'description'>
  owner: string | null
  deployment: { liveUrl: string | null; deployFile: string | null }
  facts: RepoFacts
  flags: { label: string }[]
}

export function handoverInput({ project, owner, deployment, facts, flags }: HandoverInput): string {
  return JSON.stringify(redactDeep({
    app: { name: project.name, description: project.description, owner },
    deployment,
    facts,
    health: flags.map((flag) => flag.label),
  }))
}

export interface TasksInput {
  project: Pick<Project, 'name' | 'description' | 'repo' | 'signals' | 'appCard' | 'tasks'>
  /** The problems to write tasks for: the app's health flags that have no open task. */
  flags: { kind: HealthKind; label: string }[]
}

/**
 * What the AI sees when it writes an app's tasks: the app, what it is (its card), the problems to cover with what Tempo saw,
 * the repo facts Tempo already holds, and the titles a person removed. No repo files, no activity.
 */
export function tasksInput({ project, flags }: TasksInput): string {
  const { signals, appCard } = project
  return JSON.stringify(redactDeep({
    app: {
      name: project.name,
      repo: project.repo?.fullName ?? null,
      description: project.description,
      what: appCard?.what ?? null,
      status: appCard?.status ?? null,
    },
    problems: flags.map((flag) => ({ kind: flag.kind, detail: flag.label })),
    signals: signals ? {
      hasReadme: signals.hasReadme, secretFiles: signals.secretFiles, lastCommitAt: signals.lastCommitAt,
      openIssues: signals.openIssues, openPrs: signals.openPrs,
    } : null,
    alreadyRemoved: (project.tasks ?? []).filter((task) => task.removedAt).map((task) => task.title),
  }))
}

/** Links the AI was shown. A handover may link only to these. */
export function factUrls(facts: RepoFacts): Set<string> {
  return new Set([
    facts.meta.url,
    ...facts.commits.map((item) => item.url),
    ...facts.pulls.map((item) => item.url),
    ...facts.issues.map((item) => item.url),
  ].filter((url) => !!url))
}
