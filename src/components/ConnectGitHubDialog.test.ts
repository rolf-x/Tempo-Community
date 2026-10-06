import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubError } from '../data/github'
import { useSession } from '../data/session'
import { runGitHubGated } from './ConnectGitHubDialog'

beforeEach(() => useSession.setState({ status: 'signed-in', githubToken: null }))

describe('GitHub gate', () => {
  it('runs the action after GitHub connects', async () => {
    const order: string[] = []
    const connect = vi.fn(async () => {
      order.push('connect')
      useSession.setState({ githubToken: 'proxy' })
      return true
    })
    const action = vi.fn(() => { order.push('action'); return 7 })

    await expect(runGitHubGated(action, connect)).resolves.toBe(7)
    expect(order).toEqual(['connect', 'action'])
  })

  it('opens the connection flow and retries one auth failure', async () => {
    useSession.setState({ githubToken: 'proxy' })
    const action = vi.fn()
      .mockRejectedValueOnce(new GitHubError('expired', 'auth'))
      .mockResolvedValueOnce('done')
    const connect = vi.fn(async () => {
      useSession.setState({ githubToken: 'proxy' })
      return true
    })

    await expect(runGitHubGated(action, connect)).resolves.toBe('done')
    expect(connect).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledTimes(2)
  })
})
