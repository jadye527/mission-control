import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { getDatabase } from './db'
import { hashPassword, verifyPassword } from './password'
import { logSecurityEvent } from './security-events'
import { parseMcSessionCookieHeader } from './session-cookie'

// Plugin hook: extensions can register a custom API key resolver without modifying this file.
type AuthResolverHook = (apiKey: string, agentName: string | null) => User | null
let _authResolverHook: AuthResolverHook | null = null
export function registerAuthResolver(hook: AuthResolverHook): void {
  _authResolverHook = hook
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against dummy buffer to avoid timing leak on length mismatch
    const dummy = Buffer.alloc(bufA.length)
    timingSafeEqual(bufA, dummy)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  workspace_id: number
  tenant_id: number
  workspace_slug?: string
  workspace_name?: string
  tenant_slug?: string
  tenant_display_name?: string
  provider?: 'local' | 'google' | 'proxy'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  /** Agent name when request is made on behalf of a specific agent (via X-Agent-Name header) */
  agent_name?: string | null
  memberships?: WorkspaceMembership[]
}

export interface WorkspaceMembership {
  id: number
  user_id: number
  tenant_id: number
  workspace_id: number
  role: 'admin' | 'operator' | 'viewer'
  is_default: number
  created_at: number
  updated_at: number
  tenant_slug: string
  tenant_display_name: string
  workspace_slug: string
  workspace_name: string
}

export interface UserSession {
  id: number
  token: string
  user_id: number
  workspace_id: number
  tenant_id: number
  expires_at: number
  created_at: number
  ip_address: string | null
  user_agent: string | null
}

interface SessionQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  tenant_id: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  session_id: number
}

interface UserQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  tenant_id?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  password_hash: string
}

interface MembershipQueryRow {
  id: number
  user_id: number
  tenant_id: number
  workspace_id: number
  role: 'admin' | 'operator' | 'viewer'
  is_default: number
  created_at: number
  updated_at: number
  tenant_slug: string
  tenant_display_name: string
  workspace_slug: string
  workspace_name: string
}

// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60 // 7 days in seconds

function getDefaultWorkspaceContext(): { workspaceId: number; tenantId: number } {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT id, tenant_id
      FROM workspaces
      ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get() as { id?: number; tenant_id?: number } | undefined
    return {
      workspaceId: row?.id || 1,
      tenantId: row?.tenant_id || 1,
    }
  } catch {
    return { workspaceId: 1, tenantId: 1 }
  }
}

export function getWorkspaceIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.workspace_id || getDefaultWorkspaceContext().workspaceId
}

export function getTenantIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.tenant_id || getDefaultWorkspaceContext().tenantId
}

