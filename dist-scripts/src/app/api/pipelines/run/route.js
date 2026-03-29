"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const event_bus_1 = require("@/lib/event-bus");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/pipelines/run - Get pipeline runs
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const pipelineId = searchParams.get('pipeline_id');
        const runId = searchParams.get('id');
        const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 200);
        if (runId) {
            const run = db
                .prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?')
                .get(parseInt(runId), workspaceId);
            if (!run)
                return server_1.NextResponse.json({ error: 'Run not found' }, { status: 404 });
            return server_1.NextResponse.json({ run: Object.assign(Object.assign({}, run), { steps_snapshot: JSON.parse(run.steps_snapshot) }) });
        }
        let query = 'SELECT * FROM pipeline_runs WHERE workspace_id = ?';
        const params = [workspaceId];
        if (pipelineId) {
            query += ' AND pipeline_id = ?';
            params.push(parseInt(pipelineId));
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const runs = db.prepare(query).all(...params);
        // Enrich with pipeline names
        const pipelineIds = [...new Set(runs.map(r => r.pipeline_id))];
        const pipelines = pipelineIds.length > 0
            ? db.prepare(`SELECT id, name FROM workflow_pipelines WHERE workspace_id = ? AND id IN (${pipelineIds.map(() => '?').join(',')})`).all(workspaceId, ...pipelineIds)
            : [];
        const nameMap = new Map(pipelines.map(p => [p.id, p.name]));
        const parsed = runs.map(r => (Object.assign(Object.assign({}, r), { pipeline_name: nameMap.get(r.pipeline_id) || 'Deleted Pipeline', steps_snapshot: JSON.parse(r.steps_snapshot) })));
        return server_1.NextResponse.json({ runs: parsed });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/pipelines/run error');
        return server_1.NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
    }
}
/**
 * POST /api/pipelines/run - Start a pipeline run or advance a running one
 */
