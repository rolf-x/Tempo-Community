export interface InviteMessageInput {
  inviterName: string
  inviteeName: string | null
  workspaceName: string
  url: string
  expiresAt: string
  appNames?: string[]
  inviteeEmail?: string | null
}

const line = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()
const countApps = (count: number) => `${count} ${count === 1 ? 'app' : 'apps'}`
const listNames = (values: string[]) => values.length < 2
  ? values.join('')
  : `${values.slice(0, -1).join(', ')}${values.length > 2 ? ',' : ''} and ${values.at(-1)}`

/** The caller supplies time so message generation is deterministic and has no side effects. */
export function inviteMessage(input: InviteMessageInput, now: number) {
  const inviter = line(input.inviterName) || 'A teammate'
  const invitee = line(input.inviteeName ?? '')
  const workspace = line(input.workspaceName) || 'your workspace'
  const apps = (input.appNames ?? []).map(line).filter(Boolean)
  const remaining = Date.parse(input.expiresAt) - now
  const days = Math.ceil(remaining / 86_400_000)
  const expiry = !Number.isFinite(remaining)
    ? 'Check the link for its expiry date.'
    : remaining <= 0
      ? 'This link has expired. Ask for a new one.'
      : remaining < 86_400_000
        ? 'The link works for less than a day.'
        : `The link works for ${days} ${days === 1 ? 'day' : 'days'}.`
  const subjectFor = (who: string, where: string) => apps.length
    ? `${who} asked you to own ${countApps(apps.length)} in Tempo`
    : `${who} invited you to ${where} in Tempo`
  const bodyFor = (who: string, where: string, to: string, listed: string[]) => {
    const hidden = apps.length - listed.length
    const visible = listNames(listed)
    const appList = hidden
      ? `${visible}${visible ? ', and ' : ''}${hidden} more ${hidden === 1 ? 'app' : 'apps'}`
      : visible
    const request = apps.length
      ? `${who} asked you to own ${appList} in Tempo.`
      : `${who} invited you to ${where} in Tempo.`
    return `${to ? `Hi ${to},` : 'Hi,'}\n\n${request}\nTempo keeps track of the apps our team has built.\n\nSign in with GitHub to ${apps.length ? 'confirm' : 'join'}:\n${input.url}\n\n${expiry}`
  }
  const subject = subjectFor(inviter, workspace)
  const emailBody = bodyFor(inviter, workspace, invitee, apps)
  const slackMessage = `${invitee ? `@${invitee}, ` : ''}${subject}. ${expiry}\n${input.url}`
  const encodeMailto = (heading: string, body: string) => `mailto:${encodeURIComponent(line(input.inviteeEmail ?? ''))}?subject=${encodeURIComponent(heading)}&body=${encodeURIComponent(body)}`
  let mailtoUrl = encodeMailto(subject, emailBody)
  // Keep the full copyable email; shorten only the mail-app version, app names first.
  let listed = apps.length
  while (mailtoUrl.length >= 2_000 && listed > 0) {
    listed -= 1
    mailtoUrl = encodeMailto(subject, bodyFor(inviter, workspace, invitee, apps.slice(0, listed)))
  }
  for (let limit = 80; mailtoUrl.length >= 2_000 && limit >= 0; limit -= 20) {
    const shorten = (text: string) => Array.from(text).slice(0, limit).join('') + '…'
    mailtoUrl = encodeMailto(subjectFor(shorten(inviter), shorten(workspace)), bodyFor(shorten(inviter), shorten(workspace), shorten(invitee), []))
  }
  // An oversized link cannot be shortened safely. The UI offers the full copyable email.
  return { subject, emailBody, slackMessage, mailtoUrl: mailtoUrl.length < 2_000 ? mailtoUrl : null }
}
