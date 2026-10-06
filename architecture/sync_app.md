# SOP · sync_app

## Goal
Keep an app card current from repository facts and coding-agent activity. Sync never writes to GitHub.

## Inputs
- `RepoFacts` from `src/ai/tools/repoFacts.ts`: repo metadata, README, agent memory files, recent commits, open pull requests and open issues.
- The current date.

Repo text is redacted before it reaches the model. Each file is capped at 3,000 characters.
The whole message is built in `src/ai/tools/promptInput.ts`, which runs `redactDeep` (`redactSecrets` over every string) as its last step:
app name and description, author logins, labels and links are covered too, not only repo text. The privacy page lists exactly these fields.

## Prompt
The system prompt in `src/ai/prompts.ts` asks for one card:
- `what`: what the app does;
- `who`: who uses it;
- `stage`: idea, building, live or stale;
- `status`: what changed, what is next and what is blocked.

The user message is JSON `{ app, facts }`. The model must use only supplied facts and call `sync_app`.

## Schema
`SyncAppOut` in `src/ai/schemas.ts` contains only `{ card }`. There are no work-item operations.

## Apply
`src/ai/tools/applySync.ts` trims the card, adds evidence and builds a facts-only fallback when AI is unavailable. `commitSync` saves the card and repo health signals, then records one sync activity entry.

## Edge cases
- No repo: show Connect repo.
- Missing or expired GitHub access: keep the current card and ask to reconnect.
- Sample repos: build facts from seeded activity without a network request.
- Rate limit: show the GitHub reset time.

## MCP path (replaces the AI call when `VITE_AI_MODE` is `mcp`)
The user's own agent does the writing, in the repo it already has open. Tempo makes no AI call.
- The MCP prompt `sync_app` (`api/_lib/mcp/tools.ts`) carries the system prompt above word for word, plus steps:
  `find_app` with the git remote → `get_app` (card, health, signals, last 10 activity rows) → read the repo → `submit_app_card`.
- `submit_app_card` runs `cleanCardDraft` (`src/ai/tools/mcpDrafts.ts`): invisible and bidi characters removed, HTML,
  autolinks and markdown links flattened to text, secrets redacted, the same 240/160/400 limits.
- The database function `mcp_submit_card` (migration 0017) saves it as an unchecked draft (`source: 'ai'`,
  `checkedAt: null`) with `draftedBy`, keeps human-edited `what`/`who`, keeps the evidence Tempo read itself, and logs one
  `sync` activity row. Only the app's owner or an admin may write it. A person checks it in the Review queue.
- In `mcp` mode the in-app Sync button runs the facts-only path (provider `none`).
