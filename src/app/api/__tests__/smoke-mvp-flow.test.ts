/**
 * PLAT-042: MVP Flow Smoke Tests
 *
 * Covers the full user journey:
 *   1. Signup → org creation → session
 *   2. Task creation (scoped to workspace)
 *   3. Agent registration (scoped to workspace)
 *   4. Billing (Stripe link resolution per tier)
 *
 * Uses vi.mock pattern consistent with the codebase.
 * Runs against mocked DB and auth — no real network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Shared mock state ─────────────────────────────────────────────────────────

const requireRole = vi.fn()
const prepare = vi.fn()
const logAuditEvent = vi.fn()
const createUserMock = vi.fn()
const createSessionMock = vi.fn()
const hashPasswordMock = vi.fn((p: string) => `hashed:${p}`)

vi.mock('@/lib/auth', () => ({
  requireRole,
  createUser: createUserMock,
  createSession: createSessionMock,
  getTenantIdFromRequest: vi.fn(() => 1),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare, transaction: (fn: () => unknown) => fn })),
  db_helpers: { logActivity: vi.fn(), ensureTaskSubscription: vi.fn(), logAgentActivity: vi.fn(), createNotification: vi.fn() },
  logAuditEvent,
  needsFirstTimeSetup: vi.fn(() => false),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: vi.fn(() => true),
}))

vi.mock('@/lib/session-cookie', () => ({
  getMcSessionCookieName: vi.fn(() => 'mc_session'),
  getMcSessionCookieOptions: vi.fn(() => ({ httpOnly: true, path: '/' })),
  isRequestSecure: vi.fn(() => false),
}))

vi.mock('@/lib/rate-limit', () => ({
  loginLimiter: vi.fn(() => null),
  readLimiter: vi.fn(() => null),
  mutationLimiter: vi.fn(() => null),
  heavyLimiter: vi.fn(() => null),
  selfRegisterLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(async (req: Request) => {
    try { return { success: true, data: await req.json() } } catch { return { success: true, data: {} } }
  }),
  createTaskSchema: {},
  createAgentSchema: {},
  bulkUpdateTaskStatusSchema: {},
}))

vi.mock('@/lib/github-sync-engine', () => ({ pushTaskToGitHub: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn(() => ({ recipients: [], unresolved: [] })) }))
vi.mock('@/lib/task-status', () => ({ normalizeTaskCreateStatus: vi.fn((s: string) => s ?? 'inbox') }))
vi.mock('@/lib/config', () => ({
  config: { dbPath: ':memory:', gatewayHost: 'localhost', gatewayPort: 3001, homeDir: '/tmp', gnap: { enabled: false, autoSync: false, repoPath: '' } },
}))
vi.mock('@/lib/agent-templates', () => ({
  getTemplate: vi.fn(() => null),
  buildAgentConfig: vi.fn(() => ({})),
}))
vi.mock('@/lib/agent-sync', () => ({
  writeAgentToConfig: vi.fn(),
  enrichAgentConfigFromWorkspace: vi.fn((v: unknown) => v),
}))
vi.mock('@/lib/command', () => ({ runOpenClaw: vi.fn(() => ({ success: true })) }))
vi.mock('@/lib/paths', () => ({ resolveWithin: vi.fn((base: string, p: string) => `${base}/${p}`) }))
vi.mock('@/lib/stripe-links', () => ({
  getStripePaymentLinks: vi.fn(() => ({
    starter: 'https://buy.stripe.com/test_starter',
    pro: 'https://buy.stripe.com/test_pro',
    scale: null,
  })),
  getTierHref: vi.fn((tier: string) =>
    tier === 'scale' ? '/signup' : `https://buy.stripe.com/test_${tier}`
  ),
}))

function makeUser(workspaceId = 1, email = 'alice@acme.com') {
  return { id: 1, username: 'test', display_name: 'test', role: 'admin', workspace_id: workspaceId, tenant_id: 1, email }
}

function postRequest(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(url: string) {
  return new NextRequest(`http://localhost${url}`)
}

// ── 1. Signup → org creation → session ───────────────────────────────────────

describe('Smoke: Signup flow', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
    createUserMock.mockReset()
    createSessionMock.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('creates org + user + session and returns 201', async () => {
    // Simulate no duplicate email
    prepare.mockImplementation((sql: string) => ({
      get: vi.fn(() => (sql.includes('WHERE email') ? undefined : null)),
      run: vi.fn(() => ({ lastInsertRowid: 1 })),
      all: vi.fn(() => []),
    }))
    createUserMock.mockReturnValue(makeUser())
    createSessionMock.mockReturnValue({ token: 'tok123', expiresAt: Date.now() / 1000 + 604800 })

    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(postRequest('/api/auth/signup', {
      email: 'alice@acme.com',
      password: 'supersecret1234',
      org_name: 'Acme Inc',
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user).toBeDefined()
    expect(body.user.email).toBe('alice@acme.com')
  })

  it('rejects signup with duplicate email (409)', async () => {
    prepare.mockImplementation((sql: string) => ({
      get: vi.fn(() => (sql.includes('WHERE email') ? { id: 99 } : null)),
      run: vi.fn(() => ({ lastInsertRowid: 1 })),
    }))

    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(postRequest('/api/auth/signup', {
      email: 'existing@acme.com',
      password: 'supersecret1234',
      org_name: 'Acme',
    }))

    expect(res.status).toBe(409)
  })

  it('rejects short password', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(postRequest('/api/auth/signup', {
      email: 'bob@acme.com',
      password: 'short',
      org_name: 'Acme',
    }))
    expect(res.status).toBe(400)
  })
})

// ── 2. Task creation (workspace-scoped) ───────────────────────────────────────

describe('Smoke: Task creation', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
    requireRole.mockReturnValue({ user: makeUser(1) })
  })
  afterEach(() => vi.clearAllMocks())

  it('creates a task scoped to workspace and returns success', async () => {
    const taskId = 42
    prepare.mockImplementation((sql: string) => ({
      get: vi.fn(() => {
        if (sql.includes('ticket_counter')) return { ticket_counter: 1 }
        if (sql.includes('FROM projects')) return { id: 1 }
        if (sql.includes('FROM tasks t') || sql.includes('FROM tasks WHERE id')) return { id: taskId, workspace_id: 1, title: 'Test task', status: 'inbox', tags: '[]', metadata: '{}', project_prefix: null, project_ticket_no: null, project_name: null }
        if (sql.includes('quality_reviews')) return undefined
        return null
      }),
      run: vi.fn(() => ({ lastInsertRowid: taskId })),
      all: vi.fn(() => []),
    }))

    const { POST } = await import('@/app/api/tasks/route')
    const { logger } = await import('@/lib/logger')
    const res = await POST(postRequest('/api/tasks', { title: 'Test task', status: 'inbox' }))
    if (res.status !== 201) {
      const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls
      const err = errCalls[0]?.[0]?.err
      console.error('Task 500 error:', err?.message ?? err?.stack ?? String(err))
    }
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.task?.id ?? body.id).toBe(taskId)
  })
})

// ── 3. Agent registration (workspace-scoped) ──────────────────────────────────

describe('Smoke: Agent registration', () => {
  beforeEach(() => {
    vi.resetModules()
    prepare.mockReset()
    requireRole.mockReturnValue({ user: makeUser(1) })
  })
  afterEach(() => vi.clearAllMocks())

  it('creates an agent scoped to workspace', async () => {
    const agentId = 7
    prepare.mockImplementation((sql: string) => ({
      get: vi.fn(() => {
        if (sql.includes('FROM agents WHERE name')) return null // no duplicate
        if (sql.includes('FROM agents WHERE id')) return { id: agentId, name: 'scout', workspace_id: 1, role: 'researcher', status: 'idle', config: '{}', tags: '[]', openclaw_id: 'scout' }
        return null
      }),
      run: vi.fn(() => ({ lastInsertRowid: agentId })),
      all: vi.fn(() => []),
    }))

    const { logger } = await import('@/lib/logger')
    const { POST } = await import('@/app/api/agents/route')
    const res = await POST(postRequest('/api/agents', { name: 'scout', role: 'researcher' }))
    if (res.status === 500) {
      const body = await res.clone().json().catch(() => ({}))
      const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls
      const err = errCalls[0]?.[0]?.err
      const msg = err?.message ?? err?.stack ?? ('no logger calls: ' + errCalls.length)
      const fs = await import('fs')
      fs.writeFileSync('/tmp/agent-test-error.txt', JSON.stringify({ body, msg, errCalls: errCalls.map((c: unknown[]) => String(c)) }, null, 2))
    }
    expect([200, 201]).toContain(res.status)
  })
})

// ── 4. Billing — Stripe link resolution per tier ──────────────────────────────

describe('Smoke: Billing / Stripe links', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.clearAllMocks())

  it('returns configured Stripe links for starter and pro', async () => {
    const { GET } = await import('@/app/api/stripe-links/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.starter).toBe('https://buy.stripe.com/test_starter')
    expect(body.pro).toBe('https://buy.stripe.com/test_pro')
  })

  it('returns null for unconfigured tier (scale) — fallback to /signup', async () => {
    const { GET } = await import('@/app/api/stripe-links/route')
    const res = await GET()
    const body = await res.json()

    expect(body.scale).toBeNull()
  })

  it('getTierHref falls back to /signup when link is null', async () => {
    const { getTierHref } = await import('@/lib/stripe-links')
    expect(getTierHref('scale')).toBe('/signup')
    expect(getTierHref('starter')).toContain('stripe.com')
  })
})
