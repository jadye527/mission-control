"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const command_1 = require("@/lib/command");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
async function POST(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const resolvedParams = await params;
        const taskId = parseInt(resolvedParams.id);
        const body = await request.json();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const author = auth.user.display_name || auth.user.username || 'system';
        const message = (body.message || '').trim();
        if (isNaN(taskId)) {
            return server_1.NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
        }
        if (!message) {
            return server_1.NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }
        const db = (0, db_1.getDatabase)();
        const task = db
            .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        const subscribers = new Set(db_1.db_helpers.getTaskSubscribers(taskId, workspaceId));
        subscribers.delete(author);
        if (subscribers.size === 0) {
            return server_1.NextResponse.json({ sent: 0, skipped: 0 });
        }
        const agents = db
            .prepare('SELECT name, session_key FROM agents WHERE workspace_id = ? AND name IN (' + Array.from(subscribers).map(() => '?').join(',') + ')')
            .all(workspaceId, ...Array.from(subscribers));
        const results = await Promise.allSettled(agents.map(async (agent) => {
            if (!agent.session_key)
                return 'skipped';
            await (0, command_1.runOpenClaw)([
                'gateway',
                'sessions_send',
                '--session',
                agent.session_key,
                '--message',
                `[Task ${task.id}] ${task.title}\nFrom ${author}: ${message}`
            ], { timeoutMs: 10000 });
            db_1.db_helpers.createNotification(agent.name, 'message', 'Task Broadcast', `${author} broadcasted a message on "${task.title}": ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`, 'task', taskId, workspaceId);
            return 'sent';
        }));
        let sent = 0;
        let skipped = 0;
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value === 'sent')
                sent++;
            else
                skipped++;
        }
        db_1.db_helpers.logActivity('task_broadcast', 'task', taskId, author, `Broadcasted message to ${sent} subscribers`, { sent, skipped }, workspaceId);
        return server_1.NextResponse.json({ sent, skipped });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/tasks/[id]/broadcast error');
        return server_1.NextResponse.json({ error: 'Failed to broadcast message' }, { status: 500 });
    }
}
