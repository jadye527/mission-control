"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
function safeParseJson(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch (_a) {
        return fallback;
    }
}
function mapTaskRow(task) {
    return Object.assign(Object.assign({}, task), { tags: safeParseJson(task.tags, []), metadata: safeParseJson(task.metadata, {}) });
}
function priorityRankSql() {
    return `
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
      ELSE 4
    END
  `;
}
/**
 * GET /api/tasks/queue - Poll next task for an agent.
 *
 * Query params:
 * - agent: required agent name (or use x-agent-name header)
 * - max_capacity: optional integer 1..20 (default 1)
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateLimited = (0, rate_limit_1.agentTaskLimiter)(request);
    if (rateLimited)
        return rateLimited;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = auth.user.workspace_id;
        const { searchParams } = new URL(request.url);
        const agent = (searchParams.get('agent') || '').trim() ||
            (request.headers.get('x-agent-name') || '').trim();
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Missing agent. Provide ?agent=... or x-agent-name header.' }, { status: 400 });
        }
        const maxCapacityRaw = searchParams.get('max_capacity') || '1';
        if (!/^\d+$/.test(maxCapacityRaw)) {
            return server_1.NextResponse.json({ error: 'Invalid max_capacity. Expected integer 1..20.' }, { status: 400 });
        }
        const maxCapacity = Number(maxCapacityRaw);
        if (!Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 20) {
            return server_1.NextResponse.json({ error: 'Invalid max_capacity. Expected integer 1..20.' }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        const currentTask = db.prepare(`
      SELECT *
      FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(workspaceId, agent);
        if (currentTask) {
            return server_1.NextResponse.json({
                task: mapTaskRow(currentTask),
                reason: 'continue_current',
                agent,
                timestamp: now,
            });
        }
        const inProgressCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
    `).get(workspaceId, agent).c;
        if (inProgressCount >= maxCapacity) {
            return server_1.NextResponse.json({
                task: null,
                reason: 'at_capacity',
                agent,
                timestamp: now,
            });
        }
        // Best-effort atomic pickup loop for race safety.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const candidate = db.prepare(`
        SELECT *
        FROM tasks
        WHERE workspace_id = ?
          AND status IN ('assigned', 'inbox')
          AND (assigned_to IS NULL OR assigned_to = ?)
        ORDER BY ${priorityRankSql()} ASC, due_date ASC NULLS LAST, created_at ASC
        LIMIT 1
      `).get(workspaceId, agent);
            if (!candidate)
                break;
            const claimed = db.prepare(`
        UPDATE tasks
        SET status = 'in_progress', assigned_to = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
          AND status IN ('assigned', 'inbox')
          AND (assigned_to IS NULL OR assigned_to = ?)
      `).run(agent, now, candidate.id, workspaceId, agent);
            if (claimed.changes > 0) {
                const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(candidate.id, workspaceId);
                return server_1.NextResponse.json({
                    task: mapTaskRow(task),
                    reason: 'assigned',
                    agent,
                    timestamp: now,
                });
            }
        }
        return server_1.NextResponse.json({
            task: null,
            reason: 'no_tasks_available',
            agent,
            timestamp: now,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/tasks/queue error');
        return server_1.NextResponse.json({ error: 'Failed to poll task queue' }, { status: 500 });
    }
}
