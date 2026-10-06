import { CalendarClock, ScanSearch } from 'lucide-react'
import { Button, Card, EmptyState } from '../ui'
import type { PortfolioFilter } from './derive'

/** Shown when the filters leave no app. "Changed this week" alone gets its own wording. */
export function NoMatches({ filter, ownerFiltered, onClear }: { filter: PortfolioFilter; ownerFiltered: boolean; onClear: () => void }) {
  const quietWeek = filter === 'changed' && !ownerFiltered
  return (
    <Card bare>
      <EmptyState
        compact
        icon={quietWeek ? CalendarClock : ScanSearch}
        title={quietWeek ? 'No app changed this week' : 'No apps match'}
        body={quietWeek ? 'An app shows up here as soon as someone pushes to it.' : 'Nothing fits these filters.'}
        action={<Button onClick={onClear}>{quietWeek ? 'Show all apps' : 'Clear filters'}</Button>}
      />
    </Card>
  )
}
