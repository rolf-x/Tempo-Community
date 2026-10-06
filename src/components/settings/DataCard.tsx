import { useRef, useState } from 'react'
import { Download, RotateCcw, Upload } from 'lucide-react'
import { downloadExport, parseImport } from '../../lib/export'
import { navigate } from '../../lib/router'
import { useStore } from '../../store/useStore'
import { Button, Modal } from '../ui'
import { useUI } from '../uiState'
import { Section } from './Section'

type Confirm = { kind: 'import'; data: ReturnType<typeof parseImport> } | { kind: 'reset' } | null

export function DataCard() {
  const file = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [error, setError] = useState('')
  const projectCount = useStore((s) => s.projects.length)
  const notify = useUI((s) => s.notify)
  const workspace = useStore((s) => s.workspace)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setError('')
    try {
      setConfirm({ kind: 'import', data: parseImport(await f.text()) })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.")
    }
    if (file.current) file.current.value = ''
  }

  const apply = () => {
    const store = useStore.getState()
    if (confirm?.kind === 'import') {
      store.replaceData({ projects: confirm.data.projects, members: confirm.data.members, activity: confirm.data.activity })
      notify(`Imported ${confirm.data.projects.length} apps`, 'success')
    } else if (confirm?.kind === 'reset') {
      store.resetAll()
      notify('Everything was reset')
      navigate({ name: 'portfolio' })
    }
    setConfirm(null)
  }

  const copy = {
    import: { title: 'Replace your current data?', body: 'Your apps will be replaced by the contents of this file. Export first if you want a backup.', cta: 'Replace data' },
    reset: { title: 'Reset everything?', body: 'This deletes all apps and settings, including your API key. It cannot be undone.', cta: 'Reset everything' },
  }
  const c = confirm ? copy[confirm.kind] : null
  const danger = confirm?.kind === 'reset'

  // A shared workspace syncs every store change to the team: replacing or resetting it here would delete their data.
  if (workspace) {
    return (
      <Section title="Data" description={`${projectCount} ${projectCount === 1 ? 'app' : 'apps'}, synced to ${workspace.name}.`}>
        <div className="flex flex-wrap gap-2">
          <Button icon={Download} onClick={() => downloadExport(useStore.getState())}>Export JSON</Button>
        </div>
      </Section>
    )
  }

  return (
    <Section title="Data" description={`${projectCount} ${projectCount === 1 ? 'app' : 'apps'}, saved in this browser.`}>
      <div className="flex flex-wrap gap-2">
        <Button icon={Download} onClick={() => downloadExport(useStore.getState())}>Export JSON</Button>
        <Button icon={Upload} onClick={() => file.current?.click()}>Import JSON</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="min-w-0 flex-1 basis-56 text-sm text-text-muted">Delete everything and start from scratch.</p>
        <Button variant="danger" icon={RotateCcw} onClick={() => setConfirm({ kind: 'reset' })}>Reset everything</Button>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={c?.title}
        description={c?.body}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={apply}>{c?.cta}</Button>
          </>
        }
      />
    </Section>
  )
}
