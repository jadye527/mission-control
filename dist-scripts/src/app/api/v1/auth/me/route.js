"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PATCH = PATCH;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const auth_v1_1 = require("@/lib/auth-v1");
const db_1 = require("@/lib/db");
const password_1 = require("@/lib/password");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json((0, auth_v1_1.buildAuthPayload)(auth.user));
}
async function PATCH(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    if ((body === null || body === void 0 ? void 0 : body.workspace_id) != null) {
        const workspaceId = Number(body.workspace_id);
        if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
            return server_1.NextResponse.json({ error: 'workspace_id must be a positive integer' }, { status: 400 });
        }
        const updated = (0, auth_v1_1.switchCurrentWorkspace)(request, workspaceId);
        if (!updated)
            return server_1.NextResponse.json({ error: 'Workspace not accessible for user' }, { status: 403 });
        return server_1.NextResponse.json((0, auth_v1_1.buildAuthPayload)(updated));
    }
    const updates = { tenant_id: auth.user.tenant_id };
    if (typeof (body === null || body === void 0 ? void 0 : body.display_name) === 'string' && body.display_name.trim()) {
        updates.display_name = body.display_name.trim();
    }
    if (body === null || body === void 0 ? void 0 : body.new_password) {
        if (!(body === null || body === void 0 ? void 0 : body.current_password)) {
            return server_1.NextResponse.json({ error: 'current_password is required' }, { status: 400 });
        }
        const db = (0, db_1.getDatabase)();
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(auth.user.id);
        if (!(row === null || row === void 0 ? void 0 : row.password_hash) || !(0, password_1.verifyPassword)(String(body.current_password), row.password_hash)) {
            return server_1.NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
        }
        updates.password = String(body.new_password);
    }
    if (!updates.display_name && !updates.password) {
        return server_1.NextResponse.json({ error: 'No supported fields provided' }, { status: 400 });
    }
    const updated = (0, auth_1.updateUser)(auth.user.id, updates);
    if (!updated)
        return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
    (0, db_1.logAuditEvent)({
        action: 'user_profile_updated',
        actor: auth.user.username,
        actor_id: auth.user.id,
        detail: { display_name: updates.display_name ? true : false, password: updates.password ? true : false },
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    });
    return server_1.NextResponse.json((0, auth_v1_1.buildAuthPayload)(updated));
}
