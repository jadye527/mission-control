"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const task_routing_1 = require("@/lib/task-routing");
/**
 * GET /api/agents/[id]/heartbeat - Agent heartbeat check
 *
 * Checks for:
 * - @mentions in recent comments
 * - Assigned tasks
 * - Recent activity feed items
 *
 * Returns work items or "HEARTBEAT_OK" if nothing to do
 */
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Get agent by ID or name
        let agent;
        if (isNaN(Number(agentId))) {
            // Lookup by name
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        else {
            // Lookup by ID
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        const workItems = [];
        const now = Math.floor(Date.now() / 1000);
        const fourHoursAgo = now - (4 * 60 * 60); // Check last 4 hours
        // 1. Check for @mentions in recent comments
        const mentions = db.prepare(`
      SELECT c.*, t.title as task_title 
      FROM comments c
      JOIN tasks t ON c.task_id = t.id
      WHERE c.mentions LIKE ?
      AND c.workspace_id = ?
      AND t.workspace_id = ?
      AND c.created_at > ?
      ORDER BY c.created_at DESC
      LIMIT 10
    `).all(`%"${agent.name}"%`, workspaceId, workspaceId, fourHoursAgo);
        if (mentions.length > 0) {
            workItems.push({
                type: 'mentions',
                count: mentions.length,
                items: mentions.map((m) => ({
                    id: m.id,
                    task_title: m.task_title,
                    author: m.author,
                    content: m.content.substring(0, 100) + '...',
                    created_at: m.created_at
                }))
            });
        }
        // 2. Check for assigned tasks
        const assignedTasks = db.prepare(`
      SELECT * FROM tasks 
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND status IN ('assigned', 'in_progress')
      ORDER BY priority DESC, created_at ASC
      LIMIT 10
    `).all(agent.name, workspaceId);
        if (assignedTasks.length > 0) {
            workItems.push({
                type: 'assigned_tasks',
                count: assignedTasks.length,
                items: assignedTasks.map((t) => (Object.assign({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date }, (0, task_routing_1.resolveTaskImplementationTarget)(t))))
            });
        }
        // 3. Check for unread notifications
        const notifications = db_1.db_helpers.getUnreadNotifications(agent.name, workspaceId);
        if (notifications.length > 0) {
            workItems.push({
                type: 'notifications',
                count: notifications.length,
                items: notifications.slice(0, 5).map(n => ({
                    id: n.id,
                    type: n.type,
                    title: n.title,
                    message: n.message,
                    created_at: n.created_at
                }))
            });
        }
        // 4. Check for urgent activities that might need attention
        const urgentActivities = db.prepare(`
      SELECT * FROM activities 
      WHERE type IN ('task_created', 'task_assigned', 'high_priority_alert')
      AND workspace_id = ?
      AND created_at > ?
      AND description LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(workspaceId, fourHoursAgo, `%${agent.name}%`);
        if (urgentActivities.length > 0) {
            workItems.push({
                type: 'urgent_activities',
                count: urgentActivities.length,
                items: urgentActivities.map((a) => ({
                    id: a.id,
                    type: a.type,
                    description: a.description,
                    created_at: a.created_at
                }))
            });
        }
        // Update agent last_seen and status to show heartbeat activity
        db_1.db_helpers.updateAgentStatus(agent.name, 'idle', 'Heartbeat check', workspaceId);
        // Log heartbeat activity
        db_1.db_helpers.logActivity('agent_heartbeat', 'agent', agent.id, agent.name, `Heartbeat check completed - ${workItems.length > 0 ? `${workItems.length} work items found` : 'no work items'}`, { workItemsCount: workItems.length, workItemTypes: workItems.map(w => w.type) }, workspaceId);
        if (workItems.length === 0) {
            return server_1.NextResponse.json({
                status: 'HEARTBEAT_OK',
                agent: agent.name,
                checked_at: now,
                message: 'No work items found'
            });
        }
        return server_1.NextResponse.json({
            status: 'WORK_ITEMS_FOUND',
            agent: agent.name,
            checked_at: now,
            work_items: workItems,
            total_items: workItems.reduce((sum, item) => sum + item.count, 0)
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/heartbeat error');
        return server_1.NextResponse.json({ error: 'Failed to perform heartbeat check' }, { status: 500 });
    }
}
/**
 * POST /api/agents/[id]/heartbeat - Enhanced heartbeat
 *
 * Accepts optional body:
 * - connection_id: update direct_connections.last_heartbeat
 * - status: agent status override
 * - last_activity: activity description
 * - token_usage: { model, inputTokens, outputTokens, taskId? } for inline token reporting
 */
async function POST(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateLimited = (0, rate_limit_1.agentHeartbeatLimiter)(request);
    if (rateLimited)
        return rateLimited;
    let body = {};
    try {
        body = await request.json();
    }
    catch (_b) {
        // No body is fine — fall through to standard heartbeat
    }
    const { connection_id, token_usage } = body;
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    // Update direct connection heartbeat if connection_id provided
    if (connection_id) {
        db.prepare('UPDATE direct_connections SET last_heartbeat = ?, updated_at = ? WHERE connection_id = ? AND status = ? AND workspace_id = ?')
            .run(now, now, connection_id, 'connected', workspaceId);
    }
    // Inline token reporting
    let tokenRecorded = false;
    if (token_usage && token_usage.model && token_usage.inputTokens != null && token_usage.outputTokens != null) {
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        let agent;
        if (isNaN(Number(agentId))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        if (agent) {
            const sessionId = `${agent.name}:cli`;
            const parsedTaskId = token_usage.taskId != null && Number.isFinite(Number(token_usage.taskId))
                ? Number(token_usage.taskId)
                : null;
            let taskId = null;
            if (parsedTaskId && parsedTaskId > 0) {
                const taskRow = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(parsedTaskId, workspaceId);
                if (taskRow === null || taskRow === void 0 ? void 0 : taskRow.id) {
                    taskId = taskRow.id;
                }
                else {
                    logger_1.logger.warn({ taskId: parsedTaskId, workspaceId, agent: agent.name }, 'Ignoring token usage with unknown taskId');
                }
            }
            db.prepare(`INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, created_at, workspace_id, task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`).run(token_usage.model, sessionId, token_usage.inputTokens, token_usage.outputTokens, now, workspaceId, taskId);
            tokenRecorded = true;
        }
    }
    // Reuse GET logic for work-items check, then augment response
    const getResponse = await GET(request, { params });
    const getBody = await getResponse.json();
    return server_1.NextResponse.json(Object.assign(Object.assign({}, getBody), { token_recorded: tokenRecorded }));
}