function resolveTenantForWorkspace(workspaceId: number): number {
  const db = getDatabase()
  const row = db.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`).get(workspaceId) as { tenant_id?: number } | undefined
  return row?.tenant_id || getDefaultWorkspaceContext().tenantId
}

function listMembershipsForUser(userId: number): WorkspaceMembership[] {
  const db = getDatabase()
  try {
    return db.prepare(`
      SELECT
        tm.id,
        tm.user_id,
        tm.tenant_id,
        tm.workspace_id,
        tm.role,
        tm.is_default,
        tm.created_at,
        tm.updated_at,
        t.slug AS tenant_slug,
        t.display_name AS tenant_display_name,
        w.slug AS workspace_slug,
        w.name AS workspace_name
      FROM tenant_memberships tm
      JOIN tenants t ON t.id = tm.tenant_id
      JOIN workspaces w ON w.id = tm.workspace_id AND w.tenant_id = tm.tenant_id
      WHERE tm.user_id = ? AND tm.status = 'active'
      ORDER BY tm.is_default DESC, t.display_name COLLATE NOCASE ASC, w.name COLLATE NOCASE ASC, tm.id ASC
    `).all(userId) as WorkspaceMembership[]
  } catch {
    return []
  }
}

function getMembershipForWorkspace(userId: number, workspaceId: number): WorkspaceMembership | null {
  return listMembershipsForUser(userId).find((membership) => membership.workspace_id === workspaceId) || null
}

function resolvePreferredMembership(
  userId: number,
  preferredWorkspaceId?: number | null,
): WorkspaceMembership | null {
  const memberships = listMembershipsForUser(userId)
  if (memberships.length === 0) return null
  if (preferredWorkspaceId) {
    const explicit = memberships.find((membership) => membership.workspace_id === preferredWorkspaceId)
    if (explicit) return explicit
  }
  return memberships.find((membership) => membership.is_default === 1) || memberships[0]
}

function hydrateUserFromRow(row: UserQueryRow, preferredWorkspaceId?: number | null): User | null {
  const fallbackContext = getDefaultWorkspaceContext()
  const membership = resolvePreferredMembership(row.id, preferredWorkspaceId ?? row.workspace_id ?? fallbackContext.workspaceId)

  if (membership) {
    return {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      role: membership.role,
      workspace_id: membership.workspace_id,
      tenant_id: membership.tenant_id,
      workspace_slug: membership.workspace_slug,
      workspace_name: membership.workspace_name,
      tenant_slug: membership.tenant_slug,
      tenant_display_name: membership.tenant_display_name,
      provider: row.provider || 'local',
      email: row.email ?? null,
      avatar_url: row.avatar_url ?? null,
      is_approved: row.is_approved ?? 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_login_at: row.last_login_at,
      memberships: listMembershipsForUser(row.id),
    }
  }

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || fallbackContext.workspaceId,
    tenant_id: resolveTenantForWorkspace(row.workspace_id || fallbackContext.workspaceId),
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: row.is_approved ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    memberships: [],
  }
}

export function createSession(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  workspaceId?: number
): { token: string; expiresAt: number } {
  const db = getDatabase()
  const token = randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION
  const membership = resolvePreferredMembership(userId, workspaceId)
  const resolvedWorkspaceId = membership?.workspace_id || workspaceId || ((db.prepare('SELECT workspace_id FROM users WHERE id = ?').get(userId) as { workspace_id?: number } | undefined)?.workspace_id || getDefaultWorkspaceContext().workspaceId)
  const resolvedTenantId = membership?.tenant_id || resolveTenantForWorkspace(resolvedWorkspaceId)

  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, userId, expiresAt, ipAddress || null, userAgent || null, resolvedWorkspaceId, resolvedTenantId)

  // Update user's last login
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ?, workspace_id = ? WHERE id = ?').run(now, now, resolvedWorkspaceId, userId)

  // Clean up expired sessions
  db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(now)

  return { token, expiresAt }
}

export function validateSession(token: string): (User & { sessionId: number }) | null {
  if (!token) return null
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved,
           COALESCE(s.workspace_id, u.workspace_id, 1) as workspace_id,
           COALESCE(s.tenant_id, w.tenant_id, 1) as tenant_id,
           u.created_at, u.updated_at, u.last_login_at,
           s.id as session_id
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN workspaces w ON w.id = COALESCE(s.workspace_id, u.workspace_id, 1)
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now) as SessionQueryRow | undefined

  if (!row) return null
  const hydrated = hydrateUserFromRow({
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    provider: row.provider,
    email: row.email,
    avatar_url: row.avatar_url,
    is_approved: row.is_approved,
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    password_hash: '',
  }, row.workspace_id)
  if (!hydrated) return null

  return { ...hydrated, sessionId: row.session_id }
}

export function destroySession(token: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
}

export function destroyAllUserSessions(userId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId)
}

// Dummy hash used for constant-time rejection when user doesn't exist.
// This ensures authenticateUser takes the same time whether or not the username is valid,
// preventing timing-based username enumeration.
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000'

// User management
export function authenticateUser(username: string, password: string): User | null {
  const db = getDatabase()
  const identifier = username.trim()
  const row = db.prepare(`
    SELECT *
    FROM users
    WHERE username = ? OR (email IS NOT NULL AND lower(email) = lower(?))
    ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(identifier, identifier, identifier) as UserQueryRow | undefined
  if (!row) {
    // Always run verifyPassword to prevent timing-based username enumeration
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'user_not_found' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if ((row.provider || 'local') !== 'local') {
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'wrong_provider' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if ((row.is_approved ?? 1) !== 1) {
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'not_approved' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if (!verifyPassword(password, row.password_hash)) {
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'invalid_password' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  return hydrateUserFromRow(row, row.workspace_id || getDefaultWorkspaceContext().workspaceId)
}

export function getUserById(id: number): User | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id = ?
  `).get(id) as UserQueryRow | undefined
  return row ? hydrateUserFromRow(row, row.workspace_id) : null
}

export function getAllUsers(): User[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    ORDER BY u.created_at
  `).all() as UserQueryRow[]
  return rows.map((row) => hydrateUserFromRow(row, row.workspace_id)).filter((row): row is User => Boolean(row))
}

export function createUser(
  username: string,
  password: string,
  displayName: string,
  role: User['role'] = 'operator',
  options?: { provider?: 'local' | 'google'; provider_user_id?: string | null; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1; approved_by?: string | null; approved_at?: number | null; workspace_id?: number; tenant_id?: number; is_default_membership?: boolean }
): User {
  const db = getDatabase()
  if (password.length < 12) throw new Error('Password must be at least 12 characters')
  const passwordHash = hashPassword(password)
  const provider = options?.provider || 'local'
  const workspaceId = options?.workspace_id || getDefaultWorkspaceContext().workspaceId
  const tenantId = options?.tenant_id || resolveTenantForWorkspace(workspaceId)
  const now = Math.floor(Date.now() / 1000)
  const result = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, provider, provider_user_id, email, avatar_url, is_approved, approved_by, approved_at, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      username,
      displayName,
      passwordHash,
      role,
      provider,
      options?.provider_user_id || null,
      options?.email || null,
      options?.avatar_url || null,
      typeof options?.is_approved === 'number' ? options.is_approved : 1,
      options?.approved_by || null,
      options?.approved_at || null,
      workspaceId,
      now,
      now,
    )

    try {
      db.prepare(`
        INSERT INTO tenant_memberships (
          user_id, tenant_id, workspace_id, role, status, is_default, invited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?)
      `).run(
        Number(inserted.lastInsertRowid),
        tenantId,
        workspaceId,
        role,
        options?.is_default_membership === false ? 0 : 1,
        now,
        now,
      )
    } catch {
      // Membership table is migration-backed; if unavailable, continue with legacy behavior.
    }

    return inserted
  })()

  return getUserById(Number(result.lastInsertRowid))!
}

