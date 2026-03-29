"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/auth/users - List all users (admin only)
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const user = (0, auth_1.getUserFromRequest)(request);
    if (!user || user.role !== 'admin') {
        return server_1.NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const tenantId = (_a = user.tenant_id) !== null && _a !== void 0 ? _a : 1;
    const users = (0, auth_1.listUsersForTenant)(tenantId);
    return server_1.NextResponse.json({
        users: users.map((u) => {
            var _a, _b, _c;
            return ({
                id: u.id,
                username: u.username,
                display_name: u.display_name,
                role: u.role,
                provider: u.provider || 'local',
                email: u.email || null,
                avatar_url: u.avatar_url || null,
                is_approved: (_a = u.is_approved) !== null && _a !== void 0 ? _a : 1,
                workspace_id: (_b = u.workspace_id) !== null && _b !== void 0 ? _b : 1,
                tenant_id: (_c = u.tenant_id) !== null && _c !== void 0 ? _c : tenantId,
                memberships: (u.memberships || []).map((membership) => ({
                    workspace_id: membership.workspace_id,
                    workspace_name: membership.workspace_name,
                    workspace_slug: membership.workspace_slug,
                    tenant_id: membership.tenant_id,
                    role: membership.role,
                    is_default: membership.is_default,
                })),
                created_at: u.created_at,
                last_login_at: u.last_login_at,
            });
        }),
    });
}
/**
 * POST /api/auth/users - Create a new user (admin only)
 */
async function POST(request) {
    var _a, _b, _c, _d, _e, _f;
    const currentUser = (0, auth_1.getUserFromRequest)(request);
    if (!currentUser || currentUser.role !== 'admin') {
        return server_1.NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const result = await (0, validation_1.validateBody)(request, validation_1.createUserSchema);
        if ('error' in result)
            return result.error;
        const { username, password, display_name, role, provider, email } = result.data;
        const workspaceId = (_a = currentUser.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const tenantId = (_b = currentUser.tenant_id) !== null && _b !== void 0 ? _b : 1;
        const newUser = (0, auth_1.createUser)(username, password, display_name || username, role, {
            provider,
            email: email || null,
            workspace_id: workspaceId,
            tenant_id: tenantId,
        });
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'user_create', actor: currentUser.username, actor_id: currentUser.id,
            target_type: 'user', target_id: newUser.id,
            detail: { username, role, provider, email }, ip_address: ipAddress,
        });
        return server_1.NextResponse.json({
            user: {
                id: newUser.id,
                username: newUser.username,
                display_name: newUser.display_name,
                role: newUser.role,
                provider: newUser.provider || 'local',
                email: newUser.email || null,
                avatar_url: newUser.avatar_url || null,
                is_approved: (_c = newUser.is_approved) !== null && _c !== void 0 ? _c : 1,
                workspace_id: (_d = newUser.workspace_id) !== null && _d !== void 0 ? _d : 1,
                tenant_id: (_e = newUser.tenant_id) !== null && _e !== void 0 ? _e : 1,
            }
        }, { status: 201 });
    }
    catch (error) {
        if ((_f = error.message) === null || _f === void 0 ? void 0 : _f.includes('UNIQUE constraint failed')) {
            return server_1.NextResponse.json({ error: 'Username already exists' }, { status: 409 });
        }
        logger_1.logger.error({ err: error }, 'POST /api/auth/users error');
        return server_1.NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
}
/**
 * PUT /api/auth/users - Update a user (admin only)
 */
async function PUT(request) {
    var _a, _b, _c, _d, _e, _f;
    const currentUser = (0, auth_1.getUserFromRequest)(request);
    if (!currentUser || currentUser.role !== 'admin') {
        return server_1.NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    try {
        const { id, display_name, role, password, is_approved, email, avatar_url } = await request.json();
        const userId = parseInt(String(id));
        if (!id || Number.isNaN(userId)) {
            return server_1.NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }
        if (role && !['admin', 'operator', 'viewer'].includes(role)) {
            return server_1.NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }
        // Prevent demoting yourself
        if (userId === currentUser.id && role && role !== currentUser.role) {
            return server_1.NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
        }
        const workspaceId = (_a = currentUser.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const tenantId = (_b = currentUser.tenant_id) !== null && _b !== void 0 ? _b : 1;
        const existing = (0, auth_1.getUserById)(userId);
        if (!existing || ((_c = existing.tenant_id) !== null && _c !== void 0 ? _c : 1) !== tenantId) {
            return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const updated = (0, auth_1.updateUser)(userId, { display_name, role, password: password || undefined, is_approved, email, avatar_url, tenant_id: tenantId });
        if (!updated) {
            return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'user_update', actor: currentUser.username, actor_id: currentUser.id,
            target_type: 'user', target_id: userId,
            detail: { display_name, role, password_changed: !!password, is_approved }, ip_address: ipAddress,
        });
        return server_1.NextResponse.json({
            user: {
                id: updated.id,
                username: updated.username,
                display_name: updated.display_name,
                role: updated.role,
                provider: updated.provider || 'local',
                email: updated.email || null,
                avatar_url: updated.avatar_url || null,
                is_approved: (_d = updated.is_approved) !== null && _d !== void 0 ? _d : 1,
                workspace_id: (_e = updated.workspace_id) !== null && _e !== void 0 ? _e : 1,
                tenant_id: (_f = updated.tenant_id) !== null && _f !== void 0 ? _f : 1,
            }
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/auth/users error');
        return server_1.NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
}
/**
 * DELETE /api/auth/users - Delete a user (admin only)
 */
async function DELETE(request) {
    var _a, _b;
    const currentUser = (0, auth_1.getUserFromRequest)(request);
    if (!currentUser || currentUser.role !== 'admin') {
        return server_1.NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    let body;
    try {
        body = await request.json();
    }
    catch (_c) {
        return server_1.NextResponse.json({ error: 'Request body required' }, { status: 400 });
    }
    const id = body.id;
    if (!id) {
        return server_1.NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    const userId = parseInt(id);
    // Prevent deleting yourself
    if (userId === currentUser.id) {
        return server_1.NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }
    const tenantId = (_a = currentUser.tenant_id) !== null && _a !== void 0 ? _a : 1;
    const existing = (0, auth_1.getUserById)(userId);
    if (!existing || ((_b = existing.tenant_id) !== null && _b !== void 0 ? _b : 1) !== tenantId) {
        return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const deleted = (0, auth_1.deleteUser)(userId);
    if (!deleted) {
        return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    (0, db_1.logAuditEvent)({
        action: 'user_delete', actor: currentUser.username, actor_id: currentUser.id,
        target_type: 'user', target_id: userId,
        ip_address: ipAddress,
    });
    return server_1.NextResponse.json({ success: true });
}
