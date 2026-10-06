// The commit-share owner suggestion for a list of apps (the app page does the same for one app). Commits come from
// Tempo's own activity first and, with GitHub connected, from each repo's latest commits, read two repos at a time.
import { useEffect, useMemo, useState } from 'react'
import { isSampleRepo } from '../../lib/sampleRepo'
import { commitShareWindowStart, suggestOwnerByCommitShare, type CommitIdentity, type OwnerSuggestion } from '../../ai/tools/matchMember'
import { GitHubError, fetchRepoWork } from '../../data/github'
import { useSession } from '../../data/session'
import type { Activity, Member, Project } from '../../types'
import { shouldShowOwnerSuggestion } from './ownerSuggestion'

const READERS = 2

/** Tempo's own record of an app's commits, as the suggestion reads them. */
export const activityCommits = (activity: Activity[], projectId: string): CommitIdentity[] =>
  activity.filter((item) => item.projectId === projectId && item.kind === 'commit').map((item) => ({ author: item.actor, date: item.at }))

/** The suggestion to show for each app (by id): only where the app page would show one too. */
export function suggestionsFor(
  apps: Project[],
  members: Member[],
  activity: Activity[],
  fetched: Record<string, CommitIdentity[]>,
  since: Date,
): Record<string, OwnerSuggestion | null> {
  const out: Record<string, OwnerSuggestion | null> = {}
  for (const app of apps) {
    const commits = fetched[app.id]?.length ? fetched[app.id] : activityCommits(activity, app.id)
    const suggestion = suggestOwnerByCommitShare(commits, members, since)
    const owner = members.find((member) => member.id === app.ownerId) ?? null
    out[app.id] = shouldShowOwnerSuggestion(owner, suggestion, members) ? suggestion : null
  }
  return out
}

export function useOwnerSuggestions(open: boolean, apps: Project[], members: Member[], activity: Activity[]): Record<string, OwnerSuggestion | null> {
  const token = useSession((s) => s.githubToken)
  const [fetched, setFetched] = useState<Record<string, CommitIdentity[]>>({})
  const since = useMemo(() => commitShareWindowStart(new Date()), [])
  // Reads again only when the window opens on a different list.
  const key = open && token ? apps.filter((app) => app.repo && !isSampleRepo(app)).map((app) => `${app.id}:${app.repo!.fullName}`).join(',') : ''

  useEffect(() => {
    if (!key || !token) return
    const targets = apps.filter((app) => app.repo && !isSampleRepo(app))
    const controller = new AbortController()
    let next = 0
    const reader = async () => {
      while (next < targets.length && !controller.signal.aborted) {
        const app = targets[next++]
        try {
          const work = await fetchRepoWork(token, app.repo!.fullName, { signal: controller.signal })
          if (!controller.signal.aborted) setFetched((current) => ({ ...current, [app.id]: work.commits }))
        } catch (error) {
          // That app just has no suggestion. If GitHub says stop, stop for every app.
          if (error instanceof GitHubError && (error.kind === 'rate-limit' || error.kind === 'auth')) controller.abort()
        }
      }
    }
    for (let i = 0; i < READERS; i++) void reader()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the app list
  }, [key, token])

  return useMemo(() => suggestionsFor(apps, members, activity, fetched, since), [apps, members, activity, fetched, since])
}
