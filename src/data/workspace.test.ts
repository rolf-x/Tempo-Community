import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appDefaults } from '../lib/model'
import type { WorkspaceInvite } from '../lib/invites'
import { useStore } from '../store/useStore'
import { useSession } from './session'
import { changeProjectOwner } from './workspace'

const cloud = vi.hoisted(() => ({
  listInvitesCloud: vi.fn(),
  revokeInviteCloud: vi.fn(),
}))
vi.mock('./cloud', () => cloud)

const invite = (id: string, appIds: string[]): WorkspaceInvite => ({
  id, token: id.padEnd(32, '0'), email: null, createdAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z',
  usedAt: null, declinedAt: null, declineNote: null, appIds, apps: [], inviterName: 'Maya', inviteeName: 'Pat', joinedMemberName: null, url: `https://example.com/${id}`,
})

beforeEach(() => {
  vi.clearAllMocks()
  useStore.getState().resetAll()
  useStore.setState({
    workspace: { id: 'team', name: 'Team', kind: 'org' },
    members: [
      { id: 'pat', name: 'Pat', email: null, avatarUrl: null, githubLogin: null, userId: null, role: 'member', active: true },
      { id: 'sam', name: 'Sam', email: null, avatarUrl: null, githubLogin: null, userId: 'u-sam', role: 'member', active: true },
    ],
    projects: [{ id: 'app', name: 'App', emoji: '📁', color: 'blue', description: '', createdAt: '2026-10-01T00:00:00Z', archived: false, ...appDefaults(), ownerId: 'pat' }],
  })
  useSession.setState({ status: 'signed-in' })
  cloud.revokeInviteCloud.mockResolvedValue(undefined)
})

describe('changeProjectOwner', () => {
  it('revokes only open single-app invites when ownership moves away from a placeholder', async () => {
    cloud.listInvitesCloud.mockResolvedValue([
      invite('stale', ['app']),
      invite('multi', ['app', 'other']),
      invite('answered', ['app']),
    ])
    cloud.listInvitesCloud.mockImplementationOnce(async () => {
      const rows = [invite('stale', ['app']), invite('multi', ['app', 'other']), invite('answered', ['app'])]
      rows[2].usedAt = '2026-10-03T00:00:00Z'
      return rows
    })

    const changing = changeProjectOwner('app', 'sam')
    expect(useStore.getState().projects[0].ownerId).toBe('sam')
    await changing

    expect(cloud.revokeInviteCloud).toHaveBeenCalledTimes(1)
    // Invites are keyed by token: the table has no id column, so revoking must send the token.
    expect(cloud.revokeInviteCloud).toHaveBeenCalledWith('stale'.padEnd(32, '0'))
  })
})
