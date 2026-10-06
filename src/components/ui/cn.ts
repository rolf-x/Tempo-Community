// Tiny class joiner: cn('a', cond && 'b', undefined) → 'a b'
export type ClassValue = string | false | null | undefined | 0

export const cn = (...values: ClassValue[]) => values.filter(Boolean).join(' ')
