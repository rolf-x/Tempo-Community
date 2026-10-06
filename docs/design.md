# Tempo design system

Calm Notion/Linear look: warm neutrals, one indigo accent, 13–14 px Inter, hairline borders, soft shadows, small motion.
Tokens live in `src/index.css`, primitives in `src/components/ui`. Import: `import { Button, Page } from '../components/ui'`.
Follow this file to the letter; if something is missing, add it to the kit rather than inventing it in a view.

## Tokens (Tailwind utilities; every colour flips with `.dark` on `<html>` — never write `dark:` for colours)

| Use | Utilities |
|---|---|
| Canvas: sidebar, board columns, empty-state icon tile | `bg-bg` |
| Content area, cards, inputs, modals, popovers | `bg-surface` |
| Hover / selected rows, soft fills, segmented track, kbd | `bg-surface-2` (pressed / bar track: `bg-surface-3`) |
| Hairline borders | `border-border` (hover: `border-border-strong`) |
| Text | `text-text` · secondary `text-text-muted` · placeholders, hints, counts `text-text-faint` |
| Accent (one primary action per view) | `bg-accent text-accent-ink hover:bg-accent-hover` · tints `bg-accent-soft text-accent` |
| Status | `danger` / `success` / `warning` + `-soft`, e.g. `bg-danger-soft text-danger`, `text-success` |
| Priority | `text-prio-urgent bg-prio-urgent-soft` (also `high`, `medium`, `low`); maps `PRIORITY_COLOR[p].text/.soft/.dot`, labels `PRIORITY_LABEL` |
| Project colour | `bg-p-violet` dot · `bg-p-violet-soft` tint · `text-p-violet` (slate violet blue teal green amber rose); map `PROJECT_COLOR[color].dot/.soft/.text/.border` |
| Scrim, toast | `bg-overlay` · `bg-toast text-toast-ink` |

- Radius: `rounded-sm` 6 · `rounded-md` 8 (buttons, inputs, rows) · `rounded-lg` 12 (cards, popovers, columns) · `rounded-xl` 16 (modals) · `rounded-full` (chips, avatars).
- Shadows: `shadow-xs` buttons/inputs/cards · `shadow-sm` hover lift · `shadow-md` popovers · `shadow-lg` modal/drawer/toast.
- Type: `text-xs` 11 (chips, hints) · `text-sm` 13 (UI default: rows, buttons, labels, inputs) · `text-base` 14 (body copy, notes) · `text-lg` 16 · `text-xl` 20 (page titles) · `text-2xl`/`text-3xl` (Today headline, savings figure). Weights: 400 body, 500 rows/labels, 600 titles. Numbers: `tabular-nums`.
- Utilities: `focus-ring` (any custom interactive element) · `field` (input chrome) · `skeleton` · `scrollbar-none` · `hairline-b`.

## Primitives (`src/components/ui`) — props, then one usage line

