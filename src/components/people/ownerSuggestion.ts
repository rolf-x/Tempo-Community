// When to show the commit-share owner suggestion for an app (the app page and the Assign owners window use the same rule).
import type { OwnerSuggestion } from '../../ai/tools/matchMember'
import type { Member } from '../../types'

export function shouldShowOwnerSuggestion(owner: Member | null, suggestion: OwnerSuggestion | null, members: Member[] = []): boolean {
  if (!suggestion) return false
  if (owner?.active && !owner.leavingOn && owner.userId) {
    const candidate = suggestion.memberId ? members.find((member) => member.id === suggestion.memberId) : null
    return suggestion.share > 50 && !!candidate?.active && !!candidate.userId && candidate.id !== owner.id
  }
  if (!owner) return true
  if (suggestion.memberId) return suggestion.memberId !== owner.id
  const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
  return !same(suggestion.login, owner.githubLogin) && !same(suggestion.email, owner.email) && !same(suggestion.name, owner.name)
}
