"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/webhooks/deliveries - Get delivery history for a webhook
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const { searchParams } = new URL(request.url);
        const webhookId = searchParams.get('webhook_id');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
        const offset = parseInt(searchParams.get('offset') || '0');
        let query = `
      SELECT wd.*, w.name as webhook_name, w.url as webhook_url
      FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id AND w.workspace_id = wd.workspace_id
      WHERE wd.workspace_id = ?
    `;
        const params = [workspaceId];
        if (webhookId) {
            query += ' AND wd.webhook_id = ?';
            params.push(webhookId);
        }
        query += ' ORDER BY wd.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const deliveries = db.prepare(query).all(...params);
        // Get total count
        let countQuery = 'SELECT COUNT(*) as count FROM webhook_deliveries WHERE workspace_id = ?';
        const countParams = [workspaceId];
        if (webhookId) {
            countQuery += ' AND webhook_id = ?';
            countParams.push(webhookId);
        }
        const { count: total } = db.prepare(countQuery).get(...countParams);
        return server_1.NextResponse.json({ deliveries, total });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/webhooks/deliveries error');
        return server_1.NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 });
    }
}
