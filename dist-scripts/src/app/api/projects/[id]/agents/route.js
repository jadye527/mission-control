"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const workspaces_1 = require("@/lib/workspaces");
function toProjectId(raw) {
    const id = Number.parseInt(raw, 10);
    return Number.isFinite(id) ? id : NaN;
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
            route: '/api/projects/[id]/agents',
            ipAddress: forwardedFor,
            userAgent: request.headers.get('user-agent'),
        });
        const { id } = await params;
        const projectId = toProjectId(id);
        if (Number.isNaN(projectId))
            return server_1.NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
        const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId);
        if (!projectScope)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        // Verify project belongs to workspace
        const project = db.prepare(`SELECT id FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId);
        if (!project)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const assignments = db.prepare(`
      SELECT id, project_id, agent_name, role, assigned_at
      FROM project_agent_assignments
      WHERE project_id = ?
      ORDER BY assigned_at ASC
    `).all(projectId);
        return server_1.NextResponse.json({ assignments });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'GET /api/projects/[id]/agents error');
        return server_1.NextResponse.json({ error: 'Failed to fetch agent assignments' }, { status: 500 });
    }
}
async function POST(request, { params }) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const tenantId = (_b = auth.user.tenant_id) !== null && _b !== void 0 ? _b : 1;
        const forwardedFor = ((_c = (request.headers.get('x-forwarded-for') || '').split(',')[0]) === null || _c === void 0 ? void 0 : _c.trim()) || null;
        (0, workspaces_1.ensureTenantWorkspaceAccess)(db, tenantId, workspaceId, {
            actor: auth.user.username,
            actorId: auth.user.id,
            route: '/api/projects/[id]/agents',
            ipAddress: forwardedFor,
            userAgent: request.headers.get('user-agent'),
        });
        const { id } = await params;
        const projectId = toProjectId(id);
        if (Number.isNaN(projectId))
            return server_1.NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
        const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId);
        if (!projectScope)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const project = db.prepare(`SELECT id FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId);
        if (!project)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const body = await request.json();
        const agentName = String((body === null || body === void 0 ? void 0 : body.agent_name) || '').trim();
        const role = String((body === null || body === void 0 ? void 0 : body.role) || 'member').trim();
        if (!agentName)
            return server_1.NextResponse.json({ error: 'agent_name is required' }, { status: 400 });
        db.prepare(`
      INSERT OR IGNORE INTO project_agent_assignments (project_id, agent_name, role)
      VALUES (?, ?, ?)
    `).run(projectId, agentName, role);
        return server_1.NextResponse.json({ success: true }, { status: 201 });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'POST /api/projects/[id]/agents error');
        return server_1.NextResponse.json({ error: 'Failed to assign agent' }, { status: 500 });
    }
}
async function DELETE(request, { params }) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const tenantId = (_b = auth.user.tenant_id) !== null && _b !== void 0 ? _b : 1;
        const forwardedFor = ((_c = (request.headers.get('x-forwarded-for') || '').split(',')[0]) === null || _c === void 0 ? void 0 : _c.trim()) || null;
        (0, workspaces_1.ensureTenantWorkspaceAccess)(db, tenantId, workspaceId, {
            actor: auth.user.username,
            actorId: auth.user.id,
            route: '/api/projects/[id]/agents',
            ipAddress: forwardedFor,
            userAgent: request.headers.get('user-agent'),
        });
        const { id } = await params;
        const projectId = toProjectId(id);
        if (Number.isNaN(projectId))
            return server_1.NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
        const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId);
        if (!projectScope)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const project = db.prepare(`SELECT id FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId);
        if (!project)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const agentName = new URL(request.url).searchParams.get('agent_name');
        if (!agentName)
            return server_1.NextResponse.json({ error: 'agent_name query parameter is required' }, { status: 400 });
        db.prepare(`
      DELETE FROM project_agent_assignments
      WHERE project_id = ? AND agent_name = ?
    `).run(projectId, agentName);
        return server_1.NextResponse.json({ success: true });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'DELETE /api/projects/[id]/agents error');
        return server_1.NextResponse.json({ error: 'Failed to unassign agent' }, { status: 500 });
    }
}
