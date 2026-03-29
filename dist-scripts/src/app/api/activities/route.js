"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/activities - Get activity stream or stats
 * Query params: type, actor, entity_type, limit, offset, since, hours (for stats)
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams, pathname } = new URL(request.url);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Route to stats endpoint if requested
        if (pathname.endsWith('/stats') || searchParams.has('stats')) {
            return handleStatsRequest(request, workspaceId);
        }
        // Default activities endpoint
        return handleActivitiesRequest(request, workspaceId);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/activities error');
        return server_1.NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
    }
}
/**
 * Handle regular activities request
 */
async function handleActivitiesRequest(request, workspaceId) {
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        // Parse query parameters
        const type = searchParams.get('type');
        const actor = searchParams.get('actor');
        const entity_type = searchParams.get('entity_type');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
        const offset = parseInt(searchParams.get('offset') || '0');
        const since = searchParams.get('since'); // Unix timestamp for real-time updates
        // Build dynamic query
        let query = 'SELECT * FROM activities WHERE workspace_id = ?';
        const params = [workspaceId];
        if (type) {
            const types = type.split(',').map(t => t.trim()).filter(Boolean);
            if (types.length === 1) {
                query += ' AND type = ?';
                params.push(types[0]);
            }
            else if (types.length > 1) {
                query += ` AND type IN (${types.map(() => '?').join(',')})`;
                params.push(...types);
            }
        }
        if (actor) {
            query += ' AND actor = ?';
            params.push(actor);
        }
        if (entity_type) {
            query += ' AND entity_type = ?';
            params.push(entity_type);
        }
        if (since) {
            query += ' AND created_at > ?';
            params.push(parseInt(since));
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const stmt = db.prepare(query);
        const activities = stmt.all(...params);
        // Prepare entity detail statements once (avoids N+1)
        const taskDetailStmt = db.prepare('SELECT id, title, status FROM tasks WHERE id = ? AND workspace_id = ?');
        const agentDetailStmt = db.prepare('SELECT id, name, role, status FROM agents WHERE id = ? AND workspace_id = ?');
        const commentDetailStmt = db.prepare(`
      SELECT c.id, c.content, c.task_id, t.title as task_title
      FROM comments c
      LEFT JOIN tasks t ON c.task_id = t.id
      WHERE c.id = ? AND c.workspace_id = ? AND t.workspace_id = ?
    `);
        // Parse JSON data field and enhance with related entity data
        const enhancedActivities = activities.map(activity => {
            var _a;
            let entityDetails = null;
            try {
                switch (activity.entity_type) {
                    case 'task': {
                        const task = taskDetailStmt.get(activity.entity_id, workspaceId);
                        if (task) {
                            entityDetails = Object.assign({ type: 'task' }, task);
                        }
                        break;
                    }
                    case 'agent': {
                        const agent = agentDetailStmt.get(activity.entity_id, workspaceId);
                        if (agent) {
                            entityDetails = Object.assign({ type: 'agent' }, agent);
                        }
                        break;
                    }
                    case 'comment': {
                        const comment = commentDetailStmt.get(activity.entity_id, workspaceId, workspaceId);
                        if (comment) {
                            entityDetails = Object.assign(Object.assign({ type: 'comment' }, comment), { content_preview: ((_a = comment.content) === null || _a === void 0 ? void 0 : _a.substring(0, 100)) || '' });
                        }
                        break;
                    }
                }
            }
            catch (error) {
                logger_1.logger.warn({ err: error, activityId: activity.id }, 'Failed to fetch entity details for activity');
            }
            return Object.assign(Object.assign({}, activity), { data: activity.data ? JSON.parse(activity.data) : null, entity: entityDetails });
        });
        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM activities WHERE workspace_id = ?';
        const countParams = [workspaceId];
        if (type) {
            const types = type.split(',').map(t => t.trim()).filter(Boolean);
            if (types.length === 1) {
                countQuery += ' AND type = ?';
                countParams.push(types[0]);
            }
            else if (types.length > 1) {
                countQuery += ` AND type IN (${types.map(() => '?').join(',')})`;
                countParams.push(...types);
            }
        }
        if (actor) {
            countQuery += ' AND actor = ?';
            countParams.push(actor);
        }
        if (entity_type) {
            countQuery += ' AND entity_type = ?';
            countParams.push(entity_type);
        }
        if (since) {
            countQuery += ' AND created_at > ?';
            countParams.push(parseInt(since));
        }
        const countResult = db.prepare(countQuery).get(...countParams);
        return server_1.NextResponse.json({
            activities: enhancedActivities,
            total: countResult.total,
            hasMore: offset + activities.length < countResult.total
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/activities (activities) error');
        return server_1.NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 });
    }
}
/**
 * Handle stats request
 */
async function handleStatsRequest(request, workspaceId) {
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        // Parse timeframe parameter (defaults to 24 hours)
        const hours = parseInt(searchParams.get('hours') || '24');
        const since = Math.floor(Date.now() / 1000) - (hours * 3600);
        // Get activity counts by type
        const activityStats = db.prepare(`
      SELECT 
        type,
        COUNT(*) as count
      FROM activities 
      WHERE created_at > ? AND workspace_id = ?
      GROUP BY type
      ORDER BY count DESC
    `).all(since, workspaceId);
        // Get most active actors
        const activeActors = db.prepare(`
      SELECT 
        actor,
        COUNT(*) as activity_count
      FROM activities 
      WHERE created_at > ? AND workspace_id = ?
      GROUP BY actor
      ORDER BY activity_count DESC
      LIMIT 10
    `).all(since, workspaceId);
        // Get activity timeline (hourly buckets)
        const timeline = db.prepare(`
      SELECT 
        (created_at / 3600) * 3600 as hour_bucket,
        COUNT(*) as count
      FROM activities 
      WHERE created_at > ? AND workspace_id = ?
      GROUP BY hour_bucket
      ORDER BY hour_bucket ASC
    `).all(since, workspaceId);
        return server_1.NextResponse.json({
            timeframe: `${hours} hours`,
            activityByType: activityStats,
            topActors: activeActors,
            timeline: timeline.map(item => ({
                timestamp: item.hour_bucket,
                count: item.count,
                hour: new Date(item.hour_bucket * 1000).toISOString()
            }))
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/activities (stats) error');
        return server_1.NextResponse.json({ error: 'Failed to fetch activity stats' }, { status: 500 });
    }
}
