"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
const db_1 = require("@/lib/db");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
// Only allow alphanumeric, hyphens, and underscores in session IDs
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;
async function POST(request, { params }) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { id } = await params;
        const { action } = await request.json();
        if (!SESSION_ID_RE.test(id)) {
            return server_1.NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
        }
        if (!['monitor', 'pause', 'terminate'].includes(action)) {
            return server_1.NextResponse.json({ error: 'Invalid action. Must be: monitor, pause, terminate' }, { status: 400 });
        }
        let result;
        if (action === 'terminate') {
            result = await (0, openclaw_gateway_1.callOpenClawGateway)('sessions_kill', { sessionKey: id }, 10000);
        }
        else {
            const message = action === 'monitor'
                ? { type: 'control', action: 'monitor' }
                : { type: 'control', action: 'pause' };
            result = await (0, openclaw_gateway_1.callOpenClawGateway)('sessions_send', { sessionKey: id, message }, 10000);
        }
        db_1.db_helpers.logActivity('session_control', 'session', 0, auth.user.username, `Session ${action}: ${id}`, { session_key: id, action });
        return server_1.NextResponse.json({
            success: true,
            action,
            session: id,
            result,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Session control error');
        return server_1.NextResponse.json({ error: error.message || 'Session control failed' }, { status: 500 });
    }
}
