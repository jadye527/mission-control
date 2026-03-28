import { createHmac, timingSafeEqual } from 'crypto';
import { eventBus } from './event-bus';
import { logger } from './logger';
// Backoff schedule in seconds: 30s, 5m, 30m, 2h, 8h
const BACKOFF_SECONDS = [30, 300, 1800, 7200, 28800];
const MAX_RETRIES = parseInt(process.env.MC_WEBHOOK_MAX_RETRIES || '5', 10) || 5;
// Map event bus events to webhook event types
const EVENT_MAP = {
    'activity.created': 'activity', // Dynamically becomes activity.<type>
    'notification.created': 'notification', // Dynamically becomes notification.<type>
    'agent.status_changed': 'agent.status_change',
    'audit.security': 'security', // Dynamically becomes security.<action>
    'task.created': 'activity.task_created',
    'task.updated': 'activity.task_updated',
    'task.deleted': 'activity.task_deleted',
    'task.status_changed': 'activity.task_status_changed',
};
/**
 * Compute the next retry delay in seconds, with ±20% jitter.
 */
export function nextRetryDelay(attempt) {
    const base = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
    const jitter = base * 0.2 * (2 * Math.random() - 1); // ±20%
    return Math.round(base + jitter);
}
/**
 * Verify a webhook signature using constant-time comparison.
 * Consumers can use this to validate incoming webhook deliveries.
 */
export function verifyWebhookSignature(secret, rawBody, signatureHeader) {
    if (!signatureHeader || !secret)
        return false;
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    // Constant-time comparison
    const sigBuf = Buffer.from(signatureHeader);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) {
        // Compare expected against a dummy buffer of matching length to avoid timing leak
        const dummy = Buffer.alloc(expectedBuf.length);
        timingSafeEqual(expectedBuf, dummy);
        return false;
    }
    return timingSafeEqual(sigBuf, expectedBuf);
}
/**
 * Subscribe to the event bus and fire webhooks for matching events.
 * Called once during server initialization.
 */
export function initWebhookListener() {
    eventBus.on('server-event', (event) => {
        var _a, _b, _c, _d, _e;
        const mapping = EVENT_MAP[event.type];
        if (!mapping)
            return;
        // Build the specific webhook event type
        let webhookEventType;
        if (mapping === 'activity' && ((_a = event.data) === null || _a === void 0 ? void 0 : _a.type)) {
            webhookEventType = `activity.${event.data.type}`;
        }
        else if (mapping === 'notification' && ((_b = event.data) === null || _b === void 0 ? void 0 : _b.type)) {
            webhookEventType = `notification.${event.data.type}`;
        }
        else if (mapping === 'security' && ((_c = event.data) === null || _c === void 0 ? void 0 : _c.action)) {
            webhookEventType = `security.${event.data.action}`;
        }
        else {
            webhookEventType = mapping;
        }
        // Also fire agent.error for error status specifically
        const isAgentError = event.type === 'agent.status_changed' && ((_d = event.data) === null || _d === void 0 ? void 0 : _d.status) === 'error';
        const workspaceId = typeof ((_e = event.data) === null || _e === void 0 ? void 0 : _e.workspace_id) === 'number' ? event.data.workspace_id : 1;
        fireWebhooksAsync(webhookEventType, event.data, workspaceId).catch((err) => {
            logger.error({ err }, 'Webhook dispatch error');
        });
        if (isAgentError) {
            fireWebhooksAsync('agent.error', event.data, workspaceId).catch((err) => {
                logger.error({ err }, 'Webhook dispatch error');
            });
        }
    });
}
/**
 * Fire all matching webhooks for an event type (public for test endpoint).
 */
