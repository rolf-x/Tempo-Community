import { customAlphabet } from 'nanoid'

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)
export const projectId = () => `p_${nano()}`
export const memberId = () => `m_${nano()}`
export const activityId = () => `a_${nano()}`
/** A saved API connection (Settings → API keys). Works on any page, unlike crypto.randomUUID (https only). */
export const connectionId = () => `k_${nano()}`