export function updateUser(id: number, updates: { display_name?: string; role?: User['role']; password?: string; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1; tenant_id?: number | null }): User | null {
  const db = getDatabase()
  const fields: string[] = []
  const params: any[] = []

  if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name) }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role) }
  if (updates.password !== undefined) { fields.push('password_hash = ?'); params.push(hashPassword(updates.password)) }
  if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email) }
  if (updates.avatar_url !== undefined) { fields.push('avatar_url = ?'); params.push(updates.avatar_url) }
  if (updates.is_approved !== undefined) { fields.push('is_approved = ?'); params.push(updates.is_approved) }

  if (fields.length === 0) return getUserById(id)

  fields.push('updated_at = ?')
  params.push(Math.floor(Date.now() / 1000))
  params.push(id)

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  if (updates.role !== undefined) {
    try {
      if (updates.tenant_id) {
        db.prepare(`
          UPDATE tenant_memberships
          SET role = ?, updated_at = ?
          WHERE user_id = ? AND tenant_id = ?
        `).run(updates.role, Math.floor(Date.now() / 1000), id, updates.tenant_id)
      } else {
        db.prepare(`
          UPDATE tenant_memberships
          SET role = ?, updated_at = ?
          WHERE user_id = ?
        `).run(updates.role, Math.floor(Date.now() / 1000), id)
      }
    } catch {
      // Membership sync is best-effort for backward compatibility.
    }
  }
  return getUserById(id)
}

