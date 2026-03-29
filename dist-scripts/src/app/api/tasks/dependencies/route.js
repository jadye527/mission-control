"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
// GET: list dependencies for a task, or all unresolved blockers
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const taskId = searchParams.get('task_id');
        if (taskId) {
            // Get dependencies for a specific task
            const deps = db.prepare(`
        SELECT td.id, td.task_id, td.depends_on_task_id, td.created_at,
               t.title as blocker_title, t.status as blocker_status
        FROM task_dependencies td
        JOIN tasks t ON t.id = td.depends_on_task_id
        WHERE td.task_id = ?
      `).all(Number(taskId));
            const resolved = deps.every((d) => d.blocker_status === 'done');
            return server_1.NextResponse.json({ dependencies: deps, resolved, task_id: Number(taskId) });
        }
        // Get all tasks with unresolved blockers
        const blocked = db.prepare(`
      SELECT td.task_id, t.title as task_title, t.status as task_status,
             td.depends_on_task_id, bt.title as blocker_title, bt.status as blocker_status
      FROM task_dependencies td
      JOIN tasks t ON t.id = td.task_id
      JOIN tasks bt ON bt.id = td.depends_on_task_id
      WHERE bt.status != 'done'
      ORDER BY td.task_id
    `).all();
        return server_1.NextResponse.json({ blocked_tasks: blocked });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Task dependencies GET error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
// POST: add a dependency
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const body = await request.json();
        const { task_id, depends_on_task_id } = body;
        if (!task_id || !depends_on_task_id) {
            return server_1.NextResponse.json({ error: 'task_id and depends_on_task_id required' }, { status: 400 });
        }
        if (task_id === depends_on_task_id) {
            return server_1.NextResponse.json({ error: 'Task cannot depend on itself' }, { status: 400 });
        }
        // Verify both tasks exist
        const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(task_id);
        const blocker = db.prepare('SELECT id FROM tasks WHERE id = ?').get(depends_on_task_id);
        if (!task || !blocker) {
            return server_1.NextResponse.json({ error: 'One or both tasks not found' }, { status: 404 });
        }
        // Circular dependency check: does depends_on_task_id already depend on task_id?
        const circular = db.prepare(`
      WITH RECURSIVE chain(tid) AS (
        SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?
        UNION
        SELECT td.depends_on_task_id FROM task_dependencies td JOIN chain c ON td.task_id = c.tid
      )
      SELECT 1 FROM chain WHERE tid = ? LIMIT 1
    `).get(depends_on_task_id, task_id);
        if (circular) {
            return server_1.NextResponse.json({ error: 'Circular dependency detected' }, { status: 400 });
        }
        db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `).run(task_id, depends_on_task_id);
        return server_1.NextResponse.json({ ok: true, task_id, depends_on_task_id });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Task dependencies POST error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
// DELETE: remove a dependency
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const taskId = searchParams.get('task_id');
        const dependsOn = searchParams.get('depends_on_task_id');
        if (id) {
            db.prepare('DELETE FROM task_dependencies WHERE id = ?').run(Number(id));
        }
        else if (taskId && dependsOn) {
            db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?')
                .run(Number(taskId), Number(dependsOn));
        }
        else {
            return server_1.NextResponse.json({ error: 'id or task_id+depends_on_task_id required' }, { status: 400 });
        }
        return server_1.NextResponse.json({ ok: true });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Task dependencies DELETE error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
