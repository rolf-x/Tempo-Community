import type { ReactNode } from 'react'
import { Wordmark } from '../components/Logo'
import { ThemeSwitch } from '../components/landing/ThemeSwitch'
import { toHash } from '../lib/router'
import { githubAppMode } from '../lib/githubApp'
import { aiMode } from '../lib/aiMode'
import { contactEmail } from '../lib/contact'

export default function PrivacyView() {
  // legacy: your own AI key · both: the key and Claude (MCP) · mcp: Claude only, so Tempo makes no AI calls and holds no key.
  // `mode !== 'legacy'` means Claude (MCP) is on; `mode !== 'mcp'` means the browser may call an AI with your key.
  const mode = aiMode()
  const contact = contactEmail()
  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-5 sm:px-8">
        <a href={toHash({ name: 'welcome' })} className="focus-ring rounded-md" aria-label="Tempo home">
          <Wordmark />
        </a>
        <ThemeSwitch />
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-text">Privacy</h1>
        <p className="mt-2 text-base text-text-muted">What Tempo stores, where, and who sees it. Last updated 6 October 2026.</p>

        <div className="mt-10 space-y-8">
          <Section title="Stored in Tempo's database (Supabase)">
            <p>
              Tempo stores your workspace, its members, apps, activity and invites. Member details can include a name, email, GitHub login and avatar. Database access rules decide who in your workspace can read or edit each item.
            </p>
          </Section>

          <Section title="Kept only in this browser">
            <ul className="list-disc space-y-2 pl-5 marker:text-text-muted">
              {mode !== 'mcp' && <li>Your AI keys, if you save any. Each one is sent only to its own AI provider, never to Tempo's server, and every key is left out of exports.</li>}
              <li>Your GitHub token is kept in an encrypted, secure cookie that page scripts can't read. Tempo's server only passes read requests on to GitHub, and the cookie is cleared when you sign out.</li>
              <li>Your sign-in. It ends after 14 days without using Tempo, and 30 days after you signed in at the latest. Then you sign in with GitHub again. The same limits apply to a connected AI app.</li>
              {mode !== 'legacy' && <li>While you connect Claude, the message to send it (your workspace and app names), for up to 30 minutes, so Allow can copy it for you.</li>}
              <li>Your theme and view choices.</li>
            </ul>
          </Section>

          {mode !== 'legacy' && (
            <Section title="AI apps you connect (MCP)">
              <p>
                Tempo has an MCP address. You add it to Claude (on the web, the desktop app or Claude Code) and sign in. Then Claude can work with your portfolio as you.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-text-muted">
                <li>It can read only what you can read yourself: your apps, their recent activity, and the names and roles of people in your workspaces. It doesn't get anyone's email address, an app's access note or the text of a stored handover pack.</li>
                <li>Because it signs in as you, it can also read your own account details from the sign-in service: your name, email address and GitHub profile. It can't add a password or another way to sign in.</li>
                <li>Secrets are replaced with [redacted] in every answer Tempo gives it. That covers common key and password formats, not every possible secret.</li>
                <li>It can only write drafts. An app card it writes waits in the Review queue. A handover pack it writes can't be copied or downloaded until someone who may edit the app reads it and marks it checked. It can also add tasks for the problems Tempo flags on an app. Its tasks show on the app's page with its name, anyone who may edit the app can remove one, and each closes on its own once Tempo sees the problem fixed. Tempo never writes to GitHub.</li>
                <li>Tempo never stores the AI app's tokens. Supabase holds the permission you gave it, and you can revoke it any time in Settings, under Connect your AI. Revoking cuts the app off at once. Signing out of Tempo signs out only that browser and leaves the AI app connected.</li>
                <li>Your GitHub token never reaches the MCP server.</li>
              </ul>
              <p className="mt-3">
                What the AI app does with the answers it gets is up to that app and its provider, under their terms.
              </p>
            </Section>
          )}

          {mode !== 'mcp' && (
            <Section title="Sent to the AI provider you choose">
              <p>When Tempo writes an app card, an app's tasks or a handover pack, it can send this to the provider you picked. It writes cards when you add apps, press Sync now or Sync all; tasks on Sync now and Sync all, for health notes with no task yet; and a handover pack when you ask for one:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-text-muted">
                <li>The app's name and description, its owner's name, its live link and its health notes, such as "No owner" or "Secret file committed: .env".</li>
                <li>The repo's name, description and README, and up to four agent memory files such as CLAUDE.md, AGENTS.md and progress.md.</li>
                <li>Recent commit and pull request titles with their author logins, and issue titles and labels.</li>
                <li>For tasks: the app's card text, its repo signals (README or not, committed secret file paths, last commit date, open issues and pull requests) and the titles of tasks someone removed, so they aren't suggested again.</li>
              </ul>
              <p className="mt-3">
                Before any of it is sent, common key and password formats are replaced with [redacted]: API keys and tokens from the main providers, private key blocks, passwords in web addresses, and settings such as password=… or api_key=…. That covers the usual shapes, not every possible secret, so keep credentials out of READMEs, agent notes and commit messages. The request goes straight from your browser to that provider, under their terms. A custom endpoint must use https (plain http only for a model on your own computer). With AI turned off, nothing is sent to an AI provider.
              </p>
            </Section>
          )}

          <Section title="GitHub access">
            <p>
              {githubAppMode()
                ? 'Tempo\'s GitHub access is read-only, enforced by GitHub, and limited to the accounts and repos where Tempo is installed.'
                : <>Tempo asks for the <code className="font-mono text-sm text-text">repo</code> permission because GitHub has no read-only permission for private repos. Tempo makes read requests only. It never pushes, opens issues or changes settings.</>}
            </p>
            <p className="mt-3">You can disconnect GitHub in Settings → Integrations, which revokes Tempo's access.</p>
          </Section>

          <Section title="Updates on every push">
            <p>
              When someone pushes to a repo that's in a linked workspace, GitHub tells Tempo, and Tempo's server checks that repo with Tempo's own read-only GitHub App. It looks only at file names, dates and counts, and never opens a file, not even the README. It saves the same facts a Sync saves: whether there's a README, the names of committed secret files, when the last commit was, how many pull requests and issues are open, and the live link. It never reads or stores code, and no AI runs.
            </p>
            <p className="mt-3">
              Only an owner or admin can turn it on. Tempo does it quietly when one of them has connected GitHub, and Settings → Integrations shows whether it's on. Installing or removing Tempo's GitHub App on GitHub controls it.
            </p>
          </Section>

          <Section title="Services involved">
            <p>
              Tempo uses Supabase for its database and sign-in, Vercel for hosting, {mode === 'mcp' && 'and '}GitHub for sign-in and repo data{mode === 'mcp' ? '. Tempo itself calls no AI provider' : ', and the AI provider you choose'}. Google Fonts and jsDelivr serve fonts. Vercel Web Analytics counts visits without cookies and sees only the page name, never app ids, invite links or anything you type. Tempo has no ads or tracking cookies.
            </p>
          </Section>

          <Section title="Not for health or patient data">
            <p>Tempo is not HIPAA compliant. Do not put patient or health information in app names, descriptions or repo notes.</p>
          </Section>

          <Section title="Your data">
            <p>
              Export your Tempo data at any time in Settings &gt; Data. The export includes your apps, members, activity and settings{mode === 'mcp' ? '' : ', but leaves out your AI keys'}. To delete your account or a workspace,{' '}
              {contact ? (
                <>
                  email{' '}
                  <a href={`mailto:${contact}`} className="focus-ring rounded-sm text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
                    {contact}
                  </a>.
                </>
              ) : 'ask the person who runs this Tempo.'}
            </p>
          </Section>
        </div>

        <a href={toHash({ name: 'welcome' })} className="focus-ring mt-10 inline-block rounded-sm text-base font-medium text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
          Back to the home page
        </a>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-border pt-6">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <div className="mt-3 break-words text-base leading-relaxed text-text-muted">{children}</div>
    </section>
  )
}
