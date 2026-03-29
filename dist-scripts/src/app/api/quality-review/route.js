"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const event_bus_1 = require("@/lib/event-bus");
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const taskIdsParam = searchParams.get('taskIds');
        const taskId = parseInt(searchParams.get('taskId') || '');
        if (taskIdsParam) {
            const ids = taskIdsParam
                .split(',')
                .map((id) => parseInt(id.trim()))
                .filter((id) => !Number.isNaN(id));
            if (ids.length === 0) {
                return server_1.NextResponse.json({ error: 'taskIds must include at least one numeric id' }, { status: 400 });
            }
            const placeholders = ids.map(() => '?').join(',');
            const rows = db.prepare(`
        SELECT * FROM quality_reviews
        WHERE task_id IN (${placeholders}) AND workspace_id = ?
        ORDER BY task_id ASC, created_at DESC
      `).all(...ids, workspaceId);
            const byTask = {};
            for (const id of ids) {
                byTask[id] = null;
            }
            for (const row of rows) {
                const existing = byTask[row.task_id];
                if (!existing || (row.created_at || 0) > (existing.created_at || 0)) {
                    byTask[row.task_id] = { status: row.status, reviewer: row.reviewer, created_at: row.created_at };
                }
            }
            return server_1.NextResponse.json({ latest: byTask });
        }
        if (isNaN(taskId)) {
            return server_1.NextResponse.json({ error: 'taskId is required' }, { status: 400 });
        }
        const reviews = db.prepare(`
      SELECT * FROM quality_reviews
      WHERE task_id = ? AND workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(taskId, workspaceId);
        return server_1.NextResponse.json({ reviews });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/quality-review error');
        return server_1.NextResponse.json({ error: 'Failed to fetch quality reviews' }, { status: 500 });
    }
}
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const validated = await (0, validation_1.validateBody)(request, validation_1.qualityReviewSchema);
        if ('error' in validated)
            return validated.error;
        const { taskId, reviewer, status, notes } = validated.data;
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const task = db
            .prepare('SELECT id, title FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        const result = db.prepare(`
      INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, reviewer, status, notes, workspaceId);
        db_1.db_helpers.logActivity('quality_review', 'task', taskId, reviewer, `Quality review ${status} for task: ${task.title}`, { status, notes }, workspaceId);
        // Auto-advance task based on review outcome
        if (status === 'approved') {
            db.prepare('UPDATE tasks SET status = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
                .run('done', taskId, workspaceId);
            event_bus_1.eventBus.broadcast('task.status_changed', {
                id: taskId,
                status: 'done',
                previous_status: 'review',
                updated_at: Math.floor(Date.now() / 1000),
            });
        }
        else if (status === 'rejected') {
            // Rejected: push back to in_progress with the rejection notes as error_message
            db.prepare('UPDATE tasks SET status = ?, error_message = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
                .run('assigned', `Quality review rejected by ${reviewer}: ${notes}`, taskId, workspaceId);
            event_bus_1.eventBus.broadcast('task.status_changed', {
                id: taskId,
                status: 'assigned',
                previous_status: 'review',
                updated_at: Math.floor(Date.now() / 1000),
            });
        }
        return server_1.NextResponse.json({ success: true, id: result.lastInsertRowid });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/quality-review error');
        return server_1.NextResponse.json({ error: 'Failed to create quality review' }, { status: 500 });
    }
}
