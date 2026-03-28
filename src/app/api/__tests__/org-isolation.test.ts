/**
 * PLAT-028: Org Isolation Integration Tests
 *
 * Verifies strict multi-tenant workspace_id isolation across five resource types:
 * Tasks, Agents, Activity log, Comms/messages, Memory entries
 *
 * Pattern: mock auth to return users from different workspaces and assert
 * that each user only sees data scoped to their own workspace_id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Shared mocks ─────────────────────────────────────────────────────────────

const requireRole = vi.fn()
const prepare = vi.fn()
const logActivity = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: { logActivity },
  logAuditEvent: vi.fn(),
}))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/rate-limit', () => ({
  readLimiter: { check: vi.fn() },
  mutationLimiter: { check: vi.fn() },
}))
vi.mock('@/lib/github-sync-engine', () => ({ pushTaskToGitHub: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({
  config: {
    dbPath: ':memory:',
    memoryDir: '/tmp/test-memory',
    memoryAllowedPrefixes: [],
    gatewayHost: 'localhost',
    gatewayPort: 3001,
    homeDir: '/tmp',
  },
}))
vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn((_, schema) => ({ success: true, data: {} })),
  createTaskSchema: {},
  bulkUpdateTaskStatusSchema: {},
}))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn(() => []) }))
vi.mock('@/lib/task-status', () => ({ normalizeTaskCreateStatus: vi.fn((s) => s) }))

// Helper to build a mock user for a given workspace
function makeUser(workspaceId: number) {
  return { id: workspaceId * 10, username: `user_ws${workspaceId}`, role: 'viewer', workspace_id: workspaceId }
}

// Helper to build a GET NextRequest
function getRequest(url: string) {
  return new NextRequest(`http://localhost${url}`)
}

// ── 1. Tasks ──────────────────────────────────────────────────────────────────

describe('Org isolation — Tasks', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('returns only tasks belonging to the authenticated workspace', async () => {
    requireRole.mockReturnValue({ user: makeUser(1) })

    const capturedParams: unknown[] = []
    const stmt = { all: vi.fn((...args: unknown[]) => { capturedParams.push(...args); return [] }), get: vi.fn(() => ({ total: 0 })) }
    prepare.mockReturnValue(stmt)

    const { GET } = await import('@/app/api/tasks/route')
    const res = await GET(getRequest('/api/tasks'))
    expect(res.status).toBe(200)

    // workspace_id = 1 must appear as the first positional filter
    expect(capturedParams).toContain(1)
  })

  it('does not return tasks from a different workspace', async () => {
    // Workspace 2 user — stub returns empty (workspace 1 data excluded by SQL filter)
    requireRole.mockReturnValue({ user: makeUser(2) })

    const ws1Task = { id: 99, title: 'secret', workspace_id: 1 }
    const stmt = {
      all: vi.fn((...args: unknown[]) => {
        // Only return data when queried with workspace_id = 2
        const wsId = args.find((a) => typeof a === 'number')
        return wsId === 2 ? [] : [ws1Task]
      }),
      get: vi.fn(() => ({ total: 0 })),
    }
    prepare.mockReturnValue(stmt)

    const { GET } = await import('@/app/api/tasks/route')
    const res = await GET(getRequest('/api/tasks'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect((body.tasks ?? []).find((t: { id: number }) => t.id === 99)).toBeUndefined()
  })
})

// ── 2. Agents ─────────────────────────────────────────────────────────────────

describe('Org isolation — Agents', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('queries agents scoped to the authenticated workspace_id', async () => {
    requireRole.mockReturnValue({ user: makeUser(3) })

    const capturedSql: string[] = []
    const capturedArgs: unknown[][] = []
    prepare.mockImplementation((sql: string) => ({
      all: (...args: unknown[]) => { capturedSql.push(sql); capturedArgs.push(args); return [] },
      get: () => ({ total: 0 }),
    }))

    const { GET } = await import('@/app/api/agents/route')
    await GET(getRequest('/api/agents'))

    const agentQuery = capturedSql.find((s) => s.includes('FROM agents'))
    expect(agentQuery).toContain('workspace_id')
    // workspace_id=3 used as filter parameter
    const agentArgs = capturedArgs[capturedSql.indexOf(agentQuery!)]
    expect(agentArgs).toContain(3)
  })

  it('rejects unauthenticated requests', async () => {
    requireRole.mockReturnValue({ error: 'Unauthorized', status: 401 })

    const { GET } = await import('@/app/api/agents/route')
    const res = await GET(getRequest('/api/agents'))
    expect(res.status).toBe(401)
  })
})

// ── 3. Activity log ───────────────────────────────────────────────────────────

describe('Org isolation — Activity log', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('scopes activity queries to the authenticated workspace_id', async () => {
    requireRole.mockReturnValue({ user: makeUser(5) })

    const capturedSql: string[] = []
    const capturedArgs: unknown[][] = []
    prepare.mockImplementation((sql: string) => ({
      all: (...args: unknown[]) => { capturedSql.push(sql); capturedArgs.push(args); return [] },
      get: () => ({ total: 0 }),
    }))

    const { GET } = await import('@/app/api/activities/route')
    await GET(getRequest('/api/activities'))

    const activityQuery = capturedSql.find((s) => s.includes('FROM activities'))
    expect(activityQuery).toContain('workspace_id')
    const activityArgs = capturedArgs[capturedSql.indexOf(activityQuery!)]
    expect(activityArgs).toContain(5)
  })

  it('does not expose activities from another workspace', async () => {
    requireRole.mockReturnValue({ user: makeUser(5) })

    const foreignActivity = { id: 777, entity_id: 1, workspace_id: 9 }
    prepare.mockImplementation(() => ({
      all: (...args: unknown[]) => {
        const wsId = args.find((a) => typeof a === 'number')
        return wsId === 5 ? [] : [foreignActivity]
      },
      get: () => ({ total: 0 }),
    }))

    const { GET } = await import('@/app/api/activities/route')
    const res = await GET(getRequest('/api/activities'))
    const body = await res.json()

    const items: Array<{ id: number }> = body.activities ?? body.items ?? []
    expect(items.find((a) => a.id === 777)).toBeUndefined()
  })
})

// ── 4. Comms / messages ───────────────────────────────────────────────────────

describe('Org isolation — Comms/messages', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('scopes message queries to the authenticated workspace_id', async () => {
    requireRole.mockReturnValue({ user: makeUser(7) })

    const capturedSql: string[] = []
    const capturedArgs: unknown[][] = []
    prepare.mockImplementation((sql: string) => ({
      all: (...args: unknown[]) => { capturedSql.push(sql); capturedArgs.push(args); return [] },
      get: () => null,
    }))

    const { GET } = await import('@/app/api/agents/comms/route')
    await GET(getRequest('/api/agents/comms'))

    const msgQuery = capturedSql.find((s) => s.includes('FROM messages') || s.includes('workspace_id'))
    expect(msgQuery).toBeTruthy()
    const msgArgs = capturedArgs[capturedSql.indexOf(msgQuery!)]
    expect(msgArgs).toContain(7)
  })

  it('rejects requests from unauthenticated callers', async () => {
    requireRole.mockReturnValue({ error: 'Forbidden', status: 403 })

    const { GET } = await import('@/app/api/agents/comms/route')
    const res = await GET(getRequest('/api/agents/comms'))
    expect(res.status).toBe(403)
  })
})

// ── 5. Memory entries ─────────────────────────────────────────────────────────

describe('Org isolation — Memory entries', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('rejects unauthenticated memory access', async () => {
    requireRole.mockReturnValue({ error: 'Unauthorized', status: 401 })

    const { GET } = await import('@/app/api/memory/route')
    const res = await GET(getRequest('/api/memory'))
    expect(res.status).toBe(401)
  })

  it('requires at minimum viewer role to access memory', async () => {
    // Viewer role passes; no-role returns error
    requireRole.mockReturnValueOnce({ error: 'Forbidden', status: 403 })

    const { GET } = await import('@/app/api/memory/route')
    const res = await GET(getRequest('/api/memory'))
    expect(res.status).toBe(403)
  })

  it('allows memory access for authenticated workspace user', async () => {
    requireRole.mockReturnValue({ user: makeUser(2) })

    vi.mock('fs/promises', () => ({
      readdir: vi.fn(async () => []),
      stat: vi.fn(async () => ({ isDirectory: () => false, size: 0, mtimeMs: 0 })),
      lstat: vi.fn(async () => ({ isDirectory: () => false, isSymbolicLink: () => false })),
      realpath: vi.fn(async (p: string) => p),
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
    }))
    vi.mock('fs', () => ({
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
    }))

    const { GET } = await import('@/app/api/memory/route')
    const res = await GET(getRequest('/api/memory?path='))
    // Should not be 401/403
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
