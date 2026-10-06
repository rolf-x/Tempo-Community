import { cloneElement, useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { DUR, EASE } from './motion'
import { Kbd } from './Kbd'

/* ── Popover ───────────────────────────────────────────────────────────────── */

type TriggerProps = {
  onClick?: (e: MouseEvent<HTMLElement>) => void
  'aria-expanded'?: boolean
  'aria-haspopup'?: boolean | 'menu' | 'dialog'
  'aria-controls'?: string
}

export interface PopoverProps {
  /** Any clickable element: <Button>, <IconButton>, a chip… */
  trigger: ReactElement<TriggerProps>
  /** Content, or a render function that receives close() */
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  /** Controlled mode */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Panel classes (width, padding). Default: p-1 min-w-[180px] */
  className?: string
  role?: 'menu' | 'dialog' | 'listbox'
}

/** Anchored floating panel. Closes on outside click and Esc. Positioned with CSS under/over the trigger. */
export function Popover({ trigger, children, align = 'start', side = 'bottom', open: controlled, onOpenChange, className, role = 'dialog' }: PopoverProps) {
  const reducedMotion = useReducedMotion()
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = controlled ?? uncontrolled
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const close = useCallback(() => setOpen(false), [setOpen])
  const wrap = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <div ref={wrap} className="relative inline-flex">
      {cloneElement(trigger, {
        onClick: (e: MouseEvent<HTMLElement>) => {
          trigger.props.onClick?.(e)
          setOpen(!open)
        },
        'aria-expanded': open,
        'aria-haspopup': role === 'menu' ? 'menu' : 'dialog',
        'aria-controls': open ? id : undefined,
      })}
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role={role}
            className={cn(
              'absolute z-40 min-w-[180px] max-w-[calc(100vw-2rem)] rounded-lg border border-border-strong bg-surface-2 p-1 shadow-md',
              side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
              align === 'end' ? 'right-0' : 'left-0',
              className,
            )}
            style={{ originX: align === 'end' ? 1 : 0, originY: side === 'bottom' ? 0 : 1 }}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.97, y: side === 'bottom' ? -4 : 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: side === 'bottom' ? -4 : 4 }}
            transition={{ duration: reducedMotion ? 0 : DUR.fast, ease: EASE }}
          >
            {typeof children === 'function' ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Menu ──────────────────────────────────────────────────────────────────── */

export type MenuItem =
  | {
      label: string
      icon?: LucideIcon
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
      /** Key hint shown at the right, e.g. '⌫' */
      shortcut?: string
    }
  | { type: 'separator' }

export interface MenuProps extends Omit<PopoverProps, 'children' | 'role'> {
  items: MenuItem[]
}

/** Dropdown menu built on Popover. Arrow keys move, Enter selects, Esc closes. */
export function Menu({ items, className, ...popover }: MenuProps) {
  return (
    <Popover role="menu" className={cn('min-w-[200px]', className)} {...popover}>
      {(close) => <MenuList items={items} close={close} />}
    </Popover>
  )
}

function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const first = list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    first?.focus({ preventScroll: true })
  }, [])

  const move = (dir: 1 | -1) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + dir + items.length) % items.length]?.focus()
  }

  return (
    <div
      ref={list}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') (e.preventDefault(), move(1))
        else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1))
      }}
    >
      {items.map((item, i) =>
        'type' in item ? (
          <div key={i} role="separator" className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              close()
              item.onSelect()
            }}
            className={cn(
              'focus-ring flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors duration-150',
              'hover:bg-surface-3 focus-visible:bg-surface-3 disabled:opacity-50',
              item.danger ? 'text-danger' : 'text-text',
            )}
          >
            {item.icon && <item.icon className={cn('size-4 shrink-0', item.danger ? 'text-danger' : 'text-text-muted')} aria-hidden />}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
          </button>
        ),
      )}
    </div>
  )
}
