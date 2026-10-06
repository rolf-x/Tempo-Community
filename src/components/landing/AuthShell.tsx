// Frame for the public auth pages (login, join): wordmark top-left, one centred card, an optional line below it.
// The header sits above main: main's negative top margin (centring on desktop) would otherwise cover the wordmark link.
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { toHash } from '../../lib/router'
import { Wordmark } from '../Logo'
import { Card, fadeUp } from '../ui'

/** `homeHref` is for pages served from a real path (the consent page), where a `#/…` link would stay on that page. */
export function AuthShell({ children, below, homeHref = toHash({ name: 'welcome' }) }: { children: ReactNode; below?: ReactNode; homeHref?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="relative z-10 flex h-14 shrink-0 items-center px-5 sm:px-8">
        <a href={homeHref} className="focus-ring rounded-md" aria-label="Tempo home">
          <Wordmark />
        </a>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-4 sm:-mt-14 sm:items-center sm:pt-0">
        <motion.div {...fadeUp} className="w-full max-w-sm">
          <Card className="p-6 sm:p-8">{children}</Card>
          {below && <p className="mt-4 text-center text-xs text-text-faint">{below}</p>}
        </motion.div>
      </main>
    </div>
  )
}
