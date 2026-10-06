# Security

Tempo reads private repos and stores who owns what, so it is built to see as little as it can and to keep each workspace sealed off from the others. This page describes how, what has been checked, and what is still open.

Last reviewed: 5 October 2026, after a full audit of the database rules, the server functions and the browser code.

## GitHub access

- **Read-only by design.** Sign-in goes through a GitHub App that can only read the repos a person chooses. Tempo requests no OAuth scopes, and GitHub caps the app's tokens at read-only, so Tempo can't push, merge or change settings. A production build refuses to sign in at all if the GitHub App isn't configured, instead of falling back to broader access (`src/lib/githubApp.ts`).
- **The token never reaches the page's scripts.** It is sealed with AES-256-GCM in a `__Host-` cookie that is HttpOnly, Secure and SameSite=Strict. The encryption key and the app's client secret exist only on the server. The server rejects cookies older than 30 days.
- **One narrow door to GitHub.** `api/github` forwards GET requests to api.github.com only, through an allowlist of paths. It rejects `..`, `//`, `@`, `\`, schemes and control characters, times out after 10 seconds and won't follow redirects off api.github.com. Calls that change state require a same-origin `Origin` header, and a POST must also send JSON.
- **Sign-out** clears the cookie. **Settings → Disconnect** also revokes Tempo's grant on GitHub.
- **Sign-ins end (migration 0023).** Every Supabase session, a browser's or a connected AI app's, ends after 14 days without a refresh and 30 days after sign-in at the latest. A trigger on `auth.sessions` sets `not_after` on sign-in and on every refresh, and Supabase Auth refuses to refresh a session past it (on every plan; its own time-box setting needs Pro). An access token already issued still runs out within its hour. A member removed from a workspace loses access to it at once, whatever their session.
- Sign-in uses PKCE. After sign-in Tempo only returns to its own pages (`#/…`, or the AI consent page `/oauth/consent`), so there is no open redirect.

## Workspace data

- **Row-level security on every table.** All 8 tables in Postgres have RLS, so a member only reads and writes their own workspace. There are no views and no dynamic SQL, and every `security definer` function pins its `search_path`.
- **Roles.** Owner, admin and member. Only the owner makes or removes admins, through one function. New member rows can't start as admin or owner, and a member's role and linked account can't be changed by a direct update.
- **Invites.** Tokens are 128-bit random and expire within 30 days. Links for a person or for specific apps are single-use, enforced under a row lock. Only owners and admins can revoke a link. The preview of a used, expired or unknown link reveals nothing about the workspace.
- **Joining.** A person who signs in is matched to a placeholder by the GitHub identity GitHub vouches for, never by profile fields they can edit.
- **Removing someone** ends their access at once. Only an invite made after the removal brings them back.
- **Proof.** `supabase/tests/rls.sql` checks workspace isolation across two workspaces, roles, invites, placeholder claims, the MCP scope and the push-update functions. It runs inside one transaction that is rolled back, so it leaves nothing behind. It passes with every migration applied.

## Updates on every push (migration 0022)

- **What arrives.** GitHub sends a webhook to `/api/github-webhook` for pushes, renames, visibility changes and removed installations of Tempo's own GitHub App. Tempo checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, constant-time compare) before reading anything, and records each delivery id so a repeat does nothing.
- **What Tempo reads.** With the App's private key (Vercel env only) the server signs a 10-minute JWT and gets an installation token scoped to the one repo that changed, read-only, used once and never stored or logged. It reads only names, dates and counts (`readRepoFactsOnly`): it never fetches a file's contents, not even the README, which it finds in the file list. It keeps only the facts: README present, names of committed secret files, last commit time, open pull request and issue counts, live link. It runs no AI.
- **Where it can write.** Only through `github_save_facts`, which needs Tempo's server key (stored in the database only as a SHA-256 hash) and writes only `signals`, the push time and the repo's id, name, visibility and default branch, cleaned and capped, into apps of workspaces linked to the installation that sent the push. It can't touch cards, owners, tasks or members.
- **Linking.** Only an owner or admin links a workspace, through the server: it asks GitHub which installations the person's own token can see (an installation id from a URL is never trusted), and the database links only those whose account owns the workspace's repos or is its GitHub org. Removing or suspending the App on GitHub unlinks it.
- **Browser saves.** A browser holding an older copy can't wipe newer facts, and can't stamp facts in the future (the save trigger keeps the later `syncedAt`, capped at the server clock).
- **Daily check.** `/api/github-daily` answers only Vercel Cron's secret and refreshes linked repos not refreshed in a day.

