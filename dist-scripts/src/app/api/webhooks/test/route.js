"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const webhooks_1 = require("@/lib/webhooks");
const logger_1 = require("@/lib/logger");
/**
 * POST /api/webhooks/test - Send a test event to a webhook
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const { id } = await request.json();
        if (!id) {
            return server_1.NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
        }
        const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?').get(id, workspaceId);
        if (!webhook) {
            return server_1.NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
        }
        const payload = {
            message: 'This is a test webhook from Mission Control',
            webhook_id: webhook.id,
            webhook_name: webhook.name,
            triggered_by: auth.user.username,
        };
        const result = await (0, webhooks_1.deliverWebhookPublic)(webhook, 'test.ping', payload, { allowRetry: false });
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/webhooks/test error');
        return server_1.NextResponse.json({ error: 'Failed to test webhook' }, { status: 500 });
    }
}
