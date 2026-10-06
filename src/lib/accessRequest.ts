export interface AccessRequestInput {
  appName: string
  appUrl: string
  ownerName: string
  ownerEmail?: string | null
}

const MAX_MAILTO_LENGTH = 1_999

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
const clip = (value: string, length: number) => {
  const chars = Array.from(value)
  return chars.length > length ? `${chars.slice(0, Math.max(0, length - 1)).join('')}…` : value
}

const mailto = (email: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

/** Builds deterministic, plain-text access requests without opening mail or touching the clipboard. */
export function accessRequest(input: AccessRequestInput) {
  const appName = oneLine(input.appName) || 'this app'
  const ownerName = oneLine(input.ownerName) || 'there'
  const appUrl = oneLine(input.appUrl)
  const suppliedEmail = oneLine(input.ownerEmail ?? '')
  const ownerEmail = suppliedEmail.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(suppliedEmail) && encodeURIComponent(suppliedEmail).length <= 320
    ? suppliedEmail
    : ''
  const subject = `Access to ${appName}`
  const emailBody = `Hi ${ownerName},\n\nCould I get access to ${appName}?\n${appUrl}`
  const message = `Hi ${ownerName}, could I get access to ${appName}? ${appUrl}`.trim()

  let mailtoUrl = mailto(ownerEmail, subject, emailBody)
  if (mailtoUrl.length >= 2_000) {
    const shortApp = clip(appName, 100)
    let mailApp = shortApp
    let shortUrl = clip(appUrl, 1_000)
    const shortSubject = `Access to ${shortApp}`
    const body = () => `Could I get access to ${mailApp}?\n${shortUrl}`
    mailtoUrl = mailto(ownerEmail, shortSubject, body())
    while (mailtoUrl.length > MAX_MAILTO_LENGTH && Array.from(shortUrl).length > 1) {
      shortUrl = clip(shortUrl, Math.max(1, Array.from(shortUrl).length - 40))
      mailtoUrl = mailto(ownerEmail, shortSubject, body())
    }
    while (mailtoUrl.length > MAX_MAILTO_LENGTH && Array.from(mailApp).length > 1) {
      mailApp = clip(mailApp, Math.max(1, Array.from(mailApp).length - 10))
      mailtoUrl = mailto(ownerEmail, `Access to ${mailApp}`, body())
    }
  }

  return { subject, emailBody, message, mailtoUrl }
}
