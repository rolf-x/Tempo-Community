# SOP · handover ("Handover pack" on an app: repo + agent notes → handover document)

## Goal
When an app's owner leaves (or anyone asks), write the document the next engineer needs: what the app is, how to run it,
where things are, what is open, what is risky, who to ask, and what nobody knows. Buyer: the CTO or Head of Engineering
who has to reassign an orphaned app without a week of archaeology.

## Inputs
- `RepoFacts` from `src/ai/tools/repoFacts.ts` (same fetch path as sync_app: `fetchRepoRaw` → `repoFacts`; sample repos use `sampleFacts`):
  meta, README, up to 4 agent memory files (`MEMORY_FILES`), last 30 commits, open PRs and issues (≤20 each), all text capped at 3,000 characters per file.
- Health flag labels from `src/ai/tools/health.ts` (owner left, secret file, stale, no README…).
- The owner's name, or null.

The message is built in `src/ai/tools/promptInput.ts` (`handoverInput`), and every string in it passes through `redactSecrets` last: app name and description, owner, live link and health labels included.

## Output schema
zod `HandoverOut` in `src/ai/schemas.ts`:
`{ summary, howToRun: string[], whereThingsAre: {path, what}[], openWork: {title, evidenceUrl?}[], risks: string[], contacts: string[], unknowns: string[] }`.

## Rules
- Only facts from the inputs. Nothing from the model's general knowledge about the stack.
- Cite file paths and commit/PR/issue URLs. `evidenceUrl` must be a URL present in the facts, otherwise it is omitted. `cleanHandover` enforces it: the URL has to equal one from the facts, character for character.
- Text from the model (or the repo) is plain text: `cleanHandover` strips links, emphasis and code spans, puts each item on one line and keeps `howToRun` and paths as written. `handoverMarkdown` writes a link only for a `https://github.com/` address. Our own deployment evidence is added after cleaning.
- Never invent people, emails or credentials. `contacts` holds only names/handles in the facts (commit and PR authors). Never print secret values.
- Anything the inputs do not say is listed in `unknowns`, each written as `Unknown — ask <owner>: <what>` (`the team` when there is no owner name).

## Tools
- `src/ai/tools/handoverMarkdown.ts`: `HandoverOut` → markdown (one heading per section; an empty section reads "None found in the repo.").
- `src/ai/tools/handoverFallback.ts` (`fallbackHandover`), used for demo mode, sample repos, no key, or when the AI call fails:
  - summary from the README's first paragraph, else the repo description;
  - howToRun from install/run commands inside README code fences;
  - whereThingsAre from README and the memory files present;
  - open PRs and issues → openWork with their URLs; health flags → risks; contacts empty;
  - unknowns: how to run (if none), notes location (if none), deploy target, accounts and environment variables.
- Router: `aiHandover(projectId)` returns `{ doc, source: 'ai' | 'fallback', markdown }`. It never writes to the store.

## UI
AppView: secondary "Handover pack" button in the Sync card. When health has `owner-left`, a highlighted prompt
"Owner has left — generate a handover pack". A modal shows the rendered doc with "Copy markdown" and "Download .md",
a skeleton while loading, and an error with retry. No Activity entry (no existing `ActivityKind` fits; `sync` means a repo sync).

## Edge cases
- No repo connected: button disabled, "Connect a repo to write a handover pack."
- GitHub token missing, expired or rate-limited: the same errors as sync, shown with retry.
- AI failure: fallback document, with a quiet "Written from repo data" label.

## MCP path (replaces the AI call when `VITE_AI_MODE` is `mcp`)
- The MCP prompt `handover` carries the system prompt above word for word, plus steps ending in `submit_handover`.
- `submit_handover` runs `cleanHandoverDraft` (`src/ai/tools/mcpDrafts.ts`): `cleanHandover` plus redaction, invisible
  characters removed, at most 20 items per list and 300 characters per item; an `evidenceUrl` survives only when it is
  exactly an issue, pull request or commit page of the app's own repo on `https://github.com/`.
- `mcp_submit_handover` (migration 0017) checks every element's shape, cuts each item to 300 characters, strips invisible
  characters, keeps an `evidenceUrl` only into the app's own repo, and stores it as `project.handover` with `draftedBy`
  and `checkedAt: null`. Only the app's owner or an admin may write it.
- `HandoverModal` shows the stored pack first, checked against `HandoverOut` and cleaned again with `cleanHandoverDraft`
  (an agent can call the database function directly), with "Written by … for …", and offers "Rebuild from repo facts".
  While it is unchecked, Copy and Download are off and the owner or an admin gets "Mark as checked" (`checkHandover`).
