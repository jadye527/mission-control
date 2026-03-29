"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PATCH = PATCH;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const workspaces_1 = require("@/lib/workspaces");
function normalizePrefix(input) {
    const normalized = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.slice(0, 12);
}
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
            route: '/api/projects/[id]',
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
        const row = db.prepare(`
      SELECT p.id, p.workspace_id, p.name, p.slug, p.description, p.ticket_prefix, p.ticket_counter, p.status,
             p.github_repo, p.deadline, p.color, p.github_sync_enabled, p.github_labels_initialized, p.github_default_branch, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
             (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) as assigned_agents_csv
      FROM projects p
      WHERE p.id = ? AND p.workspace_id = ?
    `).get(projectId, workspaceId);
        if (!row)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const project = Object.assign(Object.assign({}, row), { assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [], assigned_agents_csv: undefined });
        return server_1.NextResponse.json({ project });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'GET /api/projects/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
    }
}
async function PATCH(request, { params }) {
    var _a, _b, _c, _d;
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
            route: '/api/projects/[id]',
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
        const current = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId);
        if (!current)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        if (current.slug === 'general' && current.workspace_id === workspaceId && current.id === projectId) {
            const body = await request.json();
            if ((body === null || body === void 0 ? void 0 : body.status) === 'archived') {
                return server_1.NextResponse.json({ error: 'Default project cannot be archived' }, { status: 400 });
            }
        }
        const body = await request.json();
        const updates = [];
        const paramsList = [];
        if (typeof (body === null || body === void 0 ? void 0 : body.name) === 'string') {
            const name = body.name.trim();
            if (!name)
                return server_1.NextResponse.json({ error: 'Project name cannot be empty' }, { status: 400 });
            updates.push('name = ?');
            paramsList.push(name);
        }
        if (typeof (body === null || body === void 0 ? void 0 : body.description) === 'string') {
            updates.push('description = ?');
            paramsList.push(body.description.trim() || null);
        }
        if (typeof (body === null || body === void 0 ? void 0 : body.ticket_prefix) === 'string' || typeof (body === null || body === void 0 ? void 0 : body.ticketPrefix) === 'string') {
            const raw = String((_d = body.ticket_prefix) !== null && _d !== void 0 ? _d : body.ticketPrefix);
            const prefix = normalizePrefix(raw);
            if (!prefix)
                return server_1.NextResponse.json({ error: 'Invalid ticket prefix' }, { status: 400 });
            const conflict = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = ? AND ticket_prefix = ? AND id != ?
      `).get(workspaceId, prefix, projectId);
            if (conflict)
                return server_1.NextResponse.json({ error: 'Ticket prefix already in use' }, { status: 409 });
            updates.push('ticket_prefix = ?');
            paramsList.push(prefix);
        }
        if (typeof (body === null || body === void 0 ? void 0 : body.status) === 'string') {
            const status = body.status === 'archived' ? 'archived' : 'active';
            updates.push('status = ?');
            paramsList.push(status);
        }
        if ((body === null || body === void 0 ? void 0 : body.github_repo) !== undefined) {
            updates.push('github_repo = ?');
            paramsList.push(typeof body.github_repo === 'string' ? body.github_repo.trim() || null : null);
        }
        if ((body === null || body === void 0 ? void 0 : body.deadline) !== undefined) {
            updates.push('deadline = ?');
            paramsList.push(typeof body.deadline === 'number' ? body.deadline : null);
        }
        if ((body === null || body === void 0 ? void 0 : body.color) !== undefined) {
            updates.push('color = ?');
            paramsList.push(typeof body.color === 'string' ? body.color.trim() || null : null);
        }
        if ((body === null || body === void 0 ? void 0 : body.github_sync_enabled) !== undefined) {
            updates.push('github_sync_enabled = ?');
            paramsList.push(body.github_sync_enabled ? 1 : 0);
        }
        if ((body === null || body === void 0 ? void 0 : body.github_default_branch) !== undefined) {
            updates.push('github_default_branch = ?');
            paramsList.push(typeof body.github_default_branch === 'string' ? body.github_default_branch.trim() || 'main' : 'main');
        }
        if ((body === null || body === void 0 ? void 0 : body.github_labels_initialized) !== undefined) {
            updates.push('github_labels_initialized = ?');
            paramsList.push(body.github_labels_initialized ? 1 : 0);
        }
        if (updates.length === 0)
            return server_1.NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        updates.push('updated_at = unixepoch()');
        db.prepare(`
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = ? AND workspace_id = ?
    `).run(...paramsList, projectId, workspaceId);
        const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status,
             github_repo, deadline, color, github_sync_enabled, github_labels_initialized, github_default_branch, created_at, updated_at
      FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId);
        return server_1.NextResponse.json({ project });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'PATCH /api/projects/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }
}
async function DELETE(request, { params }) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'admin');
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
            route: '/api/projects/[id]',
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
        const current = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId);
        if (!current)
            return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
        if (current.slug === 'general') {
            return server_1.NextResponse.json({ error: 'Default project cannot be deleted' }, { status: 400 });
        }
        const mode = new URL(request.url).searchParams.get('mode') || 'archive';
        if (mode !== 'delete') {
            db.prepare(`UPDATE projects SET status = 'archived', updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`).run(projectId, workspaceId);
            return server_1.NextResponse.json({ success: true, mode: 'archive' });
        }
        const fallback = db.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = ? AND slug = 'general'
      LIMIT 1
    `).get(workspaceId);
        if (!fallback)
            return server_1.NextResponse.json({ error: 'Default project missing' }, { status: 500 });
        const tx = db.transaction(() => {
            db.prepare(`
        UPDATE tasks
        SET project_id = ?
        WHERE workspace_id = ? AND project_id = ?
      `).run(fallback.id, workspaceId, projectId);
            db.prepare(`DELETE FROM projects WHERE id = ? AND workspace_id = ?`).run(projectId, workspaceId);
        });
        tx();
        return server_1.NextResponse.json({ success: true, mode: 'delete' });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'DELETE /api/projects/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
    }
}