export function deleteUser(id: number): boolean {
  const db = getDatabase()
  destroyAllUserSessions(id)
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return result.changes > 0
}

export function listUsersForTenant(tenantId: number): User[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT DISTINCT
      u.id,
      u.username,
      u.display_name,
      u.role,
      COALESCE(u.workspace_id, tm.workspace_id, 1) AS workspace_id,
      ? AS tenant_id,
      u.provider,
      u.email,
      u.avatar_url,
      u.is_approved,
      u.created_at,
      u.updated_at,
      u.last_login_at,
      u.password_hash
    FROM users u
    JOIN tenant_memberships tm
      ON tm.user_id = u.id
     AND tm.tenant_id = ?
     AND tm.status = 'active'
    ORDER BY u.display_name COLLATE NOCASE ASC, u.username COLLATE NOCASE ASC
  `).all(tenantId, tenantId) as UserQueryRow[]

  return rows.map((row) => hydrateUserFromRow(row, row.workspace_id)).filter((row): row is User => Boolean(row))
}

export function setUserDefaultWorkspace(userId: number, workspaceId: number): User | null {
  const db = getDatabase()
  const membership = getMembershipForWorkspace(userId, workspaceId)
  if (!membership) return null
  const now = Math.floor(Date.now() / 1000)

  db.transaction(() => {
    db.prepare(`
      UPDATE tenant_memberships
      SET is_default = CASE WHEN workspace_id = ? THEN 1 ELSE 0 END,
          updated_at = ?
      WHERE user_id = ? AND tenant_id = ?
    `).run(workspaceId, now, userId, membership.tenant_id)

    db.prepare(`
      UPDATE users
      SET workspace_id = ?, updated_at = ?
      WHERE id = ?
    `).run(workspaceId, now, userId)
  })()

  return getUserById(userId)
}

export function setSessionWorkspace(token: string, workspaceId: number): User | null {
  const db = getDatabase()
  const session = db.prepare(`
    SELECT user_id
    FROM user_sessions
    WHERE token = ?
    LIMIT 1
  `).get(token) as { user_id: number } | undefined
  if (!session) return null

  const membership = getMembershipForWorkspace(session.user_id, workspaceId)
  if (!membership) return null
  const now = Math.floor(Date.now() / 1000)

  db.transaction(() => {
    db.prepare(`
      UPDATE user_sessions
      SET workspace_id = ?, tenant_id = ?
      WHERE token = ?
    `).run(workspaceId, membership.tenant_id, token)

    db.prepare(`
      UPDATE tenant_memberships
      SET is_default = CASE WHEN workspace_id = ? THEN 1 ELSE 0 END,
          updated_at = ?
      WHERE user_id = ? AND tenant_id = ?
    `).run(workspaceId, now, session.user_id, membership.tenant_id)

    db.prepare(`
      UPDATE users
      SET workspace_id = ?, updated_at = ?
      WHERE id = ?
    `).run(workspaceId, now, session.user_id)
  })()

  return getUserById(session.user_id)
}

/**
 * Seed admin user from environment variables on first run.
 * If no users exist, creates an admin from AUTH_USER/AUTH_PASS env vars.
 */
/**
 * Get user from request - checks session cookie or API key.
 * For API key auth, returns a synthetic "api" user.
 */
/**
 * Resolve a user by username for proxy auth.
 * If the user does not exist and MC_PROXY_AUTH_DEFAULT_ROLE is set, auto-provisions them.
 * Auto-provisioned users receive a random unusable password — they cannot log in locally.
 */
export interface UserApiKeyRecord {
  id: number
  label: string
  key_prefix: string
  role: User['role']
  scopes: string[]
  expires_at: number | null
  last_used_at: number | null
  last_used_ip: string | null
  is_revoked: number
  workspace_id: number
  tenant_id: number
  created_at: number
  updated_at: number
}

export interface InviteRecord {
  id: number
  email: string
  role: User['role']
  tenant_id: number
  workspace_id: number
  invited_by_user_id: number | null
  invited_by_username: string | null
  token_hint: string
  expires_at: number
  accepted_at: number | null
  revoked_at: number | null
  created_at: number
  updated_at: number
  workspace_name: string
  workspace_slug: string
}

export function listUserApiKeys(userId: number, tenantId?: number): UserApiKeyRecord[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT id, label, key_prefix, role, scopes, expires_at, last_used_at, last_used_ip, is_revoked, workspace_id, tenant_id, created_at, updated_at
    FROM api_keys
    WHERE user_id = ?
      ${tenantId ? 'AND tenant_id = ?' : ''}
    ORDER BY created_at DESC, id DESC
  `).all(...(tenantId ? [userId, tenantId] : [userId])) as Array<Omit<UserApiKeyRecord, 'scopes'> & { scopes: string | null }>

  return rows.map((row) => ({
    ...row,
    scopes: (() => {
      try {
        const parsed = JSON.parse(row.scopes || '[]')
        return Array.isArray(parsed) ? parsed.map((value) => String(value)) : []
      } catch {
        return []
      }
    })(),
  }))
}