- **Button** `{ variant?: 'primary'|'secondary'(default)|'ghost'|'danger', size?: 'sm'|'md', icon?: LucideIcon, loading?, block? }` + native button props. `<Button variant="primary" icon={Sparkles} loading={busy}>Build project</Button>`
- **IconButton** `{ icon, label (required: aria-label + tooltip; include the shortcut), size?: 'xs'|'sm'|'md', variant?: 'ghost'|'secondary', active? }`. `<IconButton icon={X} label="Close · Esc" onClick={close} />`
- **Input** `{ size?: 'sm'|'md'|'lg', icon?, invalid? }` + native props. `<Input icon={Search} placeholder="Search…" autoFocus />`
- **Textarea** `{ autoGrow?, bare?, invalid? }`. `<Textarea bare autoGrow rows={4} placeholder="What's on your mind?" />`
- **Select** `{ options?: { value, label, disabled? }[], size?, invalid? }` or `<option>` children. `<Select value={priority} onChange={e => …} options={PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABEL[p] }))} />`
- **Checkbox** `{ checked, onChange(next), size?: 'sm'|'md', label?, disabled?, 'aria-label'? }` round, animated tick. `<Checkbox checked={t.status === 'done'} onChange={() => toggleDone(t.id)} aria-label="Done" />`
- **PriorityBadge** `{ priority, iconOnly? }` · **DueChip** `{ due: string|null, done?, showEmpty? }` (tones from `formatDue`) · **TagChip** `{ tag, onRemove? }`. `<DueChip due={t.dueDate} done={t.status === 'done'} />`
- **ProjectDot** `{ color, size?=8 }` · **Avatar** `{ name: string|null, size?: 'xs'|'sm'|'md' }` (initials, colour from name) · **Kbd** `{ children }` + `MOD` ('⌘' or 'Ctrl'). `<Kbd>{MOD}K</Kbd>`
- **Modal** `{ open, onClose, title?, description?, size?: 'sm'|'md'|'lg'|'xl', footer?, hideClose?, bare?, 'aria-label'? }` portal, Esc + scrim close, focus trap, bottom sheet on phones. A visible `title` labels the dialog; a `bare` modal passes `aria-label`. `<Modal open={open} onClose={close} title="Delete project?" footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" onClick={del}>Delete</Button></>}>…</Modal>`
- **Drawer** `{ open, onClose, title?, actions?, footer?, width?=460 }` right panel, full width on phones. `<Drawer open={!!id} onClose={() => setDrawerTaskId(null)} title={<><ProjectDot color={p.color} /> {p.name}</>}>…</Drawer>`
- **Popover** `{ trigger, children | (close) => node, align?: 'start'|'end', side?: 'bottom'|'top', open?, onOpenChange?, className? }` · **Menu** `{ trigger, items: MenuItem[], align? }`, `MenuItem = { label, icon?, onSelect, danger?, disabled?, shortcut? } | { type: 'separator' }`. `<Menu align="end" trigger={<IconButton icon={Ellipsis} label="More" />} items={[{ label: 'Delete', icon: Trash, danger: true, onSelect }]} />`
- **EmptyState** `{ icon?, title, body?, action?, compact? }`. `<EmptyState icon={Inbox} title="No tasks yet" body="Add one with Q." action={<Button variant="primary">Add task</Button>} />`
- **Skeleton** `{ className }` · **SkeletonText** `{ lines? }` · **SkeletonRow** · **Spinner** `{ size?=16 }`. `<Skeleton className="h-4 w-40" />`
- **ProgressRing** `{ value 0–100, size?=16, stroke?=2, tone?: 'accent'|'success'|'muted' }` · **ProgressBar** `{ value, size?: 'sm'|'md', tone? }`. Below 16 px a ring reads as a spinner: the sidebar shows progress as a `done/total` fraction (`text-[11px] tabular-nums text-text-faint`) and a success `Check` at 100 %.
- **SegmentedControl** `{ value, onChange, options: { value, label, icon? }[], size?, collapseLabels?: 'sm'|'never' }` (icons only below `sm` by default).
- **Chip** `{ selected?, count?, icon? }` + native button props: toggle chip for a filter row (`aria-pressed`; one row per view, first chip "All"). `<Chip selected={filter === 'stale'} count={2} onClick={() => setFilter('stale')}>Stale</Chip>`
- **Page** `{ width?: 'narrow'|'default'|'wide'|'full' }` · **PageHeader** `{ eyebrow?, title, subtitle?, actions? }` · **SectionHeader** `{ title, count?, action? }` · **Card** `{ interactive?, bare? }`.
- **ToastHost** is mounted in App. Undo toasts come from the store (`deleteTask`/`deleteProject` set `undo`). Notices: `useUI.getState().notify('Copied', 'success')`.
- Helpers: `cn(...)`, motion presets `fadeUp`, `scaleIn`, `listStagger` + `listItem`, `spring`, `EASE`, `DUR`.

## Shell and state

