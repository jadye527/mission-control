import { createSession, createTenantInvite, createUser, createUserApiKey, destroySession, getInviteByToken, getUserById, getUserFromRequest, listTenantInvites, listUserApiKeys, revokeTenantInvite, revokeUserApiKey, setSessionWorkspace, type InviteRecord, type User, type UserApiKeyRecord } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure, parseMcSessionCookieHeader } from '@/lib/session-cookie'

export function serializeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    provider: user.provider || 'local',
    email: user.email || null,
    avatar_url: user.avatar_url || null,
    workspace_id: user.workspace_id ?? 1,
    workspace_slug: user.workspace_slug || null,
    workspace_name: user.workspace_name || null,
    tenant_id: user.tenant_id ?? 1,
    tenant_slug: user.tenant_slug || null,
    tenant_display_name: user.tenant_display_name || null,
    memberships: (user.memberships || []).map((membership) => ({
      id: membership.id,
      tenant_id: membership.tenant_id,
      tenant_slug: membership.tenant_slug,
      tenant_display_name: membership.tenant_display_name,
      workspace_id: membership.workspace_id,
      workspace_slug: membership.workspace_slug,
      workspace_name: membership.workspace_name,
      role: membership.role,
      is_default: membership.is_default,
    })),
  }
}

export function serializeInvite(invite: InviteRecord) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    tenant_id: invite.tenant_id,
    workspace_id: invite.workspace_id,
    workspace_name: invite.workspace_name,
    workspace_slug: invite.workspace_slug,
    invited_by_user_id: invite.invited_by_user_id,
    invited_by_username: invite.invited_by_username,
    token_hint: invite.token_hint,
    expires_at: invite.expires_at,
    accepted_at: invite.accepted_at,
    revoked_at: invite.revoked_at,
    created_at: invite.created_at,
    updated_at: invite.updated_at,
  }
}

export function serializeApiKey(key: UserApiKeyRecord) {
  return {
    id: key.id,
    label: key.label,
    key_prefix: key.key_prefix,
    role: key.role,
    scopes: key.scopes,
    expires_at: key.expires_at,
    last_used_at: key.last_used_at,
    last_used_ip: key.last_used_ip,
    is_revoked: key.is_revoked,
    workspace_id: key.workspace_id,
    tenant_id: key.tenant_id,
    created_at: key.created_at,
    updated_at: key.updated_at,
  }
}

export function applySessionCookie(response: Response, request: Request, token: string, expiresAt: number) {
  const nextResponse = response as any
  const isSecureRequest = isRequestSecure(request)
  const cookieName = getMcSessionCookieName(isSecureRequest)
  nextResponse.cookies.set(cookieName, token, {
    ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
  })
}

export function clearSessionCookie(response: Response, request: Request) {
  const nextResponse = response as any
  const isSecureRequest = isRequestSecure(request)
  const cookieName = getMcSessionCookieName(isSecureRequest)
  nextResponse.cookies.set(cookieName, '', {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 0, isSecureRequest }),
  })
}

export function currentSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') || ''
  return parseMcSessionCookieHeader(cookieHeader)
}

export function buildAuthPayload(user: User) {
  return {
    user: serializeUser(user),
    api_keys: listUserApiKeys(user.id, user.tenant_id).map(serializeApiKey),
    invites: user.role === 'admin' ? listTenantInvites(user.tenant_id).map(serializeInvite) : [],
  }
}