export function createUserApiKey(
  user: User,
  input: { label: string; role?: User['role']; scopes?: string[]; expiresAt?: number | null },
): { record: UserApiKeyRecord; rawKey: string } {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const rawKey = `mcu_${randomBytes(24).toString('hex')}`
  const keyHash = hashApiKey(rawKey)
  const keyPrefix = rawKey.slice(0, 12)
  const result = db.prepare(`
    INSERT INTO api_keys (
      user_id, label, key_prefix, key_hash, role, scopes, expires_at, workspace_id, tenant_id, is_revoked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    user.id,
    input.label.trim(),
    keyPrefix,
    keyHash,
    input.role || user.role,
    JSON.stringify(Array.isArray(input.scopes) ? input.scopes : []),
    input.expiresAt || null,
    user.workspace_id,
    user.tenant_id,
    now,
    now,
  )

  const record = listUserApiKeys(user.id, user.tenant_id).find((row) => row.id === Number(result.lastInsertRowid))
  if (!record) throw new Error('Failed to create API key')
  return { record, rawKey }
}

export function revokeUserApiKey(userId: number, keyId: number, tenantId?: number): boolean {
  const db = getDatabase()
  const result = db.prepare(`
    UPDATE api_keys
    SET is_revoked = 1, updated_at = unixepoch()
    WHERE id = ? AND user_id = ?
      ${tenantId ? 'AND tenant_id = ?' : ''}
      AND is_revoked = 0
  `).run(...(tenantId ? [keyId, userId, tenantId] : [keyId, userId]))
  return result.changes > 0
}

export function listTenantInvites(tenantId: number): InviteRecord[] {
  const db = getDatabase()
  try {
    return db.prepare(`
      SELECT
        i.id,
        i.email,
        i.role,
        i.tenant_id,
        i.workspace_id,
        i.invited_by_user_id,
        u.username AS invited_by_username,
        i.token_hint,
        i.expires_at,
        i.accepted_at,
        i.revoked_at,
        i.created_at,
        i.updated_at,
        w.name AS workspace_name,
        w.slug AS workspace_slug
      FROM auth_invites i
      LEFT JOIN users u ON u.id = i.invited_by_user_id
      JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.tenant_id = ?
      ORDER BY i.created_at DESC, i.id DESC
    `).all(tenantId) as InviteRecord[]
  } catch {
    return []
  }
}

export function createTenantInvite(
  user: User,
  input: { email: string; role: User['role']; workspaceId?: number; expiresInDays?: number },
): { invite: InviteRecord; token: string } {
  const db = getDatabase()
  const workspaceId = input.workspaceId || user.workspace_id
  const membership = getMembershipForWorkspace(user.id, workspaceId)
  if (!membership || membership.tenant_id !== user.tenant_id) {
    throw new Error('Workspace is not accessible for this tenant')
  }
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + Math.max(1, Math.min(30, input.expiresInDays || 7)) * 24 * 60 * 60
  const token = `mci_${randomBytes(24).toString('hex')}`
  const tokenHash = hashApiKey(token)
  const tokenHint = token.slice(0, 10)
  const result = db.prepare(`
    INSERT INTO auth_invites (
      email, tenant_id, workspace_id, role, token_hash, token_hint, invited_by_user_id, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.email.trim().toLowerCase(),
    user.tenant_id,
    workspaceId,
    input.role,
    tokenHash,
    tokenHint,
    user.id,
    expiresAt,
    now,
    now,
  )

  const invite = listTenantInvites(user.tenant_id).find((row) => row.id === Number(result.lastInsertRowid))
  if (!invite) throw new Error('Failed to create invite')
  return { invite, token }
}

export function revokeTenantInvite(tenantId: number, inviteId: number): boolean {
  const db = getDatabase()
  const result = db.prepare(`
    UPDATE auth_invites
    SET revoked_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL AND accepted_at IS NULL
  `).run(inviteId, tenantId)
  return result.changes > 0
}

export function getInviteByToken(token: string): InviteRecord | null {
  const db = getDatabase()
  const tokenHash = hashApiKey(token)
  const now = Math.floor(Date.now() / 1000)
  try {
    const row = db.prepare(`
      SELECT
        i.id,
        i.email,
        i.role,
        i.tenant_id,
        i.workspace_id,
        i.invited_by_user_id,
        u.username AS invited_by_username,
        i.token_hint,
        i.expires_at,
        i.accepted_at,
        i.revoked_at,
        i.created_at,
        i.updated_at,
        w.name AS workspace_name,
        w.slug AS workspace_slug
      FROM auth_invites i
      LEFT JOIN users u ON u.id = i.invited_by_user_id
      JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = ?
        AND i.revoked_at IS NULL
        AND i.accepted_at IS NULL
        AND i.expires_at > ?
      LIMIT 1
    `).get(tokenHash, now) as InviteRecord | undefined
    return row || null
  } catch {
    return null
  }
}

export function acceptInviteForUser(inviteId: number, userId: number): User | null {
  const db = getDatabase()
  const invite = db.prepare(`
    SELECT id, tenant_id, workspace_id, role
    FROM auth_invites
    WHERE id = ? AND revoked_at IS NULL AND accepted_at IS NULL
    LIMIT 1
  `).get(inviteId) as { id: number; tenant_id: number; workspace_id: number; role: User['role'] } | undefined
  if (!invite) return null

  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    db.prepare(`
      INSERT INTO tenant_memberships (
        user_id, tenant_id, workspace_id, role, status, is_default, invited_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', 0, NULL, ?, ?)
      ON CONFLICT(user_id, workspace_id) DO UPDATE SET
        role = excluded.role,
        status = 'active',
        updated_at = excluded.updated_at
    `).run(userId, invite.tenant_id, invite.workspace_id, invite.role, now, now)

    db.prepare(`
      UPDATE auth_invites
      SET accepted_at = ?, accepted_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, userId, now, inviteId)
  })()

  const membership = getMembershipForWorkspace(userId, invite.workspace_id)
  if (membership?.is_default !== 1) {
    setUserDefaultWorkspace(userId, invite.workspace_id)
  }
  return getUserById(userId)
}

function resolveOrProvisionProxyUser(username: string): User | null {
  try {
    const db = getDatabase()
    const { workspaceId } = getDefaultWorkspaceContext()

    const row = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.workspace_id,
             COALESCE(w.tenant_id, 1) as tenant_id,
             u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.username = ?
    `).get(username) as UserQueryRow | undefined

    if (row) {
      if ((row.is_approved ?? 1) !== 1) return null
      return {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        workspace_id: row.workspace_id || workspaceId,
        tenant_id: resolveTenantForWorkspace(row.workspace_id || workspaceId),
        provider: row.provider || 'local',
        email: row.email ?? null,
        avatar_url: row.avatar_url ?? null,
        is_approved: row.is_approved ?? 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
      }
    }

    // Auto-provision if MC_PROXY_AUTH_DEFAULT_ROLE is configured
    const defaultRole = (process.env.MC_PROXY_AUTH_DEFAULT_ROLE || '').trim()
    if (!defaultRole || !(['viewer', 'operator', 'admin'] as const).includes(defaultRole as User['role'])) {
      return null
    }

    // Random password — proxy users cannot log in via the local login form
    return createUser(username, randomBytes(32).toString('hex'), username, defaultRole as User['role'])
  } catch {
    return null
  }
}

