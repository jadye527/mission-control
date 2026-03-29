"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/workspaces/[id] - Get a single workspace
 */
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const tenantId = (_a = auth.user.tenant_id) !== null && _a !== void 0 ? _a : 1;
        const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?').get(Number(id), tenantId);
        if (!workspace) {
            return server_1.NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
        }
        // Include agent count
        const stats = db.prepare('SELECT COUNT(*) as agent_count FROM agents WHERE workspace_id = ?').get(Number(id));
        return server_1.NextResponse.json({
            workspace: Object.assign(Object.assign({}, workspace), { agent_count: stats.agent_count }),
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/workspaces/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 });
    }
}
/**
 * PUT /api/workspaces/[id] - Update workspace name
 */
async function PUT(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const tenantId = (_a = auth.user.tenant_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { name } = body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return server_1.NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }
        const existing = db.prepare('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?').get(Number(id), tenantId);
        if (!existing) {
            return server_1.NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
        }
        // Don't allow renaming the default workspace slug
        const now = Math.floor(Date.now() / 1000);
        db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(name.trim(), now, Number(id), tenantId);
        (0, db_1.logAuditEvent)({
            action: 'workspace_updated',
            actor: auth.user.username,
            actor_id: auth.user.id,
            target_type: 'workspace',
            target_id: Number(id),
            detail: { old_name: existing.name, new_name: name.trim() },
        });
        const updated = db.prepare('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?').get(Number(id), tenantId);
        return server_1.NextResponse.json({ workspace: updated });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/workspaces/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
    }
}
/**
 * DELETE /api/workspaces/[id] - Delete a workspace (moves agents to default workspace)
 */
async function DELETE(request, { params }) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const tenantId = (_a = auth.user.tenant_id) !== null && _a !== void 0 ? _a : 1;
        const workspaceId = Number(id);
        const existing = db.prepare('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?').get(workspaceId, tenantId);
        if (!existing) {
            return server_1.NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
        }
        if (existing.slug === 'default') {
            return server_1.NextResponse.json({ error: 'Cannot delete the default workspace' }, { status: 400 });
        }
        // Find default workspace to reassign agents
        const defaultWs = db.prepare("SELECT id FROM workspaces WHERE slug = 'default' AND tenant_id = ? LIMIT 1").get(tenantId);
        const fallbackId = (_b = defaultWs === null || defaultWs === void 0 ? void 0 : defaultWs.id) !== null && _b !== void 0 ? _b : 1;
        const now = Math.floor(Date.now() / 1000);
        db.transaction(() => {
            // Reassign agents to default workspace
            const moved = db.prepare('UPDATE agents SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?').run(fallbackId, now, workspaceId);
            // Reassign users to default workspace
            db.prepare('UPDATE users SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?').run(fallbackId, now, workspaceId);
            // Reassign projects to default workspace
            db.prepare('UPDATE projects SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?').run(fallbackId, now, workspaceId);
            // Preserve tenant access continuity for sessions, API keys, invites, and memberships.
            db.prepare('UPDATE user_sessions SET workspace_id = ?, tenant_id = ? WHERE workspace_id = ?').run(fallbackId, tenantId, workspaceId);
            db.prepare('UPDATE api_keys SET workspace_id = ?, tenant_id = ?, updated_at = ? WHERE workspace_id = ?').run(fallbackId, tenantId, now, workspaceId);
            db.prepare('UPDATE auth_invites SET workspace_id = ?, updated_at = ? WHERE workspace_id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(fallbackId, now, workspaceId, tenantId);
            db.prepare(`
        INSERT INTO tenant_memberships (
          user_id, tenant_id, workspace_id, role, status, is_default, invited_by, created_at, updated_at
        )
        SELECT tm.user_id, tm.tenant_id, ?, tm.role, tm.status, 0, tm.invited_by, tm.created_at, ?
        FROM tenant_memberships tm
        WHERE tm.workspace_id = ? AND tm.tenant_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM tenant_memberships existing
            WHERE existing.user_id = tm.user_id
              AND existing.workspace_id = ?
          )
      `).run(fallbackId, now, workspaceId, tenantId, fallbackId);
            db.prepare(`
        UPDATE tenant_memberships
        SET is_default = CASE WHEN workspace_id = ? THEN 1 ELSE 0 END,
            updated_at = ?
        WHERE tenant_id = ?
          AND user_id IN (
            SELECT user_id
            FROM tenant_memberships
            WHERE workspace_id = ? AND tenant_id = ? AND is_default = 1
          )
      `).run(fallbackId, now, tenantId, workspaceId, tenantId);
            db.prepare('DELETE FROM tenant_memberships WHERE workspace_id = ? AND tenant_id = ?').run(workspaceId, tenantId);
            // Delete workspace
            db.prepare('DELETE FROM workspaces WHERE id = ? AND tenant_id = ?').run(workspaceId, tenantId);
            (0, db_1.logAuditEvent)({
                action: 'workspace_deleted',
                actor: auth.user.username,
                actor_id: auth.user.id,
                target_type: 'workspace',
                target_id: workspaceId,
                detail: {
                    name: existing.name,
                    slug: existing.slug,
                    agents_moved: moved.changes,
                    moved_to_workspace: fallbackId,
                },
            });
        })();
        return server_1.NextResponse.json({
            success: true,
            deleted: existing.name,
            agents_moved_to: fallbackId,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/workspaces/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
    }
}
