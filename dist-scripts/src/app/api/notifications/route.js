"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.DELETE = DELETE;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const validation_1 = require("@/lib/validation");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/notifications - Get notifications for a specific recipient
 * Query params: recipient, unread_only, type, limit, offset
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
        // Parse query parameters
        const recipient = searchParams.get('recipient');
        const unread_only = searchParams.get('unread_only') === 'true';
        const type = searchParams.get('type');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
        const offset = parseInt(searchParams.get('offset') || '0');
        if (!recipient) {
            return server_1.NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
        }
        // Build dynamic query
        let query = 'SELECT * FROM notifications WHERE recipient = ? AND workspace_id = ?';
        const params = [recipient, workspaceId];
        if (unread_only) {
            query += ' AND read_at IS NULL';
        }
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const stmt = db.prepare(query);
        const notifications = stmt.all(...params);
        // Prepare source detail statements once (avoids N+1)
        const taskDetailStmt = db.prepare('SELECT id, title, status FROM tasks WHERE id = ? AND workspace_id = ?');
        const commentDetailStmt = db.prepare(`
      SELECT c.id, c.content, c.task_id, t.title as task_title
      FROM comments c
      LEFT JOIN tasks t ON c.task_id = t.id
      WHERE c.id = ? AND c.workspace_id = ? AND t.workspace_id = ?
    `);
        const agentDetailStmt = db.prepare('SELECT id, name, role, status FROM agents WHERE id = ? AND workspace_id = ?');
        // Enhance notifications with related entity data
        const enhancedNotifications = notifications.map(notification => {
            var _a;
            let sourceDetails = null;
            try {
                if (notification.source_type && notification.source_id) {
                    switch (notification.source_type) {
                        case 'task': {
                            const task = taskDetailStmt.get(notification.source_id, workspaceId);
                            if (task) {
                                sourceDetails = Object.assign({ type: 'task' }, task);
                            }
                            break;
                        }
                        case 'comment': {
                            const comment = commentDetailStmt.get(notification.source_id, workspaceId, workspaceId);
                            if (comment) {
                                sourceDetails = Object.assign(Object.assign({ type: 'comment' }, comment), { content_preview: ((_a = comment.content) === null || _a === void 0 ? void 0 : _a.substring(0, 100)) || '' });
                            }
                            break;
                        }
                        case 'agent': {
                            const agent = agentDetailStmt.get(notification.source_id, workspaceId);
                            if (agent) {
                                sourceDetails = Object.assign({ type: 'agent' }, agent);
                            }
                            break;
                        }
                    }
                }
            }
            catch (error) {
                logger_1.logger.warn({ err: error, notificationId: notification.id }, 'Failed to fetch source details for notification');
            }
            return Object.assign(Object.assign({}, notification), { source: sourceDetails });
        });
        // Get unread count for this recipient
        const unreadCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM notifications 
      WHERE recipient = ? AND read_at IS NULL AND workspace_id = ?
    `).get(recipient, workspaceId);
        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE recipient = ? AND workspace_id = ?';
        const countParams = [recipient, workspaceId];
        if (unread_only) {
            countQuery += ' AND read_at IS NULL';
        }
        if (type) {
            countQuery += ' AND type = ?';
            countParams.push(type);
        }
        const countRow = db.prepare(countQuery).get(...countParams);
        return server_1.NextResponse.json({
            notifications: enhancedNotifications,
            total: countRow.total,
            page: Math.floor(offset / limit) + 1,
            limit,
            unreadCount: unreadCount.count
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/notifications error');
        return server_1.NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
    }
}
/**
 * PUT /api/notifications - Mark notifications as read
 * Body: { ids: number[] } or { recipient: string } (mark all as read)
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
        const { ids, recipient, markAllRead } = body;
        const now = Math.floor(Date.now() / 1000);
        if (markAllRead && recipient) {
            // Mark all notifications as read for this recipient
            const stmt = db.prepare(`
        UPDATE notifications 
        SET read_at = ?
        WHERE recipient = ? AND read_at IS NULL AND workspace_id = ?
      `);
            const result = stmt.run(now, recipient, workspaceId);
            return server_1.NextResponse.json({
                success: true,
                markedAsRead: result.changes
            });
        }
        else if (ids && Array.isArray(ids)) {
            // Mark specific notifications as read
            const placeholders = ids.map(() => '?').join(',');
            const stmt = db.prepare(`
        UPDATE notifications 
        SET read_at = ?
        WHERE id IN (${placeholders}) AND read_at IS NULL AND workspace_id = ?
      `);
            const result = stmt.run(now, ...ids, workspaceId);
            return server_1.NextResponse.json({
                success: true,
                markedAsRead: result.changes
            });
        }
        else {
            return server_1.NextResponse.json({
                error: 'Either provide ids array or recipient with markAllRead=true'
            }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/notifications error');
        return server_1.NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
    }
}
/**
 * DELETE /api/notifications - Delete notifications
 * Body: { ids: number[] } or { recipient: string, olderThan: number }
 */
async function DELETE(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { ids, recipient, olderThan } = body;
        if (ids && Array.isArray(ids)) {
            // Delete specific notifications
            const placeholders = ids.map(() => '?').join(',');
            const stmt = db.prepare(`
        DELETE FROM notifications 
        WHERE id IN (${placeholders}) AND workspace_id = ?
      `);
            const result = stmt.run(...ids, workspaceId);
            return server_1.NextResponse.json({
                success: true,
                deleted: result.changes
            });
        }
        else if (recipient && olderThan) {
            // Delete old notifications for recipient
            const stmt = db.prepare(`
        DELETE FROM notifications 
        WHERE recipient = ? AND created_at < ? AND workspace_id = ?
      `);
            const result = stmt.run(recipient, olderThan, workspaceId);
            return server_1.NextResponse.json({
                success: true,
                deleted: result.changes
            });
        }
        else {
            return server_1.NextResponse.json({
                error: 'Either provide ids array or recipient with olderThan timestamp'
            }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/notifications error');
        return server_1.NextResponse.json({ error: 'Failed to delete notifications' }, { status: 500 });
    }
}
/**
 * POST /api/notifications/mark-delivered - Mark notifications as delivered to agent
 * Body: { agent: string }
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
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const result = await (0, validation_1.validateBody)(request, validation_1.notificationActionSchema);
        if ('error' in result)
            return result.error;
        const { agent, action } = result.data;
        if (action === 'mark-delivered') {
            const now = Math.floor(Date.now() / 1000);
            // Mark undelivered notifications as delivered
            const stmt = db.prepare(`
        UPDATE notifications 
        SET delivered_at = ?
        WHERE recipient = ? AND delivered_at IS NULL AND workspace_id = ?
      `);
            const result = stmt.run(now, agent, workspaceId);
            // Get the notifications that were just marked as delivered
            const deliveredNotifications = db.prepare(`
        SELECT * FROM notifications 
        WHERE recipient = ? AND delivered_at = ? AND workspace_id = ?
        ORDER BY created_at DESC
      `).all(agent, now, workspaceId);
            return server_1.NextResponse.json({
                success: true,
                delivered: result.changes,
                notifications: deliveredNotifications
            });
        }
        else {
            return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/notifications error');
        return server_1.NextResponse.json({ error: 'Failed to process notification action' }, { status: 500 });
    }
}
