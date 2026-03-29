"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const injection_guard_1 = require("@/lib/injection-guard");
/**
 * GET /api/workflows - List all workflow templates
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const templates = db
            .prepare('SELECT * FROM workflow_templates WHERE workspace_id = ? ORDER BY use_count DESC, updated_at DESC')
            .all(workspaceId);
        const parsed = templates.map(t => (Object.assign(Object.assign({}, t), { tags: t.tags ? JSON.parse(t.tags) : [] })));
        return server_1.NextResponse.json({ templates: parsed });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/workflows error');
        return server_1.NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }
}
/**
 * POST /api/workflows - Create a new workflow template
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const result = await (0, validation_1.validateBody)(request, validation_1.createWorkflowSchema);
        if ('error' in result)
            return result.error;
        const { name, description, model, task_prompt, timeout_seconds, agent_role, tags } = result.data;
        // Scan task_prompt for injection — this gets sent directly to AI agents
        const injectionReport = (0, injection_guard_1.scanForInjection)(task_prompt, { context: 'prompt' });
        if (!injectionReport.safe) {
            const criticals = injectionReport.matches.filter(m => m.severity === 'critical');
            if (criticals.length > 0) {
                logger_1.logger.warn({ name, rules: criticals.map(m => m.rule) }, 'Blocked workflow: injection detected in task_prompt');
                return server_1.NextResponse.json({ error: 'Task prompt blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) }, { status: 422 });
            }
        }
        const db = (0, db_1.getDatabase)();
        const user = auth.user;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const insertResult = db.prepare(`
      INSERT INTO workflow_templates (name, description, model, task_prompt, timeout_seconds, agent_role, tags, created_by, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || null, model, task_prompt, timeout_seconds, agent_role || null, JSON.stringify(tags), (user === null || user === void 0 ? void 0 : user.username) || 'system', workspaceId);
        const template = db
            .prepare('SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?')
            .get(insertResult.lastInsertRowid, workspaceId);
        db_1.db_helpers.logActivity('workflow_created', 'workflow', Number(insertResult.lastInsertRowid), (user === null || user === void 0 ? void 0 : user.username) || 'system', `Created workflow template: ${name}`, undefined, workspaceId);
        return server_1.NextResponse.json({
            template: Object.assign(Object.assign({}, template), { tags: template.tags ? JSON.parse(template.tags) : [] })
        }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/workflows error');
        return server_1.NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}
/**
 * PUT /api/workflows - Update a workflow template
 */
async function PUT(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { id } = body, updates = __rest(body, ["id"]);
        if (!id) {
            return server_1.NextResponse.json({ error: 'Template ID is required' }, { status: 400 });
        }
        const existing = db
            .prepare('SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?')
            .get(id, workspaceId);
        if (!existing) {
            return server_1.NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        const fields = [];
        const params = [];
        if (updates.name !== undefined) {
            fields.push('name = ?');
            params.push(updates.name);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            params.push(updates.description);
        }
        if (updates.model !== undefined) {
            fields.push('model = ?');
            params.push(updates.model);
        }
        if (updates.task_prompt !== undefined) {
            fields.push('task_prompt = ?');
            params.push(updates.task_prompt);
        }
        if (updates.timeout_seconds !== undefined) {
            fields.push('timeout_seconds = ?');
            params.push(updates.timeout_seconds);
        }
        if (updates.agent_role !== undefined) {
            fields.push('agent_role = ?');
            params.push(updates.agent_role);
        }
        if (updates.tags !== undefined) {
            fields.push('tags = ?');
            params.push(JSON.stringify(updates.tags));
        }
        // No explicit field updates = usage tracking call (from orchestration bar)
        if (fields.length === 0) {
            fields.push('use_count = use_count + 1');
            fields.push('last_used_at = ?');
            params.push(Math.floor(Date.now() / 1000));
        }
        fields.push('updated_at = ?');
        params.push(Math.floor(Date.now() / 1000));
        params.push(id, workspaceId);
        db.prepare(`UPDATE workflow_templates SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...params);
        const updated = db
            .prepare('SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?')
            .get(id, workspaceId);
        return server_1.NextResponse.json({ template: Object.assign(Object.assign({}, updated), { tags: updated.tags ? JSON.parse(updated.tags) : [] }) });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/workflows error');
        return server_1.NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
    }
}
/**
 * DELETE /api/workflows - Delete a workflow template
 */
async function DELETE(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        let body;
        try {
            body = await request.json();
        }
        catch (_b) {
            return server_1.NextResponse.json({ error: 'Request body required' }, { status: 400 });
        }
        const id = body.id;
        if (!id) {
            return server_1.NextResponse.json({ error: 'Template ID is required' }, { status: 400 });
        }
        const result = db.prepare('DELETE FROM workflow_templates WHERE id = ? AND workspace_id = ?').run(parseInt(id), workspaceId);
        if (result.changes === 0) {
            return server_1.NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        return server_1.NextResponse.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/workflows error');
        return server_1.NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
    }
}
