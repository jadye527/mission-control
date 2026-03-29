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
/**
 * GET /api/pipelines - List all pipelines with enriched step data
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const pipelines = db.prepare('SELECT * FROM workflow_pipelines WHERE workspace_id = ? ORDER BY use_count DESC, updated_at DESC').all(workspaceId);
        // Enrich steps with template names
        const templates = db.prepare('SELECT id, name FROM workflow_templates').all();
        const nameMap = new Map(templates.map(t => [t.id, t.name]));
        // Get run counts per pipeline
        const runCounts = db.prepare(`
      SELECT pipeline_id, COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
      FROM pipeline_runs WHERE workspace_id = ? GROUP BY pipeline_id
    `).all(workspaceId);
        const runMap = new Map(runCounts.map(r => [r.pipeline_id, r]));
        const parsed = pipelines.map(p => {
            const steps = JSON.parse(p.steps || '[]');
            return Object.assign(Object.assign({}, p), { steps: steps.map(s => (Object.assign(Object.assign({}, s), { template_name: nameMap.get(s.template_id) || 'Unknown' }))), runs: runMap.get(p.id) || { total: 0, completed: 0, failed: 0, running: 0 } });
        });
        return server_1.NextResponse.json({ pipelines: parsed });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/pipelines error');
        return server_1.NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 });
    }
}
/**
 * POST /api/pipelines - Create a pipeline
 */
async function POST(request) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const result = await (0, validation_1.validateBody)(request, validation_1.createPipelineSchema);
        if ('error' in result)
            return result.error;
        const { name, description, steps } = result.data;
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Validate template IDs exist
        const templateIds = steps.map((s) => s.template_id);
        const existing = db.prepare(`SELECT id FROM workflow_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`).all(...templateIds);
        if (existing.length !== new Set(templateIds).size) {
            return server_1.NextResponse.json({ error: 'One or more template IDs not found' }, { status: 400 });
        }
        const cleanSteps = steps.map((s) => ({
            template_id: s.template_id,
            on_failure: s.on_failure || 'stop',
        }));
        const insertResult = db.prepare(`
      INSERT INTO workflow_pipelines (name, description, steps, created_by, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description || null, JSON.stringify(cleanSteps), ((_b = auth.user) === null || _b === void 0 ? void 0 : _b.username) || 'system', workspaceId);
        db_1.db_helpers.logActivity('pipeline_created', 'pipeline', Number(insertResult.lastInsertRowid), ((_c = auth.user) === null || _c === void 0 ? void 0 : _c.username) || 'system', `Created pipeline: ${name}`, undefined, workspaceId);
        const pipeline = db
            .prepare('SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?')
            .get(insertResult.lastInsertRowid, workspaceId);
        return server_1.NextResponse.json({ pipeline: Object.assign(Object.assign({}, pipeline), { steps: JSON.parse(pipeline.steps) }) }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/pipelines error');
        return server_1.NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 });
    }
}
/**
 * PUT /api/pipelines - Update a pipeline
 */
async function PUT(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { id } = body, updates = __rest(body, ["id"]);
        if (!id)
            return server_1.NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
        const existing = db
            .prepare('SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?')
            .get(id, workspaceId);
        if (!existing)
            return server_1.NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
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
        if (updates.steps !== undefined) {
            fields.push('steps = ?');
            params.push(JSON.stringify(updates.steps));
        }
        if (fields.length === 0) {
            // Usage tracking
            fields.push('use_count = use_count + 1', 'last_used_at = ?');
            params.push(Math.floor(Date.now() / 1000));
        }
        fields.push('updated_at = ?');
        params.push(Math.floor(Date.now() / 1000));
        params.push(id, workspaceId);
        db.prepare(`UPDATE workflow_pipelines SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...params);
        const updated = db
            .prepare('SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?')
            .get(id, workspaceId);
        return server_1.NextResponse.json({ pipeline: Object.assign(Object.assign({}, updated), { steps: JSON.parse(updated.steps) }) });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/pipelines error');
        return server_1.NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 });
    }
}
/**
 * DELETE /api/pipelines - Delete a pipeline
 */
async function DELETE(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
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
        if (!id)
            return server_1.NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
        db.prepare('DELETE FROM workflow_pipelines WHERE id = ? AND workspace_id = ?').run(parseInt(id), workspaceId);
        return server_1.NextResponse.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/pipelines error');
        return server_1.NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 });
    }
}
