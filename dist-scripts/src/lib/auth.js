"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthResolver = registerAuthResolver;
exports.safeCompare = safeCompare;
exports.getWorkspaceIdFromRequest = getWorkspaceIdFromRequest;
exports.getTenantIdFromRequest = getTenantIdFromRequest;
exports.createSession = createSession;
exports.validateSession = validateSession;
exports.destroySession = destroySession;
exports.destroyAllUserSessions = destroyAllUserSessions;
exports.authenticateUser = authenticateUser;
exports.getUserById = getUserById;
exports.getAllUsers = getAllUsers;
exports.createUser = createUser;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
exports.listUsersForTenant = listUsersForTenant;
exports.setUserDefaultWorkspace = setUserDefaultWorkspace;
exports.setSessionWorkspace = setSessionWorkspace;
exports.listUserApiKeys = listUserApiKeys;
exports.createUserApiKey = createUserApiKey;
exports.revokeUserApiKey = revokeUserApiKey;
exports.listTenantInvites = listTenantInvites;
exports.createTenantInvite = createTenantInvite;
exports.revokeTenantInvite = revokeTenantInvite;
exports.getInviteByToken = getInviteByToken;
exports.acceptInviteForUser = acceptInviteForUser;
exports.getUserFromRequest = getUserFromRequest;
exports.requireRole = requireRole;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const password_1 = require("./password");
const security_events_1 = require("./security-events");
const session_cookie_1 = require("./session-cookie");
let _authResolverHook = null;
function registerAuthResolver(hook) {
    _authResolverHook = hook;
}
/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Compare against dummy buffer to avoid timing leak on length mismatch
        const dummy = Buffer.alloc(bufA.length);
        (0, crypto_1.timingSafeEqual)(bufA, dummy);
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(bufA, bufB);
}
// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
function getDefaultWorkspaceContext() {
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare(`
      SELECT id, tenant_id
      FROM workspaces
      ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get();
        return {
            workspaceId: (row === null || row === void 0 ? void 0 : row.id) || 1,
            tenantId: (row === null || row === void 0 ? void 0 : row.tenant_id) || 1,
        };
    }
    catch (_a) {
        return { workspaceId: 1, tenantId: 1 };
    }
}
function getWorkspaceIdFromRequest(request) {
    const user = getUserFromRequest(request);
    return (user === null || user === void 0 ? void 0 : user.workspace_id) || getDefaultWorkspaceContext().workspaceId;
}
function getTenantIdFromRequest(request) {
    const user = getUserFromRequest(request);
    return (user === null || user === void 0 ? void 0 : user.tenant_id) || getDefaultWorkspaceContext().tenantId;
}
function resolveTenantForWorkspace(workspaceId) {
    const db = (0, db_1.getDatabase)();
    const row = db.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`).get(workspaceId);
    return (row === null || row === void 0 ? void 0 : row.tenant_id) || getDefaultWorkspaceContext().tenantId;
}
function listMembershipsForUser(userId) {
    const db = (0, db_1.getDatabase)();
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
    `).all(userId);
    }
    catch (_a) {
        return [];
    }
}
function getMembershipForWorkspace(userId, workspaceId) {
    return listMembershipsForUser(userId).find((membership) => membership.workspace_id === workspaceId) || null;
}
function resolvePreferredMembership(userId, preferredWorkspaceId) {
    const memberships = listMembershipsForUser(userId);
    if (memberships.length === 0)
        return null;
    if (preferredWorkspaceId) {
        const explicit = memberships.find((membership) => membership.workspace_id === preferredWorkspaceId);
        if (explicit)
            return explicit;
    }
    return memberships.find((membership) => membership.is_default === 1) || memberships[0];
}
function hydrateUserFromRow(row, preferredWorkspaceId) {
    var _a, _b, _c, _d, _e, _f, _g;
    const fallbackContext = getDefaultWorkspaceContext();
    const membership = resolvePreferredMembership(row.id, (_a = preferredWorkspaceId !== null && preferredWorkspaceId !== void 0 ? preferredWorkspaceId : row.workspace_id) !== null && _a !== void 0 ? _a : fallbackContext.workspaceId);
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
            email: (_b = row.email) !== null && _b !== void 0 ? _b : null,
            avatar_url: (_c = row.avatar_url) !== null && _c !== void 0 ? _c : null,
            is_approved: (_d = row.is_approved) !== null && _d !== void 0 ? _d : 1,
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_login_at: row.last_login_at,
            memberships: listMembershipsForUser(row.id),
        };
    }
    return {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        workspace_id: row.workspace_id || fallbackContext.workspaceId,
        tenant_id: resolveTenantForWorkspace(row.workspace_id || fallbackContext.workspaceId),
        provider: row.provider || 'local',
        email: (_e = row.email) !== null && _e !== void 0 ? _e : null,
        avatar_url: (_f = row.avatar_url) !== null && _f !== void 0 ? _f : null,
        is_approved: (_g = row.is_approved) !== null && _g !== void 0 ? _g : 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
        memberships: [],
    };
}
function createSession(userId, ipAddress, userAgent, workspaceId) {
    var _a;
    const db = (0, db_1.getDatabase)();
    const token = (0, crypto_1.randomBytes)(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_DURATION;
    const membership = resolvePreferredMembership(userId, workspaceId);
    const resolvedWorkspaceId = (membership === null || membership === void 0 ? void 0 : membership.workspace_id) || workspaceId || (((_a = db.prepare('SELECT workspace_id FROM users WHERE id = ?').get(userId)) === null || _a === void 0 ? void 0 : _a.workspace_id) || getDefaultWorkspaceContext().workspaceId);
    const resolvedTenantId = (membership === null || membership === void 0 ? void 0 : membership.tenant_id) || resolveTenantForWorkspace(resolvedWorkspaceId);
    db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, userId, expiresAt, ipAddress || null, userAgent || null, resolvedWorkspaceId, resolvedTenantId);
    // Update user's last login
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ?, workspace_id = ? WHERE id = ?').run(now, now, resolvedWorkspaceId, userId);
    // Clean up expired sessions
    db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(now);
    return { token, expiresAt };
}
function validateSession(token) {
    if (!token)
        return null;
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
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
  `).get(token, now);
    if (!row)
        return null;
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
    }, row.workspace_id);
    if (!hydrated)
        return null;
    return Object.assign(Object.assign({}, hydrated), { sessionId: row.session_id });
}
function destroySession(token) {
    const db = (0, db_1.getDatabase)();
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
}
function destroyAllUserSessions(userId) {
    const db = (0, db_1.getDatabase)();
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}
// Dummy hash used for constant-time rejection when user doesn't exist.
// This ensures authenticateUser takes the same time whether or not the username is valid,
// preventing timing-based username enumeration.
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
// User management
function authenticateUser(username, password) {
    var _a;
    const db = (0, db_1.getDatabase)();
    const identifier = username.trim();
    const row = db.prepare(`
    SELECT *
    FROM users
    WHERE username = ? OR (email IS NOT NULL AND lower(email) = lower(?))
    ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(identifier, identifier, identifier);
    if (!row) {
        // Always run verifyPassword to prevent timing-based username enumeration
        (0, password_1.verifyPassword)(password, DUMMY_HASH);
        try {
            (0, security_events_1.logSecurityEvent)({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'user_not_found' }), workspace_id: 1, tenant_id: 1 });
        }
        catch (_b) { }
        return null;
    }
    if ((row.provider || 'local') !== 'local') {
        (0, password_1.verifyPassword)(password, DUMMY_HASH);
        try {
            (0, security_events_1.logSecurityEvent)({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'wrong_provider' }), workspace_id: 1, tenant_id: 1 });
        }
        catch (_c) { }
        return null;
    }
    if (((_a = row.is_approved) !== null && _a !== void 0 ? _a : 1) !== 1) {
        (0, password_1.verifyPassword)(password, DUMMY_HASH);
        try {
            (0, security_events_1.logSecurityEvent)({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'not_approved' }), workspace_id: 1, tenant_id: 1 });
        }
        catch (_d) { }
        return null;
    }
    if (!(0, password_1.verifyPassword)(password, row.password_hash)) {
        try {
            (0, security_events_1.logSecurityEvent)({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'invalid_password' }), workspace_id: 1, tenant_id: 1 });
        }
        catch (_e) { }
        return null;
    }
    return hydrateUserFromRow(row, row.workspace_id || getDefaultWorkspaceContext().workspaceId);
}
function getUserById(id) {
    const db = (0, db_1.getDatabase)();
    const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id = ?
  `).get(id);
    return row ? hydrateUserFromRow(row, row.workspace_id) : null;
}
function getAllUsers() {
    const db = (0, db_1.getDatabase)();
    const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    ORDER BY u.created_at
  `).all();
    return rows.map((row) => hydrateUserFromRow(row, row.workspace_id)).filter((row) => Boolean(row));
}
function createUser(username, password, displayName, role = 'operator', options) {
    const db = (0, db_1.getDatabase)();
    if (password.length < 12)
        throw new Error('Password must be at least 12 characters');
    const passwordHash = (0, password_1.hashPassword)(password);
    const provider = (options === null || options === void 0 ? void 0 : options.provider) || 'local';
    const workspaceId = (options === null || options === void 0 ? void 0 : options.workspace_id) || getDefaultWorkspaceContext().workspaceId;
    const tenantId = (options === null || options === void 0 ? void 0 : options.tenant_id) || resolveTenantForWorkspace(workspaceId);
    const now = Math.floor(Date.now() / 1000);
    const result = db.transaction(() => {
        const inserted = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, provider, provider_user_id, email, avatar_url, is_approved, approved_by, approved_at, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, displayName, passwordHash, role, provider, (options === null || options === void 0 ? void 0 : options.provider_user_id) || null, (options === null || options === void 0 ? void 0 : options.email) || null, (options === null || options === void 0 ? void 0 : options.avatar_url) || null, typeof (options === null || options === void 0 ? void 0 : options.is_approved) === 'number' ? options.is_approved : 1, (options === null || options === void 0 ? void 0 : options.approved_by) || null, (options === null || options === void 0 ? void 0 : options.approved_at) || null, workspaceId, now, now);
        try {
            db.prepare(`
        INSERT INTO tenant_memberships (
          user_id, tenant_id, workspace_id, role, status, is_default, invited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?)
      `).run(Number(inserted.lastInsertRowid), tenantId, workspaceId, role, (options === null || options === void 0 ? void 0 : options.is_default_membership) === false ? 0 : 1, now, now);
        }
        catch (_a) {
            // Membership table is migration-backed; if unavailable, continue with legacy behavior.
        }
        return inserted;
    })();
    return getUserById(Number(result.lastInsertRowid));
}
function updateUser(id, updates) {
    const db = (0, db_1.getDatabase)();
    const fields = [];
    const params = [];
    if (updates.display_name !== undefined) {
        fields.push('display_name = ?');
        params.push(updates.display_name);
    }
    if (updates.role !== undefined) {
        fields.push('role = ?');
        params.push(updates.role);
    }
    if (updates.password !== undefined) {
        fields.push('password_hash = ?');
        params.push((0, password_1.hashPassword)(updates.password));
    }
    if (updates.email !== undefined) {
        fields.push('email = ?');
        params.push(updates.email);
    }
    if (updates.avatar_url !== undefined) {
        fields.push('avatar_url = ?');
        params.push(updates.avatar_url);
    }
    if (updates.is_approved !== undefined) {
        fields.push('is_approved = ?');
        params.push(updates.is_approved);
    }
    if (fields.length === 0)
        return getUserById(id);
    fields.push('updated_at = ?');
    params.push(Math.floor(Date.now() / 1000));
    params.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    if (updates.role !== undefined) {
        try {
            if (updates.tenant_id) {
                db.prepare(`
          UPDATE tenant_memberships
          SET role = ?, updated_at = ?
          WHERE user_id = ? AND tenant_id = ?
        `).run(updates.role, Math.floor(Date.now() / 1000), id, updates.tenant_id);
            }
            else {
                db.prepare(`
          UPDATE tenant_memberships
          SET role = ?, updated_at = ?
          WHERE user_id = ?
        `).run(updates.role, Math.floor(Date.now() / 1000), id);
            }
        }
        catch (_a) {
            // Membership sync is best-effort for backward compatibility.
        }
    }
    return getUserById(id);
}
function deleteUser(id) {
    const db = (0, db_1.getDatabase)();
    destroyAllUserSessions(id);
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return result.changes > 0;
}
function listUsersForTenant(tenantId) {
    const db = (0, db_1.getDatabase)();
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
  `).all(tenantId, tenantId);
    return rows.map((row) => hydrateUserFromRow(row, row.workspace_id)).filter((row) => Boolean(row));
}
function setUserDefaultWorkspace(userId, workspaceId) {
    const db = (0, db_1.getDatabase)();
    const membership = getMembershipForWorkspace(userId, workspaceId);
    if (!membership)
        return null;
    const now = Math.floor(Date.now() / 1000);
    db.transaction(() => {
        db.prepare(`
      UPDATE tenant_memberships
      SET is_default = CASE WHEN workspace_id = ? THEN 1 ELSE 0 END,
          updated_at = ?
      WHERE user_id = ? AND tenant_id = ?
    `).run(workspaceId, now, userId, membership.tenant_id);
        db.prepare(`
      UPDATE users
      SET workspace_id = ?, updated_at = ?
      WHERE id = ?
    `).run(workspaceId, now, userId);
    })();
    return getUserById(userId);
}
function setSessionWorkspace(token, workspaceId) {
    const db = (0, db_1.getDatabase)();
    const session = db.prepare(`
    SELECT user_id
    FROM user_sessions
    WHERE token = ?
    LIMIT 1
  `).get(token);
    if (!session)
        return null;
    const membership = getMembershipForWorkspace(session.user_id, workspaceId);
    if (!membership)
        return null;
    const now = Math.floor(Date.now() / 1000);
    db.transaction(() => {
        db.prepare(`
      UPDATE user_sessions
      SET workspace_id = ?, tenant_id = ?
      WHERE token = ?
    `).run(workspaceId, membership.tenant_id, token);
        db.prepare(`
      UPDATE tenant_memberships
      SET is_default = CASE WHEN workspace_id = ? THEN 1 ELSE 0 END,
          updated_at = ?
      WHERE user_id = ? AND tenant_id = ?
    `).run(workspaceId, now, session.user_id, membership.tenant_id);
        db.prepare(`
      UPDATE users
      SET workspace_id = ?, updated_at = ?
      WHERE id = ?
    `).run(workspaceId, now, session.user_id);
    })();
    return getUserById(session.user_id);
}
function listUserApiKeys(userId, tenantId) {
    const db = (0, db_1.getDatabase)();
    const rows = db.prepare(`
    SELECT id, label, key_prefix, role, scopes, expires_at, last_used_at, last_used_ip, is_revoked, workspace_id, tenant_id, created_at, updated_at
    FROM api_keys
    WHERE user_id = ?
      ${tenantId ? 'AND tenant_id = ?' : ''}
    ORDER BY created_at DESC, id DESC
  `).all(...(tenantId ? [userId, tenantId] : [userId]));
    return rows.map((row) => (Object.assign(Object.assign({}, row), { scopes: (() => {
            try {
                const parsed = JSON.parse(row.scopes || '[]');
                return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
            }
            catch (_a) {
                return [];
            }
        })() })));
}
function createUserApiKey(user, input) {
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    const rawKey = `mcu_${(0, crypto_1.randomBytes)(24).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const result = db.prepare(`
    INSERT INTO api_keys (
      user_id, label, key_prefix, key_hash, role, scopes, expires_at, workspace_id, tenant_id, is_revoked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(user.id, input.label.trim(), keyPrefix, keyHash, input.role || user.role, JSON.stringify(Array.isArray(input.scopes) ? input.scopes : []), input.expiresAt || null, user.workspace_id, user.tenant_id, now, now);
    const record = listUserApiKeys(user.id, user.tenant_id).find((row) => row.id === Number(result.lastInsertRowid));
    if (!record)
        throw new Error('Failed to create API key');
    return { record, rawKey };
}
function revokeUserApiKey(userId, keyId, tenantId) {
    const db = (0, db_1.getDatabase)();
    const result = db.prepare(`
    UPDATE api_keys
    SET is_revoked = 1, updated_at = unixepoch()
    WHERE id = ? AND user_id = ?
      ${tenantId ? 'AND tenant_id = ?' : ''}
      AND is_revoked = 0
  `).run(...(tenantId ? [keyId, userId, tenantId] : [keyId, userId]));
    return result.changes > 0;
}
function listTenantInvites(tenantId) {
    const db = (0, db_1.getDatabase)();
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
    `).all(tenantId);
    }
    catch (_a) {
        return [];
    }
}
function createTenantInvite(user, input) {
    const db = (0, db_1.getDatabase)();
    const workspaceId = input.workspaceId || user.workspace_id;
    const membership = getMembershipForWorkspace(user.id, workspaceId);
    if (!membership || membership.tenant_id !== user.tenant_id) {
        throw new Error('Workspace is not accessible for this tenant');
    }
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Math.max(1, Math.min(30, input.expiresInDays || 7)) * 24 * 60 * 60;
    const token = `mci_${(0, crypto_1.randomBytes)(24).toString('hex')}`;
    const tokenHash = hashApiKey(token);
    const tokenHint = token.slice(0, 10);
    const result = db.prepare(`
    INSERT INTO auth_invites (
      email, tenant_id, workspace_id, role, token_hash, token_hint, invited_by_user_id, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.email.trim().toLowerCase(), user.tenant_id, workspaceId, input.role, tokenHash, tokenHint, user.id, expiresAt, now, now);
    const invite = listTenantInvites(user.tenant_id).find((row) => row.id === Number(result.lastInsertRowid));
    if (!invite)
        throw new Error('Failed to create invite');
    return { invite, token };
}
function revokeTenantInvite(tenantId, inviteId) {
    const db = (0, db_1.getDatabase)();
    const result = db.prepare(`
    UPDATE auth_invites
    SET revoked_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL AND accepted_at IS NULL
  `).run(inviteId, tenantId);
    return result.changes > 0;
}
function getInviteByToken(token) {
    const db = (0, db_1.getDatabase)();
    const tokenHash = hashApiKey(token);
    const now = Math.floor(Date.now() / 1000);
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
    `).get(tokenHash, now);
        return row || null;
    }
    catch (_a) {
        return null;
    }
}
function acceptInviteForUser(inviteId, userId) {
    const db = (0, db_1.getDatabase)();
    const invite = db.prepare(`
    SELECT id, tenant_id, workspace_id, role
    FROM auth_invites
    WHERE id = ? AND revoked_at IS NULL AND accepted_at IS NULL
    LIMIT 1
  `).get(inviteId);
    if (!invite)
        return null;
    const now = Math.floor(Date.now() / 1000);
    db.transaction(() => {
        db.prepare(`
      INSERT INTO tenant_memberships (
        user_id, tenant_id, workspace_id, role, status, is_default, invited_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', 0, NULL, ?, ?)
      ON CONFLICT(user_id, workspace_id) DO UPDATE SET
        role = excluded.role,
        status = 'active',
        updated_at = excluded.updated_at
    `).run(userId, invite.tenant_id, invite.workspace_id, invite.role, now, now);
        db.prepare(`
      UPDATE auth_invites
      SET accepted_at = ?, accepted_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, userId, now, inviteId);
    })();
    const membership = getMembershipForWorkspace(userId, invite.workspace_id);
    if ((membership === null || membership === void 0 ? void 0 : membership.is_default) !== 1) {
        setUserDefaultWorkspace(userId, invite.workspace_id);
    }
    return getUserById(userId);
}
function resolveOrProvisionProxyUser(username) {
    var _a, _b, _c, _d;
    try {
        const db = (0, db_1.getDatabase)();
        const { workspaceId } = getDefaultWorkspaceContext();
        const row = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.workspace_id,
             COALESCE(w.tenant_id, 1) as tenant_id,
             u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.username = ?
    `).get(username);
        if (row) {
            if (((_a = row.is_approved) !== null && _a !== void 0 ? _a : 1) !== 1)
                return null;
            return {
                id: row.id,
                username: row.username,
                display_name: row.display_name,
                role: row.role,
                workspace_id: row.workspace_id || workspaceId,
                tenant_id: resolveTenantForWorkspace(row.workspace_id || workspaceId),
                provider: row.provider || 'local',
                email: (_b = row.email) !== null && _b !== void 0 ? _b : null,
                avatar_url: (_c = row.avatar_url) !== null && _c !== void 0 ? _c : null,
                is_approved: (_d = row.is_approved) !== null && _d !== void 0 ? _d : 1,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_login_at: row.last_login_at,
            };
        }
        // Auto-provision if MC_PROXY_AUTH_DEFAULT_ROLE is configured
        const defaultRole = (process.env.MC_PROXY_AUTH_DEFAULT_ROLE || '').trim();
        if (!defaultRole || !['viewer', 'operator', 'admin'].includes(defaultRole)) {
            return null;
        }
        // Random password — proxy users cannot log in via the local login form
        return createUser(username, (0, crypto_1.randomBytes)(32).toString('hex'), username, defaultRole);
    }
    catch (_e) {
        return null;
    }
}
function getUserFromRequest(request) {
    var _a, _b, _c;
    // Extract agent identity header (optional, for attribution)
    const agentName = (request.headers.get('x-agent-name') || '').trim() || null;
    // Proxy / trusted-header auth (MC_PROXY_AUTH_HEADER)
    // When the gateway has already authenticated the user and injects their username
    // as a trusted header (e.g. X-Auth-Username from Envoy OIDC claimToHeaders),
    // skip the local login form entirely.
    const proxyAuthHeader = (process.env.MC_PROXY_AUTH_HEADER || '').trim();
    if (proxyAuthHeader) {
        const proxyUsername = (request.headers.get(proxyAuthHeader) || '').trim();
        if (proxyUsername) {
            const user = resolveOrProvisionProxyUser(proxyUsername);
            if (user)
                return Object.assign(Object.assign({}, user), { agent_name: agentName });
        }
    }
    // Check session cookie
    const cookieHeader = request.headers.get('cookie') || '';
    const sessionToken = (0, session_cookie_1.parseMcSessionCookieHeader)(cookieHeader);
    if (sessionToken) {
        const user = validateSession(sessionToken);
        if (user)
            return Object.assign(Object.assign({}, user), { agent_name: agentName });
    }
    // Check API key - DB override first, then env var
    const apiKey = extractApiKeyFromHeaders(request.headers);
    const configuredApiKey = resolveActiveApiKey();
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
        };
    }
    // Agent-scoped API keys
    if (apiKey) {
        try {
            const db = (0, db_1.getDatabase)();
            const keyHash = hashApiKey(apiKey);
            const now = Math.floor(Date.now() / 1000);
            const userKey = db.prepare(`
        SELECT user_id, role, workspace_id, tenant_id, expires_at, is_revoked
        FROM api_keys
        WHERE key_hash = ?
        LIMIT 1
      `).get(keyHash);
            if (userKey && !userKey.is_revoked && (!userKey.expires_at || userKey.expires_at > now)) {
                db.prepare(`
          UPDATE api_keys
          SET last_used_at = ?, last_used_ip = ?, updated_at = ?
          WHERE key_hash = ?
        `).run(now, request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null, now, keyHash);
                const resolved = getUserById(userKey.user_id);
                if (resolved) {
                    const scoped = userKey.workspace_id ? hydrateUserFromRow({
                        id: resolved.id,
                        username: resolved.username,
                        display_name: resolved.display_name,
                        role: resolved.role,
                        workspace_id: resolved.workspace_id,
                        tenant_id: resolved.tenant_id,
                        provider: resolved.provider === 'proxy' ? 'local' : (resolved.provider || 'local'),
                        email: (_a = resolved.email) !== null && _a !== void 0 ? _a : null,
                        avatar_url: (_b = resolved.avatar_url) !== null && _b !== void 0 ? _b : null,
                        is_approved: (_c = resolved.is_approved) !== null && _c !== void 0 ? _c : 1,
                        created_at: resolved.created_at,
                        updated_at: resolved.updated_at,
                        last_login_at: resolved.last_login_at,
                        password_hash: '',
                    }, userKey.workspace_id) : resolved;
                    if (scoped) {
                        return Object.assign(Object.assign({}, scoped), { role: userKey.role || scoped.role, agent_name: agentName });
                    }
                }
            }
            const row = db.prepare(`
        SELECT id, agent_id, workspace_id, tenant_id, scopes, expires_at, revoked_at
        FROM agent_api_keys
        WHERE key_hash = ?
        LIMIT 1
      `).get(keyHash);
            if (row && !row.revoked_at && (!row.expires_at || row.expires_at > now)) {
                const scopes = parseAgentScopes(row.scopes);
                const agent = db
                    .prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?')
                    .get(row.agent_id, row.workspace_id);
                if (agent) {
                    if (agentName && agentName !== agent.name && !scopes.has('admin')) {
                        return null;
                    }
                    db.prepare('UPDATE agent_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
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
                    };
                }
            }
        }
        catch (_d) {
            // ignore missing table / startup race
        }
    }
    // Plugin hook: allow Pro (or other extensions) to resolve custom API keys
    if (apiKey && _authResolverHook) {
        const resolved = _authResolverHook(apiKey, agentName);
        if (resolved)
            return resolved;
    }
    return null;
}
/**
 * Resolve the active API key: check DB settings override first, then env var.
 */
function resolveActiveApiKey() {
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'security.api_key'").get();
        if (row === null || row === void 0 ? void 0 : row.value)
            return row.value;
    }
    catch (_a) {
        // DB not ready yet — fall back to env
    }
    return (process.env.API_KEY || '').trim();
}
function extractApiKeyFromHeaders(headers) {
    const direct = (headers.get('x-api-key') || '').trim();
    if (direct)
        return direct;
    const authorization = (headers.get('authorization') || '').trim();
    if (!authorization)
        return null;
    const [scheme, ...rest] = authorization.split(/\s+/);
    if (!scheme || rest.length === 0)
        return null;
    const normalized = scheme.toLowerCase();
    if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
        return rest.join(' ').trim() || null;
    }
    return null;
}
function hashApiKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
function parseAgentScopes(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return new Set(parsed.map((scope) => String(scope)));
    }
    catch (_a) {
        // ignore parse errors
    }
    return new Set();
}
function deriveRoleFromScopes(scopes) {
    if (scopes.has('admin'))
        return 'admin';
    if (scopes.has('operator'))
        return 'operator';
    return 'viewer';
}
/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS = { viewer: 0, operator: 1, admin: 2 };
/**
 * Check if a user meets the minimum role requirement.
 * Returns { user } on success, or { error, status } on failure (401 or 403).
 */
function requireRole(request, minRole) {
    var _a;
    const user = getUserFromRequest(request);
    if (!user) {
        return { error: 'Authentication required', status: 401 };
    }
    if (((_a = ROLE_LEVELS[user.role]) !== null && _a !== void 0 ? _a : -1) < ROLE_LEVELS[minRole]) {
        return { error: `Requires ${minRole} role or higher`, status: 403 };
    }
    return { user };
}