async function POST(request) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { action, pipeline_id, run_id } = body;
        if (action === 'start') {
            return startPipeline(db, pipeline_id, ((_b = auth.user) === null || _b === void 0 ? void 0 : _b.username) || 'system', workspaceId);
        }
        else if (action === 'advance') {
            return advanceRun(db, run_id, (_c = body.success) !== null && _c !== void 0 ? _c : true, body.error, workspaceId);
        }
        else if (action === 'cancel') {
            return cancelRun(db, run_id, workspaceId);
        }
        return server_1.NextResponse.json({ error: 'Invalid action. Use: start, advance, cancel' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/pipelines/run error');
        return server_1.NextResponse.json({ error: 'Failed to process pipeline run' }, { status: 500 });
    }
}
/** Spawn a single pipeline step using `openclaw agent` */
async function spawnStep(db, pipelineName, template, steps, stepIdx, runId, workspaceId) {
    try {
        const { runOpenClaw } = await Promise.resolve().then(() => __importStar(require('@/lib/command')));
        const args = [
            'agent',
            '--message', `[Pipeline: ${pipelineName} | Step ${stepIdx + 1}] ${template.task_prompt}`,
            '--timeout', String(template.timeout_seconds),
            '--json',
        ];
        const { stdout } = await runOpenClaw(args, { timeoutMs: 15000 });
        const spawnId = `pipeline-${runId}-step-${stepIdx}-${Date.now()}`;
        steps[stepIdx].spawn_id = spawnId;
        db.prepare('UPDATE pipeline_runs SET steps_snapshot = ? WHERE id = ? AND workspace_id = ?').run(JSON.stringify(steps), runId, workspaceId);
        return { success: true, stdout: stdout.trim() };
    }
    catch (err) {
        // Spawn failed - record error but keep pipeline running for manual advance
        steps[stepIdx].error = err.message;
        db.prepare('UPDATE pipeline_runs SET steps_snapshot = ? WHERE id = ? AND workspace_id = ?').run(JSON.stringify(steps), runId, workspaceId);
        return { success: false, error: err.message };
    }
}
async function startPipeline(db, pipelineId, triggeredBy, workspaceId) {
    const pipeline = db.prepare('SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?').get(pipelineId, workspaceId);
    if (!pipeline)
        return server_1.NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    const steps = JSON.parse(pipeline.steps || '[]');
    if (steps.length === 0)
        return server_1.NextResponse.json({ error: 'Pipeline has no steps' }, { status: 400 });
    // Get template names for snapshot
    const templateIds = steps.map(s => s.template_id);
    const templates = db.prepare(`SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`).all(...templateIds);
    const templateMap = new Map(templates.map(t => [t.id, t]));
    // Build step snapshot
    const stepsSnapshot = steps.map((s, i) => {
        var _a;
        return ({
            step_index: i,
            template_id: s.template_id,
            template_name: ((_a = templateMap.get(s.template_id)) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown',
            on_failure: s.on_failure,
            status: i === 0 ? 'running' : 'pending',
            spawn_id: null,
            started_at: i === 0 ? Math.floor(Date.now() / 1000) : null,
            completed_at: null,
            error: null,
        });
    });
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
    INSERT INTO pipeline_runs (pipeline_id, status, current_step, steps_snapshot, started_at, triggered_by, workspace_id)
    VALUES (?, 'running', 0, ?, ?, ?, ?)
  `).run(pipelineId, JSON.stringify(stepsSnapshot), now, triggeredBy, workspaceId);
    const runId = Number(result.lastInsertRowid);
    // Update pipeline usage
    db.prepare(`
    UPDATE workflow_pipelines SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?
  `).run(now, now, pipelineId, workspaceId);
    // Spawn first step
    const firstTemplate = templateMap.get(steps[0].template_id);
    let spawnResult = null;
    if (firstTemplate) {
        spawnResult = await spawnStep(db, pipeline.name, firstTemplate, stepsSnapshot, 0, runId, workspaceId);
    }
    db_1.db_helpers.logActivity('pipeline_started', 'pipeline', pipelineId, triggeredBy, `Started pipeline: ${pipeline.name}`, { run_id: runId }, workspaceId);
    event_bus_1.eventBus.broadcast('activity.created', {
        type: 'pipeline_started',
        entity_type: 'pipeline',
        entity_id: pipelineId,
        description: `Pipeline "${pipeline.name}" started`,
        data: { run_id: runId },
    });
    return server_1.NextResponse.json({
        run: {
            id: runId,
            pipeline_id: pipelineId,
            status: stepsSnapshot[0].status === 'failed' ? 'failed' : 'running',
            current_step: 0,
            steps_snapshot: stepsSnapshot,
            spawn: spawnResult,
        }
    }, { status: 201 });
}
async function advanceRun(db, runId, success, errorMsg, workspaceId) {
    if (!runId)
        return server_1.NextResponse.json({ error: 'run_id required' }, { status: 400 });
    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId);
    if (!run)
        return server_1.NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (run.status !== 'running')
        return server_1.NextResponse.json({ error: `Run is ${run.status}, not running` }, { status: 400 });
    const steps = JSON.parse(run.steps_snapshot);
    const currentIdx = run.current_step;
    const now = Math.floor(Date.now() / 1000);
    // Mark current step as completed/failed
    steps[currentIdx].status = success ? 'completed' : 'failed';
    steps[currentIdx].completed_at = now;
    if (errorMsg)
        steps[currentIdx].error = errorMsg;
    // Determine next action
    const nextIdx = currentIdx + 1;
    const onFailure = steps[currentIdx].on_failure || 'stop';
    if (!success && onFailure === 'stop') {
        // Mark remaining steps as skipped
        for (let i = nextIdx; i < steps.length; i++)
            steps[i].status = 'skipped';
        db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
            .run('failed', currentIdx, JSON.stringify(steps), now, runId, workspaceId);
        return server_1.NextResponse.json({ run: { id: runId, status: 'failed', steps_snapshot: steps } });
    }
    if (nextIdx >= steps.length) {
        // Pipeline complete
        const finalStatus = steps.some(s => s.status === 'failed') ? 'completed' : 'completed';
        db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
            .run(finalStatus, currentIdx, JSON.stringify(steps), now, runId, workspaceId);
        event_bus_1.eventBus.broadcast('activity.created', {
            type: 'pipeline_completed',
            entity_type: 'pipeline',
            entity_id: run.pipeline_id,
            description: `Pipeline run #${runId} completed`,
        });
        return server_1.NextResponse.json({ run: { id: runId, status: finalStatus, steps_snapshot: steps } });
    }
    // Spawn next step
    steps[nextIdx].status = 'running';
    steps[nextIdx].started_at = now;
    const template = db.prepare('SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id = ?')
        .get(steps[nextIdx].template_id);
    let spawnResult = null;
    if (template) {
        const pipeline = db.prepare('SELECT name FROM workflow_pipelines WHERE id = ? AND workspace_id = ?').get(run.pipeline_id, workspaceId);
        spawnResult = await spawnStep(db, (pipeline === null || pipeline === void 0 ? void 0 : pipeline.name) || '?', template, steps, nextIdx, runId, workspaceId);
    }
    db.prepare('UPDATE pipeline_runs SET current_step = ?, steps_snapshot = ? WHERE id = ? AND workspace_id = ?')
        .run(nextIdx, JSON.stringify(steps), runId, workspaceId);
    return server_1.NextResponse.json({
        run: { id: runId, status: 'running', current_step: nextIdx, steps_snapshot: steps, spawn: spawnResult }
    });
}
function cancelRun(db, runId, workspaceId) {
    if (!runId)
        return server_1.NextResponse.json({ error: 'run_id required' }, { status: 400 });
    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId);
    if (!run)
        return server_1.NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (run.status !== 'running' && run.status !== 'pending') {
        return server_1.NextResponse.json({ error: `Run is ${run.status}, cannot cancel` }, { status: 400 });
    }
    const steps = JSON.parse(run.steps_snapshot);
    const now = Math.floor(Date.now() / 1000);
    for (const step of steps) {
        if (step.status === 'pending' || step.status === 'running') {
            step.status = 'skipped';
            step.completed_at = now;
        }
    }
    db.prepare('UPDATE pipeline_runs SET status = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
        .run('cancelled', JSON.stringify(steps), now, runId, workspaceId);
    return server_1.NextResponse.json({ run: { id: runId, status: 'cancelled', steps_snapshot: steps } });
}