## Coding-agent heartbeats (removed)

- Removed in migration 0021: the hook endpoint, heartbeat keys, the one-line setup and the MCP `report_activity` call are dropped, with every stored heartbeat. Tempo learns about work only from GitHub.

## AI

- **The AI key stays in the browser** (IndexedDB) and is sent only to the provider the person chose. It is left out of exports and wiped on sign-out or when the provider changes. A custom endpoint must use https; plain http is allowed only for a model on the same machine (localhost).
- **Secrets are removed before anything is sent.** Every text field that goes to the provider passes through redaction of common key and password formats: cloud provider keys, GitHub, Slack, Stripe, GitLab, npm and Google tokens, JWTs, private keys, passwords in URLs and `key=value` assignments. Tempo never fetches the contents of `.env` files, only their paths.
- **AI output is treated as untrusted text.** Every answer is validated against a zod schema. Card fields are clipped and stripped of markdown. Links in AI-written handover notes are kept only if they match a URL Tempo read from the repo. Nothing the AI returns is executed or rendered as HTML: the codebase has no `dangerouslySetInnerHTML`, `innerHTML` or `eval`. People approve every card before it is saved.

## AI through MCP

Tempo has an MCP server at `/api/mcp`, so people can use the AI app they already use instead of their own key (`VITE_AI_MODE` is `legacy`, `both` or `mcp`). The app reads their portfolio and writes drafts back. This section is about that path.

- **Sign-in is per person.** Supabase's OAuth 2.1 server is the authorization server, and Tempo hosts only the consent page at `/oauth/consent`. The token is the person's own Supabase token plus a `client_id`, so row-level security and roles apply to the AI app exactly as they do to the person.
- **What an AI app can read.** Nothing directly. A client token can only POST to five `mcp_*` database functions; a pre-request guard refuses every other Data API call, and restrictive policies hide every table row from it (migration `0017`). The read functions return what its user can see, minus emails, avatars, access notes and the text of stored handovers. Secrets are redacted in every MCP answer.
- **What it can write.** Only drafts, through the same functions. A card lands unchecked in the Review queue. A handover pack lands unchecked, and can't be copied or downloaded until someone who may edit the app marks it checked. The functions check shapes, cut lengths, strip invisible and bidi characters, and keep an evidence link only when it points into the app's own repo, so a direct call gets the same rules as the MCP server. An agent's tasks (`mcp_submit_tasks`, migration 0018) are plain text tied to a health flag the app has right now; they replace that app's open agent tasks, show its name, can be removed by anyone who may edit the app, and close on their own once the flag is gone. Tempo never writes to GitHub.
- **A browser can't write as an AI app.** The write functions refuse any caller whose token has no `client_id` (`is_agent()`), so a signed-in browser can't call them to add or reword cards or tasks. A database trigger (migration 0018) also guards browser saves of an app: each save names the server version it was edited from, and an agent's card or handover written after that version is kept. On tasks a browser may only mark one fixed or removed (with the server's clock), restore one, or drop one, never add or reword one. It can't put an AI app's name (`draftedBy`) on a card or write a handover either (migration 0019), so "Drafted by Claude" is always true. With the person's own AI key, the browser adds tasks through `key_submit_tasks` (0019): only the app's owner or an admin, never an AI app's token, the same text cleaning and limits as an agent's tasks, and the key named as the author. One gap is known and accepted: an owner who deletes their own app and re-creates it (what Undo does) stores it as sent.
- **The browser cleans drafts again.** A stored handover is checked against the schema and cleaned once more before it is shown: plain text, secrets redacted, and links only into the app's own repo.
- **Tempo never stores the AI app's tokens.** Supabase holds the grant. Revoking it in Settings deletes that app's sign-in, and both `/api/mcp` and the database guard check the sign-in on every call, so the app is cut off at once, not when its token expires.
- **Signing out of Tempo signs out only that browser** (`signOut({ scope: 'local' })`). Supabase's default global sign-out also deletes the sessions behind connected AI apps while their grant stays listed (supabase/auth#2801), which would cut Claude off silently. Revoke is the way to cut an AI app off.
- **The token is still a Supabase session for its user,** so it also works against Supabase Auth's own endpoints (for example reading the user's profile). Tempo signs in with GitHub only and email/password sign-in is turned off, so an AI app can't add a password login that would outlive a revoke.
- **GitHub tokens never reach the MCP server.**
- **The consent page** shows the app's name, the address it returns to and the signed-in account. Allow and Deny both send the browser to the address Supabase's OAuth server returns, and Tempo refuses script-like addresses (`javascript:`, `data:` and similar). While the Claude window waits for a connection, it keeps its own message for Claude (workspace and app names, no secrets) in this browser's localStorage for up to 30 minutes; when a Claude app is allowed, the consent page copies that message to the clipboard. Nothing from the requesting app goes into it, and other apps get nothing copied.