export function getUserFromRequest(request: Request): User | null {
  // Extract agent identity header (optional, for attribution)
  const agentName = (request.headers.get('x-agent-name') || '').trim() || null

  // Proxy / trusted-header auth (MC_PROXY_AUTH_HEADER)
  // When the gateway has already authenticated the user and injects their username
  // as a trusted header (e.g. X-Auth-Username from Envoy OIDC claimToHeaders),
  // skip the local login form entirely.
  const proxyAuthHeader = (process.env.MC_PROXY_AUTH_HEADER || '').trim()
  if (proxyAuthHeader) {
    const proxyUsername = (request.headers.get(proxyAuthHeader) || '').trim()
    if (proxyUsername) {
      const user = resolveOrProvisionProxyUser(proxyUsername)
      if (user) return { ...user, agent_name: agentName }
    }
  }

  // Check session cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseMcSessionCookieHeader(cookieHeader)
  if (sessionToken) {
    const user = validateSession(sessionToken)
    if (user) return { ...user, agent_name: agentName }
  }

  // Check API key - DB override first, then env var
  const apiKey = extractApiKeyFromHeaders(request.headers)
  const configuredApiKey = resolveActiveApiKey()

  if (configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey)) {
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      workspace_id: getDefaultWorkspaceContext().workspaceId,
      tenant_id: getDefaultWorkspaceContext().tenantId,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
      agent_name: agentName,
    }
  }

  // Agent-scoped API keys
  if (apiKey) {
    try {
      const db = getDatabase()
      const keyHash = hashApiKey(apiKey)
      const now = Math.floor(Date.now() / 1000)
      const userKey = db.prepare(`
        SELECT user_id, role, workspace_id, tenant_id, expires_at, is_revoked
        FROM api_keys
        WHERE key_hash = ?
        LIMIT 1
      `).get(keyHash) as {
        user_id: number
        role: User['role']
        workspace_id: number
        tenant_id: number
        expires_at: number | null
        is_revoked: number
      } | undefined

      if (userKey && !userKey.is_revoked && (!userKey.expires_at || userKey.expires_at > now)) {
        db.prepare(`
          UPDATE api_keys
          SET last_used_at = ?, last_used_ip = ?, updated_at = ?
          WHERE key_hash = ?
        `).run(now, request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null, now, keyHash)

        const resolved = getUserById(userKey.user_id)
        if (resolved) {
          const scoped = userKey.workspace_id ? hydrateUserFromRow({
            id: resolved.id,
            username: resolved.username,
            display_name: resolved.display_name,
            role: resolved.role,
            workspace_id: resolved.workspace_id,
            tenant_id: resolved.tenant_id,
            provider: resolved.provider === 'proxy' ? 'local' : (resolved.provider || 'local'),
            email: resolved.email ?? null,
            avatar_url: resolved.avatar_url ?? null,
            is_approved: resolved.is_approved ?? 1,
            created_at: resolved.created_at,
            updated_at: resolved.updated_at,
            last_login_at: resolved.last_login_at,
            password_hash: '',
          }, userKey.workspace_id) : resolved
          if (scoped) {
            return {
              ...scoped,
              role: userKey.role || scoped.role,
              agent_name: agentName,
            }
          }
        }
      }

      const row = db.prepare(`
        SELECT id, agent_id, workspace_id, tenant_id, scopes, expires_at, revoked_at
        FROM agent_api_keys
        WHERE key_hash = ?
        LIMIT 1
      `).get(keyHash) as {
        id: number
        agent_id: number
        workspace_id: number
        tenant_id?: number
        scopes: string
        expires_at: number | null
        revoked_at: number | null
      } | undefined

      if (row && !row.revoked_at && (!row.expires_at || row.expires_at > now)) {
        const scopes = parseAgentScopes(row.scopes)
        const agent = db
          .prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?')
          .get(row.agent_id, row.workspace_id) as { id: number; name: string } | undefined

        if (agent) {
          if (agentName && agentName !== agent.name && !scopes.has('admin')) {
            return null
          }

          db.prepare('UPDATE agent_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)

          return {
            id: -row.id,
            username: `agent:${agent.name}`,
            display_name: agent.name,
            role: deriveRoleFromScopes(scopes),
            workspace_id: row.workspace_id,
            tenant_id: row.tenant_id || resolveTenantForWorkspace(row.workspace_id),
            created_at: 0,
            updated_at: now,
            last_login_at: now,
            agent_name: agent.name,
          }
        }
      }
    } catch {
      // ignore missing table / startup race
    }
  }

  // Plugin hook: allow Pro (or other extensions) to resolve custom API keys
  if (apiKey && _authResolverHook) {
    const resolved = _authResolverHook(apiKey, agentName)
    if (resolved) return resolved
  }

  return null
}

