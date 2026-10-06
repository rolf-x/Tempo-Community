import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, GitBranch, LayoutGrid, Moon, Search, Settings, Sun, type LucideIcon } from 'lucide-react'
import { navigate } from '../lib/router'
import { useSession } from '../data/session'
import { activeProjects } from '../store/selectors'
import { useStore } from '../store/useStore'
import { AppIcon, Kbd, MOD, Modal, cn } from './ui'
import { useUI } from './uiState'

interface Item {
  id: string
  section: 'Actions' | 'Apps'
  label: string
  icon?: LucideIcon
  lead?: ReactNode
  hint?: string
  run: () => void
}

/** Subsequence match: lower is better, null = no match. Prefix and substring beat scattered letters. */
function score(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  if (t.startsWith(q)) return 0
  const at = t.indexOf(q)
  if (at >= 0) return 1 + at / 100
  let i = 0
  let gaps = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    else if (i > 0) gaps++
    if (i === q.length) return 2 + gaps / 100
  }
  return null
}

const rank = <T,>(rows: T[], q: string, text: (r: T) => string): T[] =>
  rows
    .map((r) => ({ r, s: score(q, text(r)) }))
    .filter((x): x is { r: T; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.r)

export function CommandBar() {
  const open = useUI((s) => s.commandOpen)
  const setOpen = useUI((s) => s.setCommandOpen)
  const projects = useStore((s) => s.projects)
  const signedIn = useSession((s) => s.status === 'signed-in')
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setQ('')
      setActive(0)
    }, 250)
    return () => clearTimeout(t)
  }, [open])

  const items = useMemo<Item[]>(() => {
    const close = () => useUI.getState().setCommandOpen(false)
    const go = (fn: () => void) => () => {
      close()
      fn()
    }
    const ui = useUI.getState()
    const dark = document.documentElement.classList.contains('dark')
    const actions: Item[] = [
      { id: 'a-portfolio', section: 'Actions', label: 'Go to Portfolio', icon: LayoutGrid, run: go(() => navigate({ name: 'portfolio' })) },
      { id: 'a-directory', section: 'Actions', label: 'App directory', icon: FolderOpen, run: go(() => navigate({ name: 'directory' })) },
      ...(signedIn ? [{ id: 'a-add-apps', section: 'Actions' as const, label: 'Add apps', icon: GitBranch, run: go(() => ui.setRepoPickerOpen(true)) }] : []),
      { id: 'a-set', section: 'Actions', label: 'Settings', icon: Settings, run: go(() => navigate({ name: 'settings' })) },
      {
        id: 'a-theme', section: 'Actions', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? Sun : Moon,
        run: go(() => useStore.getState().setSettings({ theme: dark ? 'light' : 'dark' })),
      },
    ]
    const live = activeProjects(projects)
    const projectItems: Item[] = rank(live, q, (p) => p.name).map((p) => ({
      id: `p-${p.id}`, section: 'Apps', label: p.name, lead: <AppIcon name={p.name} color={p.color} />,
      run: go(() => navigate({ name: 'project', projectId: p.id, view: 'app' })),
    }))
    return [...rank(actions, q, (a) => a.label), ...projectItems.slice(0, q.trim() ? 8 : 6)]
  }, [q, projects, open, signedIn])

  const idx = Math.min(active, Math.max(items.length - 1, 0))

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((idx + 1) % Math.max(items.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((idx - 1 + items.length) % Math.max(items.length, 1))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      items[idx]?.run()
    }
  }

  let lastSection = ''
  return (
    <Modal open={open} onClose={() => setOpen(false)} bare size="lg" hideClose>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-text-faint" strokeWidth={2} aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded
          aria-controls="cmd-list"
          aria-activedescendant={items[idx] ? `cmd-${items[idx].id}` : undefined}
          aria-label="Search or run a command"
          name="command"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search apps or run a command…"
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-faint"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={list} id="cmd-list" role="listbox" className="max-h-[min(24rem,60dvh)] overflow-y-auto p-2">
        {items.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-sm font-medium text-text">Nothing matches “{q}”</p>
            <p className="mt-1 text-xs text-text-faint">Try an app name or “settings”.</p>
          </div>
        )}
        {items.map((it, i) => {
          const header = it.section !== lastSection
          lastSection = it.section
          const Icon = it.icon
          return (
            <div key={it.id}>
              {header && <div className={cn('px-3 pb-1 text-xs font-medium text-text-muted', i === 0 ? 'pt-1' : 'pt-3')}>{it.section}</div>}
              <button
                type="button"
                role="option"
                id={`cmd-${it.id}`}
                data-idx={i}
                aria-selected={i === idx}
                onMouseMove={() => i !== idx && setActive(i)}
                onClick={it.run}
                className={cn(
                  'focus-ring flex min-h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-text transition-colors duration-100',
                  i === idx && 'bg-surface-2',
                )}
              >
                <span className="grid size-5 shrink-0 place-items-center text-text-muted">
                  {Icon ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : (it.lead ?? <FolderOpen className="size-4" aria-hidden />)}
                </span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && (it.section === 'Actions' ? (
                  <span className="flex gap-1">{it.hint.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                ) : (
                  <span className="max-w-32 shrink-0 truncate text-xs text-text-muted">{it.hint}</span>
                ))}
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 border-t border-border bg-bg px-4 py-2 text-xs text-text-muted">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
        <span className="ml-auto hidden sm:inline"><Kbd>{MOD}K</Kbd> toggles</span>
      </div>
    </Modal>
  )
}