export function registerUserWithTenant(input: {
  username: string
  password: string
  displayName: string
  email?: string | null
  inviteToken?: string | null
  tenantName?: string | null
  tenantSlug?: string | null
  workspaceName?: string | null
}) {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  if (input.inviteToken) {
    const invite = getInviteByToken(input.inviteToken)
    if (!invite) throw new Error('Invite is invalid or expired')
    if (invite.email.toLowerCase() !== String(input.email || '').trim().toLowerCase()) {
      throw new Error('Invite email does not match registration email')
    }

    const user = createUser(input.username, input.password, input.displayName, invite.role, {
      email: input.email || null,
      workspace_id: invite.workspace_id,
      tenant_id: invite.tenant_id,
      is_default_membership: true,
    })

    db.prepare(`
      UPDATE auth_invites
      SET accepted_at = ?, accepted_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, user.id, now, invite.id)

    return getUserById(user.id)!
  }

  const slug = String(input.tenantSlug || input.tenantName || input.username)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)

  if (!slug) throw new Error('Workspace slug is required')

  const existingTenant = db.prepare(`SELECT id FROM tenants WHERE slug = ? LIMIT 1`).get(slug) as { id: number } | undefined
  if (existingTenant) throw new Error('Tenant slug already exists')

  const tenantInsert = db.prepare(`
    INSERT INTO tenants (
      slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, config, created_by, updated_at
    ) VALUES (?, ?, ?, 'standard', 'active', ?, ?, '{}', ?, ?)
  `).run(
    slug,
    String(input.tenantName || `${input.displayName}'s Workspace`).trim(),
    slug.slice(0, 30),
    `/tmp/${slug}/.openclaw`,
    `/tmp/${slug}/workspace`,
    input.username,
    now,
  )
  const tenantId = Number(tenantInsert.lastInsertRowid)

  const workspaceInsert = db.prepare(`
    INSERT INTO workspaces (slug, name, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `${slug}-default`,
    String(input.workspaceName || `${input.displayName}'s Workspace`).trim(),
    tenantId,
    now,
    now,
  )

  return createUser(input.username, input.password, input.displayName, 'admin', {
    email: input.email || null,
    workspace_id: Number(workspaceInsert.lastInsertRowid),
    tenant_id: tenantId,
    is_default_membership: true,
  })
}

export function issueSessionForUser(user: User, request: Request) {
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  const userAgent = request.headers.get('user-agent') || undefined
  const { token, expiresAt } = createSession(user.id, ipAddress, userAgent, user.workspace_id)
  logAuditEvent({
    action: 'login',
    actor: user.username,
    actor_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
    detail: { tenant_id: user.tenant_id, workspace_id: user.workspace_id },
  })
  return { token, expiresAt }
}

export function logoutCurrentSession(request: Request) {
  const token = currentSessionToken(request)
  const user = getUserFromRequest(request)
  if (token) destroySession(token)
  return { token, user }
}

export function switchCurrentWorkspace(request: Request, workspaceId: number): User | null {
  const token = currentSessionToken(request)
  if (!token) return null
  return setSessionWorkspace(token, workspaceId)
}

export function createInviteForCurrentUser(user: User, body: { email: string; role: User['role']; workspace_id?: number; expires_in_days?: number }) {
  const created = createTenantInvite(user, {
    email: body.email,
    role: body.role,
    workspaceId: body.workspace_id,
    expiresInDays: body.expires_in_days,
  })
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/register?invite=${encodeURIComponent(created.token)}`
  return { invite: serializeInvite(created.invite), token: created.token, invite_url: inviteUrl }
}

export function createCurrentUserApiKey(user: User, body: { label: string; role?: User['role']; scopes?: string[]; expires_in_days?: number }) {
  const expiresAt = body.expires_in_days
    ? Math.floor(Date.now() / 1000) + Math.max(1, Math.min(365, body.expires_in_days)) * 24 * 60 * 60
    : null
  return createUserApiKey(user, {
    label: body.label,
    role: body.role,
    scopes: body.scopes,
    expiresAt,
  })
}

export function revokeCurrentUserApiKey(user: User, keyId: number) {
  return revokeUserApiKey(user.id, keyId, user.tenant_id)
}

export function revokeCurrentTenantInvite(user: User, inviteId: number) {
  return revokeTenantInvite(user.tenant_id, inviteId)
}
