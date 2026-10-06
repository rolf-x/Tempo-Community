import type { Project } from '../types'

/** Sample apps (the demo workspace) live under this made-up GitHub owner. */
export const SAMPLE_OWNER = 'acme-sample/'
export const isSampleRepo = (project: Project) => !!project.repo?.fullName.startsWith(SAMPLE_OWNER)
