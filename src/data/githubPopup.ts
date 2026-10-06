export type GitHubPopupMessage = { type: 'connected' } | { type: 'failed' }
export type GitHubPopupResult = { status: 'connected' | 'cancelled' | 'blocked' | 'failed' }

export const GITHUB_POPUP_CHANNEL = 'tempo-github'

let connect: ((signal?: AbortSignal) => Promise<GitHubPopupResult>) | null = null

export function registerGitHubPopupConnector(connector: typeof connect): void {
  connect = connector
}

export function openGitHubPopup(signal?: AbortSignal): Promise<GitHubPopupResult> {
  return connect?.(signal) ?? Promise.resolve({ status: 'failed' })
}

export function isGitHubPopup(search = window.location.search): boolean {
  return new URLSearchParams(search).get('github_popup') === '1'
}

export function stripGitHubPopupParams(): void {
  const params = new URLSearchParams(window.location.search)
  params.delete('github_popup')
  params.delete('code')
  const query = params.toString()
  history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}
