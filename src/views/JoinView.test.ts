import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvitePreview } from '../lib/invites'

const { acceptInvite, acceptInviteApps } = vi.hoisted(() => ({
  acceptInvite: vi.fn(),
  acceptInviteApps: vi.fn(),
}))

vi.mock('../data/workspace', () => ({
  acceptInvite,
  acceptInviteApps,
  previewInvite: vi.fn(),
}))

import { acceptJoinInvite } from './JoinView'

const preview = (apps: InvitePreview['apps']): InvitePreview => ({
  status: 'ok',
  inviterName: 'Maya',
  workspaceName: 'Halden Freight',
  apps,
})

beforeEach(() => {
  acceptInvite.mockReset().mockResolvedValue('Halden Freight')
  acceptInviteApps.mockReset().mockResolvedValue('Halden Freight')
})

describe('acceptJoinInvite', () => {
  it('uses the workspace invite RPC for a plain team link, including a removed member rejoining', async () => {
    await expect(acceptJoinInvite('fresh-token', preview([]), [], '')).resolves.toBe('Halden Freight')
    expect(acceptInvite).toHaveBeenCalledWith('fresh-token')
    expect(acceptInviteApps).not.toHaveBeenCalled()
  })

  it('leaves app-scoped invitations on their existing RPC', async () => {
    const apps = [{ id: 'app-1', name: 'Route planner' }, { id: 'app-2', name: 'Fuel log' }]
    await acceptJoinInvite('app-token', preview(apps), ['app-1'], ' Not mine ')
    expect(acceptInviteApps).toHaveBeenCalledWith('app-token', ['app-1'], ' Not mine ')
    expect(acceptInvite).not.toHaveBeenCalled()
  })
})