export function fireWebhooks(eventType, payload, workspaceId) {
    fireWebhooksAsync(eventType, payload, workspaceId).catch((err) => {
        logger.error({ err }, 'Webhook dispatch error');
    });
}
async function fireWebhooksAsync(eventType, payload, workspaceId) {
    const resolvedWorkspaceId = workspaceId !== null && workspaceId !== void 0 ? workspaceId : (typeof (payload === null || payload === void 0 ? void 0 : payload.workspace_id) === 'number' ? payload.workspace_id : 1);
    let webhooks;
    try {
        // Lazy import to avoid circular dependency
        const { getDatabase } = await import('./db');
        const db = getDatabase();
        webhooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1 AND workspace_id = ?').all(resolvedWorkspaceId);
    }
    catch (_a) {
        return; // DB not ready or table doesn't exist yet
    }
    if (webhooks.length === 0)
        return;
    const matchingWebhooks = webhooks.filter((wh) => {
        try {
            const events = JSON.parse(wh.events);
            return events.includes('*') || events.includes(eventType);
        }
        catch (_a) {
            return false;
        }
    });
    await Promise.allSettled(matchingWebhooks.map((wh) => deliverWebhook(wh, eventType, payload, { allowRetry: true })));
}
/**
 * Public wrapper for API routes (test endpoint, manual retry).
 * Returns delivery result fields for the response.
 */
