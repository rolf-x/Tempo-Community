// Motion rules. Use these; don't invent durations per view.
export const EASE: [number, number, number, number] = [0.2, 0, 0, 1]

export const DUR = { fast: 0.15, base: 0.18, slow: 0.26 } as const

/** Content entering: fade + 4px rise. Spread onto a motion element. */
export const fadeUp = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: DUR.base, ease: EASE },
}

/** Popovers / modals: fade + slight scale from the anchor. */
export const scaleIn = {
  initial: { opacity: 0, scale: 0.98, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 6 },
  transition: { duration: DUR.base, ease: EASE },
}

/** Shared-layout indicators (segmented control, tabs). */
export const spring = { type: 'tween', duration: DUR.base, ease: EASE } as const

/** List items: stagger children by 30ms. Put on the parent with `initial="hidden" animate="show"`. */
export const listStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
}
export const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
}
