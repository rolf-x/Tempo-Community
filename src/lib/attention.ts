import { flagTone, type HealthFlag } from '../ai/tools/health'
/** At risk means a red repo-health signal. */
export const isAtRisk = (flags: readonly HealthFlag[]) => flags.some((flag) => flagTone(flag) === 'risk')

/** Needs attention is the wider set: at risk, plus amber repo-health signals. */
export const needsAttention = (flags: readonly HealthFlag[]) =>
  isAtRisk(flags) || flags.some((flag) => flagTone(flag) === 'warn')