## The browser

- An enforced Content-Security-Policy: scripts only from Tempo itself plus one hashed inline script, no plugins, no `<base>` changes, no framing, forms only to Tempo. A test fails if the inline script changes without its hash.
- HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a Permissions-Policy, and a Cross-Origin-Opener-Policy.
- The Inter font stylesheet is pinned to one version with a Subresource Integrity hash.
- Analytics are cookieless page counts (Vercel Web Analytics). Only the page name is sent, from a fixed list, never ids, tokens or query strings.
- Imported backup files are validated against schemas before anything is loaded.
- `npm audit` reports no known vulnerabilities in production dependencies (5 October 2026).

## Known gaps

These are open on purpose or not done yet:

- **CSP `connect-src` allows any https address,** because people can point Tempo at their own AI provider. The policy's main protection is on scripts. `style-src` allows inline styles.
- **Google Fonts stylesheets can't carry an integrity hash.**
- **An invite link is the credential.** Whoever opens a valid link and signs in can use it, even one addressed to a specific email. Personal links are single-use and every link expires. A plain team link is reusable until it expires.
- **Placeholders are matched by GitHub username,** so a username that changes hands on GitHub could match an old placeholder.
- **The GitHub login shown on a member row** is copied from their profile, which they can edit. It affects what is displayed, not what anyone can access.
- **Pattern-based redaction** catches common secret formats, not every possible secret. That holds for MCP answers too. An agent that calls the database functions directly skips the server's redaction and markup flattening; the functions still enforce shape, length, invisible-character stripping and the repo-only link rule, and the text it writes is its own user's.
- **Check all** in the Review queue checks every listed draft in one click, agent-written ones included. It is a person's deliberate action, and each card shows who drafted it.
- **An AI app names itself.** Apps register themselves with Supabase, so the name on the consent page and in a draft's author line is what the app reported. Tempo can't verify it. The consent page also shows the address the app returns to.
- **Not built yet:** rate limiting on the sign-in endpoints beyond Vercel's defaults, error tracking, uptime monitoring, automated checks on every push, in-app account deletion, and automatic database backups (on Supabase's free plan, take your own, for example with `supabase db dump`).
- **A development address in the sign-in redirect list** (`http://localhost:5173/**`) is convenient but best kept off a production Supabase project. PKCE makes a code captured there useless.

## Setting up your own copy

- **The setup helpers keep secrets out of sight.** `scripts/setup/github-app.mjs` listens on localhost only, checks a random `state` on GitHub's redirect, trades the one-time code once, and writes the App's keys to `.tempo-setup/github-app.json` (readable by your user only, ignored by git). It prints only the App's slug, id and client ID. `scripts/setup/vercel-env.mjs` passes every value to the Vercel CLI over stdin, never as an argument, and prints only the SHA-256 of the server key.
- **The database never sees the server key itself,** only its SHA-256 hash in `public.server_keys`.
- Delete `.tempo-setup/` once your hosting has the values, or keep it somewhere safe: it holds the App's private key.

## Reporting a problem

Please report vulnerabilities privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability**. Don't open a public issue. Include what you found and how to reproduce it.

If you run your own copy of Tempo, problems in your own setup (your Supabase project, your hosting, your GitHub App) are yours to fix; anything in Tempo's code belongs here.
