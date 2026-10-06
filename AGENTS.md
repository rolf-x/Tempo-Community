# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor and others) working in this repo. There are two jobs:
1. **Helping someone self-host Tempo:** the runbook below. In Claude Code, `/setup` starts it.
2. **Changing the code:** [Working on the code](#working-on-the-code).

Tempo is a portfolio tracker for the apps a company builds with AI tools. It reads GitHub repos and keeps a card, health
signals and next steps for each app. It runs on Supabase, Vercel and a GitHub App. The README explains it for people.
This file is for you.

---

## Self-hosting runbook

Your job: get this person a working Tempo on their own accounts, one step at a time.
- **Do and check.** Run what you can yourself, and check each step before moving on.
- **Exact instructions.** Where only the person can act (a dashboard click, a password), say exactly what to do, with
  every value filled in.
- **Keep the person informed.** Keep them told where they are ("step 3 of 8") in plain words.
- **The README's [Self-hosting](README.md#self-hosting) section is the reference.** This runbook adds how to do and
  check each step. If the two ever disagree, the code wins: say so.

### Rules for secrets (always)
- **Never print, `cat`, `echo` or read into your context:**
  - `.tempo-setup/github-app.json`;
  - any `.env*` file other than `.env.example`;
  - a `.pem`;
  - a client secret, webhook secret, `TEMPO_SERVER_KEY`, `CRON_SECRET` or `GITHUB_TOKEN_KEY`;
  - the Supabase database password or service-role key.
- **Never ask the person to paste a secret into the chat.**
  - **Fine to share:** the Supabase project URL and anon key, the GitHub App's slug, App ID and client ID, and their
    site's address.
- **If a command needs a secret typed in** (for example `supabase link` asks for the database password), have the
  person run it themselves. In Claude Code they type it with a leading `!`, such as `! supabase link --project-ref <ref>`.
- **To move a secret without seeing it, pipe it:**
  - **Into Vercel:** `scripts/setup/vercel-env.mjs` does this.
  - **To the clipboard,** so they can paste it into a dashboard:
    `node -e 'process.stdout.write(require("./.tempo-setup/github-app.json").client_secret)' | pbcopy`
    (`clip` on Windows, `xclip -selection clipboard` on Linux).
- **Tempo never needs the Supabase service-role key.** If anything asks for it, stop: something is wrong.
- **Never commit** `.tempo-setup/`, `.env*` files or `supabase/.temp/`. Check `git status` before any commit the person
  asks for.

### Step 0: the path and the tools
1. **The path.** Explain it in two sentences: **Supabase** (database and sign-in), **Vercel** (hosting) and **their
   own GitHub App**, all on free plans, about 30 minutes. That is the supported path.
   - **Self-hosted Supabase or another host:** explain what it costs. A custom Supabase domain needs the `connect-src`
     line in `vercel.json` changed, the MCP sign-in expects the plain `https://<ref>.supabase.co` issuer, and another
     host means porting `api/` and `vercel.json`.
   - Go on only once they choose.
2. **Ask:** is the GitHub App for a personal account or an organization (which one)? Will people from more than one
   GitHub account install it? (If not, `--private`.)
3. **Check the tools:**
   - `node -v` (needs 20.19+ or 22.12+), `git --version`, `openssl version`;
   - optionally `supabase --version`, `vercel --version` and `gh --version`.
   - For a missing optional CLI, offer the dashboard route, or its install command. **Install nothing without a yes.**
4. **Dependencies:** `npm install`.

### Step 1: Supabase project
- **The person creates the project** at supabase.com (free plan).
- **Ask them for:** the Project URL (`https://<ref>.supabase.co`) and the anon public key (Project Settings → API).
  Both are public. Remember them.
- **Check:** `curl -s -o /dev/null -w '%{http_code}' https://<ref>.supabase.co/auth/v1/health -H "apikey: <anon>"`
  answers `200`.

### Step 2: Database
- **With the CLI:**
  - `supabase init` if `supabase/config.toml` is missing; answer no to the editor-settings prompts.
  - The person runs `! supabase link --project-ref <ref>` (it asks for the database password).
  - Then run `supabase db push`.
  - **Check:** `supabase migration list` shows 0001 to 0023 both locally and remotely.
- **Without the CLI:** the person pastes each file of `supabase/migrations/` into the SQL Editor, in order, and runs
  it. Give them the file list.
- **Proof:** the person pastes `supabase/tests/rls.sql` into the SQL Editor and runs it. It must end with `RLS: all
  checks passed`. If it stops with `FAIL: …`, read that line with them before going on.

### Step 3: Vercel project
- **Import:** they fork the repo on GitHub, then in Vercel choose Add New → Project and import the fork. Or, with the
  CLI, run `vercel link` here (it can create the project) and `vercel deploy --prod`.
- **Their address:** ask for it, for example `https://their-tempo.vercel.app`.
- **Check:** `curl -s -o /dev/null -w '%{http_code}' <address>` answers `200`, and `.vercel/project.json` exists if
  they used the CLI.

### Step 4: GitHub App
- **Run** `node scripts/setup/github-app.mjs --domain <address> --supabase https://<ref>.supabase.co`. Add
  `--org <org>` and `--private` as they chose.
  - **What happens:** it opens their browser on GitHub with every setting filled in. They check the name (GitHub App
    names are unique across GitHub; they can edit it there) and press **Create GitHub App**.
  - **What comes back:** the terminal prints the slug, App ID and client ID. The keys are saved to
    `.tempo-setup/github-app.json`.
- **Check:** `ls -l .tempo-setup/github-app.json` shows `-rw-------`. Don't open it.
- **Install:** the person installs the App from `https://github.com/apps/<slug>/installations/new` on the account or
  organization whose repos Tempo should see.
- **If the helper can't be used**, walk them through the manual table in the README (step 4), field by field.

### Step 5: Sign-in settings in Supabase
The person sets these in the dashboard. Give each value exactly. (Dashboard labels can shift a little over time.
Describe the setting, not only the menu path.)

| Setting | Value |
|---|---|
| **Authentication → Providers → GitHub** | On. Client ID = the App's client ID (from step 4); client secret = the App's (copy it to their clipboard with the pipe above). |
| **Authentication → Providers → Email** | Off. |
| **Authentication → URL Configuration** | Site URL `<address>`. Redirect URLs `<address>/**`, plus `http://localhost:5173/**` only if they'll develop locally. |
| **Authentication → OAuth Server** | On; authorization path `/oauth/consent`; dynamic client registration on. |
| **Project Settings → JWT Keys** | Asymmetric signing keys, if the project still uses the legacy shared secret. |

### Step 6: Vercel variables, the server key, redeploy
- **Ask for a contact email first.** This is the address where people ask to delete their account; it's shown on the
  Privacy page. It's optional: without one, the page says to ask whoever runs their Tempo.
- **Set the variables:** run `node scripts/setup/vercel-env.mjs --site-url <address> --supabase-url
  https://<ref>.supabase.co --anon-key <anon> --contact-email <email>`. It needs the Vercel CLI, logged in, and this
  folder linked (`vercel link`). Add `--ai-mode mcp` if they want Claude only.
  - Every line should show `✓`.
  - `–` means already set: ask before re-running with `--replace`.
- **The server key:** it prints one `insert into public.server_keys …` line containing a SHA-256 hash (not a secret).
  The person runs it in the SQL Editor.
  - If they set the variables by hand instead, generate the key so you never see it. For example, `KEY=$(openssl rand
    -base64 48)` piped to `vercel env add TEMPO_SERVER_KEY production --sensitive --yes`, with the same variable piped
    to `shasum -a 256` for the hash, in one command.
- **Redeploy:** `vercel deploy --prod`, or a push to their main branch.
- **Check:**
  - `curl -s -o /dev/null -w '%{http_code}' <address>/api/mcp` → `401`;
  - `curl -s -o /dev/null -w '%{http_code}' -X POST <address>/api/github-webhook` → `401` (`503` means a variable is
    missing);
  - `curl -s <address>/.well-known/oauth-protected-resource/api/mcp` → JSON whose `authorization_servers` names
    their Supabase URL.

### Step 7: Their address and contact email
- **Nothing to edit by hand.** `index.html`'s link-preview tags hold `%VITE_SITE_URL%`, which Vite replaces at build
  time, and the Privacy page reads `VITE_CONTACT_EMAIL`. Both were set in step 6.
- **Check:** `curl -s <address> | grep og:url` shows their address, not `%VITE_SITE_URL%`. If it shows the placeholder,
  `VITE_SITE_URL` was missing at build time: set it and redeploy.

### Step 8: Check it end to end, with the person
1. **Sign in.** Open the address, sign in with GitHub, create a workspace and add a few repos.
2. **Integrations.** **Settings → Integrations** says updates on every push are on (an owner or admin who connected
   GitHub turns them on).
3. **A push.** Push a commit to one of those repos: within a minute, the app shows it.
4. **Optional, Claude:** **Settings → Connect your AI**, then follow the steps on screen.
5. **Tidy up:** suggest deleting `.tempo-setup/` (or moving it somewhere safe). It holds the App's private key.

### Troubleshooting
| What they see | Likely cause |
|---|---|
| Sign-in button errors in production | `VITE_GITHUB_APP_SLUG` or the Supabase variables missing at build time: set them and redeploy |
| GitHub sends them back to Tempo without signing in, or loops | Supabase redirect URLs or Site URL don't match the address |
| `503` with `not_configured` from `/api/github*` or `/api/mcp` | A server variable is missing or malformed (`GITHUB_TOKEN_KEY` must be base64 of 32 bytes) |
| Webhook deliveries fail with 401 in the App's Advanced tab | `GITHUB_WEBHOOK_SECRET` differs from the App's webhook secret |
| Push updates never arrive | The App isn't installed on that repo's account, the hash in `server_keys` doesn't match `TEMPO_SERVER_KEY`, or no owner/admin has connected GitHub yet |
| Live updates in the page don't arrive | A custom Supabase domain is blocked by `connect-src` in `vercel.json` |
| Claude can't connect, or gets 401 after signing in | OAuth Server or dynamic client registration is off, or the Supabase URL isn't the plain `<ref>.supabase.co` form |
| The daily refresh never runs | `CRON_SECRET` missing |

---

## Working on the code

### Commands
```bash
npm run dev                         # http://localhost:5173 (see README → Try it locally for the settings it needs)
npm run build                       # tsc + vite build
npm test                            # vitest
VITE_AI_MODE=legacy npx vitest run  # run the suite in all three AI modes before calling a change done:
VITE_AI_MODE=both npx vitest run
VITE_AI_MODE=mcp npx vitest run
npx tsc -p api/tsconfig.json --noEmit
```

### Layout
- `src/`: the React app.
  - `views/` and `components/`: what people see.
  - `store/`: Zustand, persisted to IndexedDB.
  - `data/`: Supabase and the cloud sync.
  - `ai/`: providers, zod schemas, and small pure tools in `ai/tools/`.
  - `lib/`: pure helpers.
- `api/`: Vercel functions.
  - `github.ts`: the read-only GitHub proxy.
  - `github-session.ts`: the sealed token cookie.
  - `github-webhook.ts`, `github-link.ts` and `github-daily.ts`: updates on every push.
  - `mcp.ts`: the MCP server. Its logic lives in `api/_lib/`.
- `server/`: Vite dev plugins that serve the same `api/` functions locally, plus a dev-only bridge to the `claude` CLI.
- `supabase/migrations/`: `0001` to `0023`, applied in order. `supabase/tests/`: `rls.sql`, `authz_negative.sql` and
  `mcp_edge_cases.sql`, each run in one rolled-back transaction.
- `architecture/`: the written procedure behind each AI feature.
- `docs/design.md`: the UI rules.
- `scripts/setup/`: the self-hosting helpers.

### Rules a change has to keep
- **Every table has row-level security.** A new table needs its policies and new cases in `supabase/tests/rls.sql`.
  Every `security definer` function sets `search_path = ''`.
- **Migrations:** add a new numbered migration; never change what an applied one does.
- **GitHub access stays read-only.** Server code never fetches file contents for push updates; it reads names, dates
  and counts.
- **AI output is untrusted.**
  - Validate it against the zod schemas in `src/ai/schemas.ts`, clip and clean it, and never render it as HTML.
  - AI writes drafts only, which a person checks.
  - An MCP client's token reaches only the `mcp_*` database functions.
- **Secrets stay out:** none in the repo, logs or AI prompts. Repo text is redacted before any AI sees it.
- **The pages that describe what's stored must stay true.** If a change alters what Tempo stores or sends, update the
  Privacy page (`src/views/PrivacyView.tsx`) and `SECURITY.md` in the same change.
- **UI:** follow `docs/design.md`. Every view has an empty, a loading and an error state.
