import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const logAuditEvent = vi.fn()
const prepare = vi.fn()
const transaction = vi.fn((fn: () => unknown) => fn)

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare, transaction })),
  logAuditEvent,
}))

vi.mock('@/lib/workspaces', () => ({
  listWorkspacesForTenant: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('workspace routes', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRole.mockReset()
    prepare.mockReset()
    transaction.mockClear()
    logAuditEvent.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('POST /api/workspaces creates the workspace and grants the current admin membership', async () => {
    requireRole.mockReturnValue({
      user: { id: 7, username: 'owner', role: 'admin', tenant_id: 22, workspace_id: 3 },
    })

    const slugCheck = { get: vi.fn(() => undefined) }
    const insertWorkspace = { run: vi.fn(() => ({ lastInsertRowid: 44 })) }
    const upsertMembership = { run: vi.fn() }
    const selectWorkspace = { get: vi.fn(() => ({ id: 44, slug: 'ops', name: 'Ops', tenant_id: 22 })) }

    prepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM workspaces WHERE slug = ? AND tenant_id = ?')) return slugCheck
      if (sql.includes('INSERT INTO workspaces')) return insertWorkspace
      if (sql.includes('INSERT INTO tenant_memberships')) return upsertMembership
      if (sql.includes('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?')) return selectWorkspace
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { POST } = await import('@/app/api/workspaces/route')
    const request = new NextRequest('http://localhost/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ops', slug: 'ops' }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(insertWorkspace.run).toHaveBeenCalledWith('ops', 'Ops', 22, expect.any(Number), expect.any(Number))
    expect(upsertMembership.run).toHaveBeenCalledWith(7, 22, 44, 'admin', expect.any(Number), expect.any(Number))
    expect(body.workspace).toEqual({ id: 44, slug: 'ops', name: 'Ops', tenant_id: 22 })
  })

  it('DELETE /api/workspaces/[id] reassigns auth state before deleting the workspace', async () => {
    requireRole.mockReturnValue({
      user: { id: 7, username: 'owner', role: 'admin', tenant_id: 22, workspace_id: 3 },
    })

    const selectExisting = { get: vi.fn(() => ({ id: 44, slug: 'ops', name: 'Ops', tenant_id: 22 })) }
    const selectDefault = { get: vi.fn(() => ({ id: 3 })) }
    const moveAgents = { run: vi.fn(() => ({ changes: 2 })) }
    const moveUsers = { run: vi.fn() }
    const moveProjects = { run: vi.fn() }
    const moveSessions = { run: vi.fn() }
    const moveApiKeys = { run: vi.fn() }
    const moveInvites = { run: vi.fn() }
    const insertFallbackMemberships = { run: vi.fn() }
    const normalizeDefaults = { run: vi.fn() }
    const deleteMemberships = { run: vi.fn() }
    const deleteWorkspace = { run: vi.fn() }

    prepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?')) return selectExisting
      if (sql.includes("SELECT id FROM workspaces WHERE slug = 'default' AND tenant_id = ? LIMIT 1")) return selectDefault
      if (sql.includes('UPDATE agents SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?')) return moveAgents
      if (sql.includes('UPDATE users SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?')) return moveUsers
      if (sql.includes('UPDATE projects SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?')) return moveProjects
      if (sql.includes('UPDATE user_sessions SET workspace_id = ?, tenant_id = ? WHERE workspace_id = ?')) return moveSessions
      if (sql.includes('UPDATE api_keys SET workspace_id = ?, tenant_id = ?, updated_at = ? WHERE workspace_id = ?')) return moveApiKeys
      if (sql.includes('UPDATE auth_invites SET workspace_id = ?, updated_at = ? WHERE workspace_id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL')) return moveInvites
      if (sql.includes('INSERT INTO tenant_memberships')) return insertFallbackMemberships
      if (sql.includes('SET is_default = CASE WHEN workspace_id = ? THEN 1 ELSE 0 END')) return normalizeDefaults
      if (sql.includes('DELETE FROM tenant_memberships WHERE workspace_id = ? AND tenant_id = ?')) return deleteMemberships
      if (sql.includes('DELETE FROM workspaces WHERE id = ? AND tenant_id = ?')) return deleteWorkspace
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { DELETE } = await import('@/app/api/workspaces/[id]/route')
    const request = new NextRequest('http://localhost/api/workspaces/44', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '44' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(moveSessions.run).toHaveBeenCalledWith(3, 22, 44)
    expect(moveApiKeys.run).toHaveBeenCalledWith(3, 22, expect.any(Number), 44)
    expect(moveInvites.run).toHaveBeenCalledWith(3, expect.any(Number), 44, 22)
    expect(deleteMemberships.run).toHaveBeenCalledWith(44, 22)
    expect(deleteWorkspace.run).toHaveBeenCalledWith(44, 22)
    expect(body).toEqual({
      success: true,
      deleted: 'Ops',
      agents_moved_to: 3,
    })
  })
})
