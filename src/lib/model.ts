// Defaults for app fields.
import type { Project } from '../types'

export const appDefaults = (): Pick<Project, 'ownerId' | 'repo' | 'signals' | 'appCard' | 'lastActivityAt' | 'autoApply' | 'keptAt'> => ({
  ownerId: null,
  repo: null,
  signals: null,
  appCard: null,
  lastActivityAt: null,
  autoApply: false,
  keptAt: null,
})

/** A one-person workspace: no members or owners in the UI. Old saved copies without a kind are orgs. */
export const isPersonal = (ws: { kind?: string } | null | undefined) => ws?.kind === 'personal'
