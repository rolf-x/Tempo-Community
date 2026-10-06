import { Page, PageHeader } from '../components/ui'
import { WorkspaceCard } from '../components/settings/WorkspaceCard'
import { ADD_API_KEY_EVENT, AI_CONNECTION_ID, AIConnectionCard } from '../components/settings/AIConnectionCard'
import { ConnectAICard } from '../components/settings/ConnectAICard'
import { AppearanceCard, AboutCard } from '../components/settings/AppearanceAbout'
import { DataCard } from '../components/settings/DataCard'
import { IntegrationsCard } from '../components/settings/IntegrationsCard'
import { aiMode, mcpEnabled } from '../lib/aiMode'

/**
 * The picker's "API key" choice: once the picker has closed and let go of focus, bring the API keys card into view and
 * open its Add dialog, so the next step is on screen.
 */
function showApiKeyCard() {
  window.setTimeout(() => {
    document.getElementById(AI_CONNECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.dispatchEvent(new Event(ADD_API_KEY_EVENT))
  }, 0)
}

export default function SettingsView() {
  const mode = aiMode()
  return (
    <Page width="narrow">
      <PageHeader title="Settings" subtitle="Workspace, integrations, AI and data." />
      <div className="space-y-3">
        <WorkspaceCard />
        <IntegrationsCard />
        {/* Claude (MCP) is on in `both` and `mcp`; the API key sits next to it only in `both`, and alone in `legacy`. */}
        {mcpEnabled() && <ConnectAICard onUseApiKey={mode === 'both' ? showApiKeyCard : undefined} />}
        {mode !== 'mcp' && <AIConnectionCard />}
        <AppearanceCard />
        <DataCard />
        <AboutCard />
      </div>
    </Page>
  )
}
