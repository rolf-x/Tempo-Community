import type { Project } from '../types'

const sameFiles = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join('\n') === [...b].sort().join('\n')

/** True only when newer repo facts contradict the snapshot behind a kept AI card. */
export function isAICardOutOfDate(project: Project): boolean {
  const card = project.appCard
  const signals = project.signals
  if (card?.source !== 'ai' || !signals || Date.parse(signals.syncedAt) <= Date.parse(card.updatedAt)) return false

  const saved = card.evidence?.repoFacts
  if (saved) {
    return saved.hasReadme !== signals.hasReadme
      || !sameFiles(saved.secretFiles, signals.secretFiles)
      || saved.private !== (project.repo?.private ?? saved.private)
      || saved.lastCommitAt !== signals.lastCommitAt
  }

  const savedCommit = card.evidence?.lastCommit?.at
  return savedCommit ? savedCommit !== signals.lastCommitAt : !!signals.lastCommitAt && Date.parse(signals.lastCommitAt) > Date.parse(card.updatedAt)
}
