// Where people reach whoever runs this copy of Tempo. Set VITE_CONTACT_EMAIL at build time (README → Self-hosting);
// without it, pages that offer an email say to ask the person who runs this Tempo instead.

const EMAIL = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/

export function contactEmail(value: string | undefined = import.meta.env.VITE_CONTACT_EMAIL): string | null {
  const email = (value ?? '').trim()
  return EMAIL.test(email) ? email : null
}
