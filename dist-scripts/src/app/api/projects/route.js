"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const workspaces_1 = require("@/lib/workspaces");
function slugify(input) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}
function normalizePrefix(input) {
    const normalized = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.slice(0, 12);
}
async function GET(request) {
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
            route: '/api/projects',
            ipAddress: forwardedFor,
            userAgent: request.headers.get('user-agent'),
        });
        const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';
        const rows = db.prepare(`
      SELECT p.id, p.workspace_id, p.name, p.slug, p.description, p.ticket_prefix, p.ticket_counter, p.status,
             p.github_repo, p.deadline, p.color, p.github_sync_enabled, p.github_labels_initialized, p.github_default_branch, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
             (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) as assigned_agents_csv
      FROM projects p
      WHERE p.workspace_id = ?
        ${includeArchived ? '' : "AND p.status = 'active'"}
      ORDER BY p.name COLLATE NOCASE ASC
    `).all(workspaceId);
        const projects = rows.map(row => (Object.assign(Object.assign({}, row), { assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [], assigned_agents_csv: undefined })));
        return server_1.NextResponse.json({ projects });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'GET /api/projects error');
        return server_1.NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }
}
async function POST(request) {
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
            route: '/api/projects',
            ipAddress: forwardedFor,
            userAgent: request.headers.get('user-agent'),
        });
        const body = await request.json();
        const name = String((body === null || body === void 0 ? void 0 : body.name) || '').trim();
        const description = typeof (body === null || body === void 0 ? void 0 : body.description) === 'string' ? body.description.trim() : '';
        const prefixInput = String((body === null || body === void 0 ? void 0 : body.ticket_prefix) || (body === null || body === void 0 ? void 0 : body.ticketPrefix) || '').trim();
        const slugInput = String((body === null || body === void 0 ? void 0 : body.slug) || '').trim();
        const githubRepo = typeof (body === null || body === void 0 ? void 0 : body.github_repo) === 'string' ? body.github_repo.trim() || null : null;
        const deadline = typeof (body === null || body === void 0 ? void 0 : body.deadline) === 'number' ? body.deadline : null;
        const color = typeof (body === null || body === void 0 ? void 0 : body.color) === 'string' ? body.color.trim() || null : null;
        if (!name)
            return server_1.NextResponse.json({ error: 'Project name is required' }, { status: 400 });
        const slug = slugInput ? slugify(slugInput) : slugify(name);
        const ticketPrefix = normalizePrefix(prefixInput || name.slice(0, 5));
        if (!slug)
            return server_1.NextResponse.json({ error: 'Invalid project slug' }, { status: 400 });
        if (!ticketPrefix)
            return server_1.NextResponse.json({ error: 'Invalid ticket prefix' }, { status: 400 });
        const exists = db.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = ? AND (slug = ? OR ticket_prefix = ?)
      LIMIT 1
    `).get(workspaceId, slug, ticketPrefix);
        if (exists) {
            return server_1.NextResponse.json({ error: 'Project slug or ticket prefix already exists' }, { status: 409 });
        }
        const result = db.prepare(`
      INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, github_repo, deadline, color, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).run(workspaceId, name, slug, description || null, ticketPrefix, githubRepo, deadline, color);
        const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status,
             github_repo, deadline, color, github_sync_enabled, github_labels_initialized, github_default_branch, created_at, updated_at
      FROM projects
      WHERE id = ?
    `).get(Number(result.lastInsertRowid));
        return server_1.NextResponse.json({ project }, { status: 201 });
    }
    catch (error) {
        if (error instanceof workspaces_1.ForbiddenError) {
            return server_1.NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger_1.logger.error({ err: error }, 'POST /api/projects error');
        return server_1.NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }
}
