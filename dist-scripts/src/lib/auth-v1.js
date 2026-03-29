"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeUser = serializeUser;
exports.serializeInvite = serializeInvite;
exports.serializeApiKey = serializeApiKey;
exports.applySessionCookie = applySessionCookie;
exports.clearSessionCookie = clearSessionCookie;
exports.currentSessionToken = currentSessionToken;
exports.buildAuthPayload = buildAuthPayload;
exports.registerUserWithTenant = registerUserWithTenant;
exports.issueSessionForUser = issueSessionForUser;
exports.logoutCurrentSession = logoutCurrentSession;
exports.switchCurrentWorkspace = switchCurrentWorkspace;
exports.createInviteForCurrentUser = createInviteForCurrentUser;
exports.createCurrentUserApiKey = createCurrentUserApiKey;
exports.revokeCurrentUserApiKey = revokeCurrentUserApiKey;
exports.revokeCurrentTenantInvite = revokeCurrentTenantInvite;
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const session_cookie_1 = require("@/lib/session-cookie");
function serializeUser(user) {
    var _a, _b;
    return {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        provider: user.provider || 'local',
        email: user.email || null,
        avatar_url: user.avatar_url || null,
        workspace_id: (_a = user.workspace_id) !== null && _a !== void 0 ? _a : 1,
        workspace_slug: user.workspace_slug || null,
        workspace_name: user.workspace_name || null,
        tenant_id: (_b = user.tenant_id) !== null && _b !== void 0 ? _b : 1,
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
    };
}
function serializeInvite(invite) {
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
    };
}
function serializeApiKey(key) {
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
    };
}
function applySessionCookie(response, request, token, expiresAt) {
    const nextResponse = response;
    const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
    const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
    nextResponse.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest })));
}
function clearSessionCookie(response, request) {
    const nextResponse = response;
    const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
    const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
    nextResponse.cookies.set(cookieName, '', Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: 0, isSecureRequest })));
}
function currentSessionToken(request) {
    const cookieHeader = request.headers.get('cookie') || '';
    return (0, session_cookie_1.parseMcSessionCookieHeader)(cookieHeader);
}
function buildAuthPayload(user) {
    return {
        user: serializeUser(user),
        api_keys: (0, auth_1.listUserApiKeys)(user.id, user.tenant_id).map(serializeApiKey),
        invites: user.role === 'admin' ? (0, auth_1.listTenantInvites)(user.tenant_id).map(serializeInvite) : [],
    };
}
function registerUserWithTenant(input) {
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    if (input.inviteToken) {
        const invite = (0, auth_1.getInviteByToken)(input.inviteToken);
        if (!invite)
            throw new Error('Invite is invalid or expired');
        if (invite.email.toLowerCase() !== String(input.email || '').trim().toLowerCase()) {
            throw new Error('Invite email does not match registration email');
        }
        const user = (0, auth_1.createUser)(input.username, input.password, input.displayName, invite.role, {
            email: input.email || null,
            workspace_id: invite.workspace_id,
            tenant_id: invite.tenant_id,
            is_default_membership: true,
        });
        db.prepare(`
      UPDATE auth_invites
      SET accepted_at = ?, accepted_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, user.id, now, invite.id);
        return (0, auth_1.getUserById)(user.id);
    }
    const slug = String(input.tenantSlug || input.tenantName || input.username)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
    if (!slug)
        throw new Error('Workspace slug is required');
    const existingTenant = db.prepare(`SELECT id FROM tenants WHERE slug = ? LIMIT 1`).get(slug);
    if (existingTenant)
        throw new Error('Tenant slug already exists');
    const tenantInsert = db.prepare(`
    INSERT INTO tenants (
      slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, config, created_by, updated_at
    ) VALUES (?, ?, ?, 'standard', 'active', ?, ?, '{}', ?, ?)
  `).run(slug, String(input.tenantName || `${input.displayName}'s Workspace`).trim(), slug.slice(0, 30), `/tmp/${slug}/.openclaw`, `/tmp/${slug}/workspace`, input.username, now);
    const tenantId = Number(tenantInsert.lastInsertRowid);
    const workspaceInsert = db.prepare(`
    INSERT INTO workspaces (slug, name, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(`${slug}-default`, String(input.workspaceName || `${input.displayName}'s Workspace`).trim(), tenantId, now, now);
    return (0, auth_1.createUser)(input.username, input.password, input.displayName, 'admin', {
        email: input.email || null,
        workspace_id: Number(workspaceInsert.lastInsertRowid),
        tenant_id: tenantId,
        is_default_membership: true,
    });
}
function issueSessionForUser(user, request) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;
    const { token, expiresAt } = (0, auth_1.createSession)(user.id, ipAddress, userAgent, user.workspace_id);
    (0, db_1.logAuditEvent)({
        action: 'login',
        actor: user.username,
        actor_id: user.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        detail: { tenant_id: user.tenant_id, workspace_id: user.workspace_id },
    });
    return { token, expiresAt };
}
function logoutCurrentSession(request) {
    const token = currentSessionToken(request);
    const user = (0, auth_1.getUserFromRequest)(request);
    if (token)
        (0, auth_1.destroySession)(token);
    return { token, user };
}
function switchCurrentWorkspace(request, workspaceId) {
    const token = currentSessionToken(request);
    if (!token)
        return null;
    return (0, auth_1.setSessionWorkspace)(token, workspaceId);
}
function createInviteForCurrentUser(user, body) {
    const created = (0, auth_1.createTenantInvite)(user, {
        email: body.email,
        role: body.role,
        workspaceId: body.workspace_id,
        expiresInDays: body.expires_in_days,
    });
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/register?invite=${encodeURIComponent(created.token)}`;
    return { invite: serializeInvite(created.invite), token: created.token, invite_url: inviteUrl };
}
function createCurrentUserApiKey(user, body) {
    const expiresAt = body.expires_in_days
        ? Math.floor(Date.now() / 1000) + Math.max(1, Math.min(365, body.expires_in_days)) * 24 * 60 * 60
        : null;
    return (0, auth_1.createUserApiKey)(user, {
        label: body.label,
        role: body.role,
        scopes: body.scopes,
        expiresAt,
    });
}
function revokeCurrentUserApiKey(user, keyId) {
    return (0, auth_1.revokeUserApiKey)(user.id, keyId, user.tenant_id);
}
function revokeCurrentTenantInvite(user, inviteId) {
    return (0, auth_1.revokeTenantInvite)(user.tenant_id, inviteId);
}
