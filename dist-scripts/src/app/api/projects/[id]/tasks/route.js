"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const workspaces_1 = require("@/lib/workspaces");
function formatTicketRef(prefix, num) {
    if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0)
        return undefined;
    return `${prefix}-${String(num).padStart(3, '0')}`;
}
async function GET(request, { params }) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const tenantId = (_b = auth.user.tenant_id) !== null && _b !== void 0 ? _b : 1;
        const forwardedFor = ((_c = (request.headers.get('x-forwarded-for') || '').split(',')[0]) === null || _c === void 0 ? void 0 : _c.trim()) || null;
        (0, workspaces_1.ensureTenantWorkspaceAccess)(db, tenantId, workspaceId, {
            actor: auth.user.username,
            actorId: auth.user.id,
            route: '/api/projects/[id]/tasks',
            ipAddress: forwardedFor,
            userAgent: request.headers.get('user-agent'),
        });
        const { id } = await params;
        const projectId = Number.parseInt(id, 10);
        if (!Number.isFinite(projectId)) {
            return server_1.NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
        }
        const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId);
        if (!projectScope)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, created_at, updated_at
      FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId);
        if (!project)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const tasks = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ? AND t.project_id = ?
      ORDER BY t.created_at DESC
    `).all(workspaceId, projectId);
        return server_1.NextResponse.json({
            project,
            tasks: tasks.map((task) => (Object.assign(Object.assign({}, task), { tags: task.tags ? JSON.parse(task.tags) : [], metadata: task.metadata ? JSON.parse(task.metadata) : {}, ticket_ref: formatTicketRef(task.project_prefix, task.project_ticket_no) })))
        });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'GET /api/projects/[id]/tasks error');
        return server_1.NextResponse.json({ error: 'Failed to fetch project tasks' }, { status: 500 });
    }
}
