"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const workspaces_1 = require("@/lib/workspaces");
const logger_1 = require("@/lib/logger");
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const tenantId = (_a = auth.user.tenant_id) !== null && _a !== void 0 ? _a : 1;
        const workspaces = (0, workspaces_1.listWorkspacesForTenant)(db, tenantId);
        return server_1.NextResponse.json({
            workspaces,
            active_workspace_id: auth.user.workspace_id,
            tenant_id: tenantId,
        });
    }
    catch (_b) {
        return server_1.NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 });
    }
}
/**
 * POST /api/workspaces - Create a new workspace
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const tenantId = (_a = auth.user.tenant_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { name, slug } = body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return server_1.NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }
        const resolvedSlug = (slug || name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        if (!resolvedSlug) {
            return server_1.NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
        }
        // Check uniqueness within the tenant.
        const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ? AND tenant_id = ?').get(resolvedSlug, tenantId);
        if (existing) {
            return server_1.NextResponse.json({ error: 'Workspace slug already exists' }, { status: 409 });
        }
        const now = Math.floor(Date.now() / 1000);
        const result = db.transaction(() => {
            const inserted = db.prepare('INSERT INTO workspaces (slug, name, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(resolvedSlug, name.trim(), tenantId, now, now);
            const workspaceId = Number(inserted.lastInsertRowid);
            db.prepare(`
        INSERT INTO tenant_memberships (
          user_id, tenant_id, workspace_id, role, status, is_default, invited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', 0, NULL, ?, ?)
        ON CONFLICT(user_id, workspace_id) DO UPDATE SET
          role = excluded.role,
          status = 'active',
          updated_at = excluded.updated_at
      `).run(auth.user.id, tenantId, workspaceId, auth.user.role, now, now);
            return workspaceId;
        })();
        const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?').get(result, tenantId);
        (0, db_1.logAuditEvent)({
            action: 'workspace_created',
            actor: auth.user.username,
            actor_id: auth.user.id,
            target_type: 'workspace',
            target_id: result,
            detail: { name: name.trim(), slug: resolvedSlug },
        });
        return server_1.NextResponse.json({ workspace }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/workspaces error');
        return server_1.NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
    }
}
