// Pure selectors over store data. Use with useStore + useShallow or compute in useMemo.
import type { Member, Project } from '../types'

export const activeProjects = (projects: Project[]) => projects.filter((p) => !p.archived)

export const memberById = (members: Member[], id: string | null | undefined) => (id ? members.find((m) => m.id === id) ?? null : null)