/**
 * Resolve the active API key: check DB settings override first, then env var.
 */
function resolveActiveApiKey(): string {
  try {
    const db = getDatabase()
    const row = db.prepare(
      "SELECT value FROM settings WHERE key = 'security.api_key'"
    ).get() as { value: string } | undefined
    if (row?.value) return row.value
  } catch {
    // DB not ready yet — fall back to env
  }
  return (process.env.API_KEY || '').trim()
}

function extractApiKeyFromHeaders(headers: Headers): string | null {
  const direct = (headers.get('x-api-key') || '').trim()
  if (direct) return direct

  const authorization = (headers.get('authorization') || '').trim()
  if (!authorization) return null

  const [scheme, ...rest] = authorization.split(/\s+/)
  if (!scheme || rest.length === 0) return null

  const normalized = scheme.toLowerCase()
  if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
    return rest.join(' ').trim() || null
  }

  return null
}

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

function parseAgentScopes(raw: string): Set<string> {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.map((scope) => String(scope)))
  } catch {
    // ignore parse errors
  }
  return new Set()
}

function deriveRoleFromScopes(scopes: Set<string>): User['role'] {
  if (scopes.has('admin')) return 'admin'
  if (scopes.has('operator')) return 'operator'
  return 'viewer'
}

/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS: Record<string, number> = { viewer: 0, operator: 1, admin: 2 }

/**
 * Check if a user meets the minimum role requirement.
 * Returns { user } on success, or { error, status } on failure (401 or 403).
 */
export function requireRole(
  request: Request,
  minRole: User['role']
): { user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 } {
  const user = getUserFromRequest(request)
  if (!user) {
    return { error: 'Authentication required', status: 401 }
  }
  if ((ROLE_LEVELS[user.role] ?? -1) < ROLE_LEVELS[minRole]) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}