- `useUI()` (`src/components/uiState.ts`): `brainDumpOpen · quickAddOpen · commandOpen · drawerTaskId · sidebarOpen · onboardingOpen · toast` with `setX`, `notify`, `dismissToast`, `closeAll`, `anyModalOpen()`. Not persisted. **Modals are exclusive:** opening the brain-dump, quick add or command bar closes the other two and the task drawer, so overlays never stack.
- Overlays mount in `src/components/OverlaySlots.tsx` (BrainDump, QuickAdd, CommandBar on `Modal`; TaskDrawer on `Drawer`). The four are `React.lazy`: each mounts on first open and stays mounted; chunks warm up on idle (`lib/idle.ts`). Open a task: `setDrawerTaskId(task.id)`.
- **Onboarding** (`Onboarding.tsx`, eager) shows once while `settings.onboarded` is false: mark, promise line, three benefits, "Try it with sample data" (primary) and "Start with a brain-dump". Esc, scrim and both buttons mark the user onboarded; it mirrors itself into `onboardingOpen` so shortcuts stay quiet.
- Views are `React.lazy` in `App.tsx` with a `Skeleton` fallback; the landing view starts loading while the store hydrates. Keep heavy deps (`@dnd-kit`, `ai/*`) out of the shell.
- Shortcuts (`useShortcuts.ts`): `n` brain-dump · `q` quick add · `⌘K` command bar · `g t` / `g c` · `Esc`. Ignored while typing or while a modal is open. Modal/Drawer/Popover handle Esc themselves and stop propagation — don't add your own Esc listeners.
- Routes: `useRoute()`, `navigate()`, real links with `href={toHash(route)}`. The Topbar owns the route title and the List · Board · Calendar switch; views never repeat the project name.
- Theme: `settings.theme` → `.dark` on `<html>` via `useTheme`; tokens flip automatically.

## Layout rules

- Every view is wrapped in `<Page width=…>` (padding `px-4 sm:px-8 py-6 sm:py-8`): `narrow` 768 (Today, Settings) · `default` 1024 (List, Savings) · `wide` 1280 (Calendar) · `full` (Board; the column row gets `flex gap-4 overflow-x-auto scrollbar-none`).
- Page title through `PageHeader`; groups through `SectionHeader`; `mt-8` between sections; `space-y-1` between rows, `gap-3` between cards.
- Rows: `min-h-10 rounded-md px-3 hover:bg-surface-2`, no borders between rows (use whitespace); title `text-sm text-text`, chips right-aligned `gap-2`. Cards: `Card` (`p-4 rounded-lg shadow-xs`). Board column: `w-72 shrink-0 rounded-lg bg-bg p-2`.
- Chips are `h-5`; icons are lucide `size-4` in rows/buttons, `size-3.5` in chips, `strokeWidth={2}`.
- Calendar day chips: a 2 px project bar (`border-l-2` + `PROJECT_COLOR[c].border`) instead of a dot, titles `line-clamp-2`, full title in `title`. The "No date" tray sits beside the month only at `xl`; below that it is a wrapped chip row under the grid so day cells keep their width.
- Empty views say what the view is for and offer one action (`EmptyState` in a bare `Card`); hide controls that have nothing to act on (Today hides the time budget and Re-plan when there is nothing to plan).
- Mobile (≥ 375 px): `PageHeader` actions wrap; hide secondary actions with `max-sm:hidden` (a bare `hidden` cannot override a component's own display class); the primary action stays visible; no horizontal page scroll.

## Motion

- Durations: hover 150 ms (`duration-150`), enter 180 ms (`DUR.base`), drawer 260 ms (`DUR.slow`); easing `EASE` [0.2, 0, 0, 1]. Nothing over 300 ms except the ProgressRing fill (500 ms).
- Use the presets: `fadeUp` for content inside a Page (never on the outermost child of a scroll container — a translate adds scrollable overflow), `listStagger`/`listItem` on first render of lists (30 ms stagger), `layout` for reordering, `spring` for sliding indicators.
- Reduced motion is global (`MotionConfig reducedMotion="user"`); nothing extra needed. No bounces, no slides over 8 px, no looping animations outside the splash and the first-run welcome (the metronome `tick`).
- One closure moment: when every pick on Today is done, a `bg-success-soft` card fades in with a check that scales 0.6 → 1.12 → 1 (400 ms). Keep it the only celebratory motion.

## Do / don't

- Do use the tokens above. Don't use Tailwind palette colours (`text-slate-500`, `bg-violet-100`), hex values or `dark:` colour variants.
- Do keep one primary button per view; everything else is secondary or ghost. Do put `focus-ring` on any clickable element that isn't a kit component.
- Do write sentence case ("Add task"), no exclamation marks, the … character, and short labels (≤ 3 words on buttons).
- Do give every view an empty state (`EmptyState`), a loading state (`Skeleton*`) and an error state (a `text-danger` line + retry `Button`).
- Don't nest cards in cards, stack strong borders and shadows, or invent new greys, radii, shadows or font sizes.
- Don't block the UI during AI calls: show the Skeleton/Spinner in place and keep the rest usable.