export async function deliverWebhookPublic(webhook, eventType, payload, opts) {
    return deliverWebhook(webhook, eventType, payload, opts !== null && opts !== void 0 ? opts : { allowRetry: false });
}
async function deliverWebhook(webhook, eventType, payload, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { attempt = 0, parentDeliveryId = null, allowRetry = true } = opts;
    const body = JSON.stringify({
        event: eventType,
        timestamp: Math.floor(Date.now() / 1000),
        data: payload,
    });
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'MissionControl-Webhook/1.0',
        'X-MC-Event': eventType,
    };
    // HMAC signature if secret is configured
    if (webhook.secret) {
        const sig = createHmac('sha256', webhook.secret).update(body).digest('hex');
        headers['X-MC-Signature'] = `sha256=${sig}`;
    }
    const start = Date.now();
    let statusCode = null;
    let responseBody = null;
    let error = null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(webhook.url, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
        });
        clearTimeout(timeout);
        statusCode = res.status;
        responseBody = await res.text().catch(() => null);
        if (responseBody && responseBody.length > 1000) {
            responseBody = responseBody.slice(0, 1000) + '...';
        }
    }
    catch (err) {
        error = err.name === 'AbortError' ? 'Timeout (10s)' : err.message;
    }
    const durationMs = Date.now() - start;
    const success = statusCode !== null && statusCode >= 200 && statusCode < 300;
    let deliveryId;
    // Log delivery attempt and handle retry/circuit-breaker logic
    try {
        const { getDatabase } = await import('./db');
        const db = getDatabase();
        const insertResult = db.prepare(`
      INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status_code, response_body, error, duration_ms, attempt, is_retry, parent_delivery_id, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(webhook.id, eventType, body, statusCode, responseBody, error, durationMs, attempt, attempt > 0 ? 1 : 0, parentDeliveryId, (_a = webhook.workspace_id) !== null && _a !== void 0 ? _a : 1);
        deliveryId = Number(insertResult.lastInsertRowid);
        // Update webhook last_fired
        db.prepare(`
      UPDATE webhooks SET last_fired_at = unixepoch(), last_status = ?, updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `).run(statusCode !== null && statusCode !== void 0 ? statusCode : -1, webhook.id, (_b = webhook.workspace_id) !== null && _b !== void 0 ? _b : 1);
        // Circuit breaker + retry scheduling (skip for test deliveries)
        if (allowRetry) {
            if (success) {
                // Reset consecutive failures on success
                db.prepare(`UPDATE webhooks SET consecutive_failures = 0 WHERE id = ? AND workspace_id = ?`).run(webhook.id, (_c = webhook.workspace_id) !== null && _c !== void 0 ? _c : 1);
            }
            else {
                // Increment consecutive failures
                db.prepare(`UPDATE webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = ? AND workspace_id = ?`).run(webhook.id, (_d = webhook.workspace_id) !== null && _d !== void 0 ? _d : 1);
                if (attempt < MAX_RETRIES - 1) {
                    // Schedule retry
                    const delaySec = nextRetryDelay(attempt);
                    const nextRetryAt = Math.floor(Date.now() / 1000) + delaySec;
                    db.prepare(`UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?`).run(nextRetryAt, deliveryId);
                }
                else {
                    // Exhausted retries — trip circuit breaker
                    const wh = db.prepare(`SELECT consecutive_failures FROM webhooks WHERE id = ? AND workspace_id = ?`).get(webhook.id, (_e = webhook.workspace_id) !== null && _e !== void 0 ? _e : 1);
                    if (wh && wh.consecutive_failures >= MAX_RETRIES) {
                        db.prepare(`UPDATE webhooks SET enabled = 0, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`).run(webhook.id, (_f = webhook.workspace_id) !== null && _f !== void 0 ? _f : 1);
                        logger.warn({ webhookId: webhook.id, name: webhook.name }, 'Webhook circuit breaker tripped — disabled after exhausting retries');
                    }
                }
            }
        }
        // Prune old deliveries (keep last 200 per webhook)
        db.prepare(`
      DELETE FROM webhook_deliveries
      WHERE webhook_id = ? AND workspace_id = ? AND id NOT IN (
        SELECT id FROM webhook_deliveries WHERE webhook_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 200
      )
    `).run(webhook.id, (_g = webhook.workspace_id) !== null && _g !== void 0 ? _g : 1, webhook.id, (_h = webhook.workspace_id) !== null && _h !== void 0 ? _h : 1);
    }
    catch (logErr) {
        logger.error({ err: logErr, webhookId: webhook.id }, 'Webhook delivery logging/pruning failed');
    }
    return { success, status_code: statusCode, response_body: responseBody, error, duration_ms: durationMs, delivery_id: deliveryId };
}
/**
 * Process pending webhook retries. Called by the scheduler.
 * Picks up deliveries where next_retry_at has passed and re-delivers them.
 */
export async function processWebhookRetries() {
    var _a;
    try {
        const { getDatabase } = await import('./db');
        const db = getDatabase();
        const now = Math.floor(Date.now() / 1000);
        // Find deliveries ready for retry (limit batch to 50)
        const pendingRetries = db.prepare(`
      SELECT wd.id, wd.webhook_id, wd.event_type, wd.payload, wd.attempt,
             w.id as w_id, w.name as w_name, w.url as w_url, w.secret as w_secret,
             w.events as w_events, w.enabled as w_enabled, w.consecutive_failures as w_consecutive_failures,
             wd.workspace_id as wd_workspace_id
      FROM webhook_deliveries wd
      JOIN webhooks w ON w.id = wd.webhook_id AND w.workspace_id = wd.workspace_id AND w.enabled = 1
      WHERE wd.next_retry_at IS NOT NULL AND wd.next_retry_at <= ?
      LIMIT 50
    `).all(now);
        if (pendingRetries.length === 0) {
            return { ok: true, message: 'No pending retries' };
        }
        // Clear next_retry_at immediately to prevent double-processing
        const clearStmt = db.prepare(`UPDATE webhook_deliveries SET next_retry_at = NULL WHERE id = ? AND workspace_id = ?`);
        for (const row of pendingRetries) {
            clearStmt.run(row.id, row.wd_workspace_id);
        }
        // Re-deliver each
        let succeeded = 0;
        let failed = 0;
        for (const row of pendingRetries) {
            const webhook = {
                id: row.w_id,
                name: row.w_name,
                url: row.w_url,
                secret: row.w_secret,
                events: row.w_events,
                enabled: row.w_enabled,
                consecutive_failures: row.w_consecutive_failures,
                workspace_id: row.wd_workspace_id,
            };
            // Parse the original payload from the stored JSON body
            let parsedPayload;
            try {
                const parsed = JSON.parse(row.payload);
                parsedPayload = (_a = parsed.data) !== null && _a !== void 0 ? _a : parsed;
            }
            catch (_b) {
                parsedPayload = {};
            }
            const result = await deliverWebhook(webhook, row.event_type, parsedPayload, {
                attempt: row.attempt + 1,
                parentDeliveryId: row.id,
                allowRetry: true,
            });
            if (result.success)
                succeeded++;
            else
                failed++;
        }
        return { ok: true, message: `Processed ${pendingRetries.length} retries (${succeeded} ok, ${failed} failed)` };
    }
    catch (err) {
        return { ok: false, message: `Webhook retry failed: ${err.message}` };
    }
}
