"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const webhooks_1 = require("@/lib/webhooks");
const logger_1 = require("@/lib/logger");
/**
 * POST /api/webhooks/retry - Manually retry a failed delivery
 */
async function POST(request) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const { delivery_id } = await request.json();
        if (!delivery_id) {
            return server_1.NextResponse.json({ error: 'delivery_id is required' }, { status: 400 });
        }
        const delivery = db.prepare(`
      SELECT wd.*, w.id as w_id, w.name as w_name, w.url as w_url, w.secret as w_secret,
             w.events as w_events, w.enabled as w_enabled, w.workspace_id as w_workspace_id
      FROM webhook_deliveries wd
      JOIN webhooks w ON w.id = wd.webhook_id AND w.workspace_id = wd.workspace_id
      WHERE wd.id = ? AND wd.workspace_id = ?
    `).get(delivery_id, workspaceId);
        if (!delivery) {
            return server_1.NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
        }
        const webhook = {
            id: delivery.w_id,
            name: delivery.w_name,
            url: delivery.w_url,
            secret: delivery.w_secret,
            events: delivery.w_events,
            enabled: delivery.w_enabled,
            workspace_id: delivery.w_workspace_id,
        };
        // Parse the original payload
        let parsedPayload;
        try {
            const parsed = JSON.parse(delivery.payload);
            parsedPayload = (_b = parsed.data) !== null && _b !== void 0 ? _b : parsed;
        }
        catch (_d) {
            parsedPayload = {};
        }
        const result = await (0, webhooks_1.deliverWebhookPublic)(webhook, delivery.event_type, parsedPayload, {
            attempt: ((_c = delivery.attempt) !== null && _c !== void 0 ? _c : 0) + 1,
            parentDeliveryId: delivery.id,
            allowRetry: false, // Manual retries don't auto-schedule further retries
        });
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/webhooks/retry error');
        return server_1.NextResponse.json({ error: 'Failed to retry delivery' }, { status: 500 });
    }
}
