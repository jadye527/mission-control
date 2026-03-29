"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const command_1 = require("@/lib/command");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
/**
 * POST /api/notifications/deliver - Notification delivery daemon endpoint
 *
 * Polls undelivered notifications and sends them to agents
 * via OpenClaw gateway call agent command
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const body = await request.json();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const { agent_filter, // Optional: only deliver to specific agent
        limit = 50, // Max notifications to process per call
        dry_run = false // Test mode - don't actually deliver
         } = body;
        // Get undelivered notifications
        let query = `
      SELECT n.*, a.session_key 
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name AND a.workspace_id = n.workspace_id
      WHERE n.delivered_at IS NULL AND n.workspace_id = ?
    `;
        const params = [workspaceId];
        if (agent_filter) {
            query += ' AND n.recipient = ?';
            params.push(agent_filter);
        }
        query += ' ORDER BY n.created_at ASC LIMIT ?';
        params.push(limit);
        const undeliveredNotifications = db.prepare(query).all(...params);
        if (undeliveredNotifications.length === 0) {
            return server_1.NextResponse.json({
                status: 'success',
                message: 'No undelivered notifications found',
                processed: 0,
                delivered: 0,
                errors: []
            });
        }
        let deliveredCount = 0;
        let errorCount = 0;
        const errors = [];
        const deliveryResults = [];
        // Prepare update statement once (avoids N+1)
        const markDeliveredStmt = db.prepare('UPDATE notifications SET delivered_at = ? WHERE id = ? AND workspace_id = ?');
        for (const notification of undeliveredNotifications) {
            try {
                // Skip if agent is not registered in the agents table
                if (!notification.recipient) {
                    errors.push({
                        notification_id: notification.id,
                        recipient: notification.recipient,
                        error: 'Notification has no recipient'
                    });
                    errorCount++;
                    continue;
                }
                // Format message for delivery
                const message = formatNotificationMessage(notification);
                if (!dry_run) {
                    // Send notification via OpenClaw gateway call agent
                    try {
                        const invokeParams = {
                            message,
                            agentId: notification.recipient,
                            idempotencyKey: `notification-${notification.id}-${Date.now()}`,
                            deliver: false,
                        };
                        const { stdout, stderr } = await (0, command_1.runOpenClaw)([
                            'gateway',
                            'call',
                            'agent',
                            '--params',
                            JSON.stringify(invokeParams),
                            '--json'
                        ], { timeoutMs: 30000 });
                        if (stderr && stderr.includes('error')) {
                            throw new Error(`OpenClaw error: ${stderr}`);
                        }
                        // Mark as delivered
                        const now = Math.floor(Date.now() / 1000);
                        markDeliveredStmt.run(now, notification.id, workspaceId);
                        deliveredCount++;
                        deliveryResults.push({
                            notification_id: notification.id,
                            recipient: notification.recipient,
                            session_key: notification.session_key,
                            delivered_at: now,
                            status: 'delivered',
                            stdout: stdout.substring(0, 200) // Truncate for storage
                        });
                        // Log successful delivery
                        db_1.db_helpers.logActivity('notification_delivered', 'notification', notification.id, 'system', `Notification delivered to ${notification.recipient}`, {
                            notification_type: notification.type,
                            session_key: notification.session_key,
                            title: notification.title
                        }, workspaceId);
                    }
                    catch (cmdError) {
                        throw new Error(`Command failed: ${cmdError.message}`);
                    }
                }
                else {
                    // Dry run - just log what would be sent
                    deliveryResults.push({
                        notification_id: notification.id,
                        recipient: notification.recipient,
                        session_key: notification.session_key,
                        status: 'dry_run',
                        message: message
                    });
                    deliveredCount++;
                }
            }
            catch (error) {
                errorCount++;
                errors.push({
                    notification_id: notification.id,
                    recipient: notification.recipient,
                    error: error.message
                });
                logger_1.logger.error({ err: error, notificationId: notification.id, recipient: notification.recipient }, 'Failed to deliver notification');
            }
        }
        // Log delivery batch summary
        db_1.db_helpers.logActivity('notification_delivery_batch', 'system', 0, 'notification_daemon', `Processed ${undeliveredNotifications.length} notifications: ${deliveredCount} delivered, ${errorCount} failed`, {
            total_processed: undeliveredNotifications.length,
            delivered: deliveredCount,
            errors: errorCount,
            dry_run,
            agent_filter: agent_filter || null
        }, workspaceId);
        return server_1.NextResponse.json({
            status: 'success',
            message: `Processed ${undeliveredNotifications.length} notifications`,
            total_processed: undeliveredNotifications.length,
            delivered: deliveredCount,
            errors: errorCount,
            dry_run,
            delivery_results: deliveryResults,
            error_details: errors
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/notifications/deliver error');
        return server_1.NextResponse.json({ error: 'Failed to deliver notifications' }, { status: 500 });
    }
}
/**
 * GET /api/notifications/deliver - Get delivery status and statistics
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
        const agent = searchParams.get('agent');
        // Get delivery statistics
        let baseQuery = 'SELECT COUNT(*) as count FROM notifications WHERE workspace_id = ?';
        let params = [workspaceId];
        if (agent) {
            baseQuery += ' AND recipient = ?';
            params.push(agent);
        }
        const totalNotifications = db.prepare(baseQuery).get(...params);
        const undeliveredCount = db.prepare(baseQuery + ' AND delivered_at IS NULL').get(...params);
        const deliveredCount = db.prepare(baseQuery + ' AND delivered_at IS NOT NULL').get(...params);
        // Get recent delivery activity
        const recentDeliveries = db.prepare(`
      SELECT 
        recipient,
        type,
        title,
        delivered_at,
        created_at
      FROM notifications 
      WHERE delivered_at IS NOT NULL AND workspace_id = ?
      ${agent ? 'AND recipient = ?' : ''}
      ORDER BY delivered_at DESC 
      LIMIT 10
    `).all(...(agent ? [workspaceId, agent] : [workspaceId]));
        // Get agents with pending notifications
        const agentsPending = db.prepare(`
      SELECT 
        n.recipient,
        a.session_key,
        COUNT(*) as pending_count
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name AND a.workspace_id = n.workspace_id
      WHERE n.delivered_at IS NULL AND n.workspace_id = ?
      GROUP BY n.recipient, a.session_key
      ORDER BY pending_count DESC
    `).all(workspaceId);
        return server_1.NextResponse.json({
            statistics: {
                total: totalNotifications.count,
                delivered: deliveredCount.count,
                undelivered: undeliveredCount.count,
                delivery_rate: totalNotifications.count > 0 ?
                    Math.round((deliveredCount.count / totalNotifications.count) * 100) : 0
            },
            agents_with_pending: agentsPending,
            recent_deliveries: recentDeliveries,
            agent_filter: agent
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/notifications/deliver error');
        return server_1.NextResponse.json({ error: 'Failed to get delivery status' }, { status: 500 });
    }
}
/**
 * Format notification for delivery to agent session
 */
function formatNotificationMessage(notification) {
    const timestamp = new Date(notification.created_at * 1000).toLocaleString();
    let message = `🔔 **${notification.title}**\n\n`;
    message += `${notification.message}\n\n`;
    if (notification.type === 'mention') {
        message += `📝 You were mentioned in a comment\n`;
    }
    else if (notification.type === 'assignment') {
        message += `📋 You have been assigned a new task\n`;
    }
    else if (notification.type === 'due_date') {
        message += `⏰ Task deadline approaching\n`;
    }
    if (notification.source_type && notification.source_id) {
        message += `🔗 Related ${notification.source_type} ID: ${notification.source_id}\n`;
    }
    message += `⏰ ${timestamp}`;
    return message;
}
