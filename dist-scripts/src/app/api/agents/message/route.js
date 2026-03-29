"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const command_1 = require("@/lib/command");
const auth_1 = require("@/lib/auth");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const injection_guard_1 = require("@/lib/injection-guard");
const secret_scanner_1 = require("@/lib/secret-scanner");
const security_events_1 = require("@/lib/security-events");
async function POST(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const result = await (0, validation_1.validateBody)(request, validation_1.createMessageSchema);
        if ('error' in result)
            return result.error;
        const { to, message } = result.data;
        const from = auth.user.display_name || auth.user.username || 'system';
        // Scan message for injection — this gets forwarded directly to an agent
        const injectionReport = (0, injection_guard_1.scanForInjection)(message, { context: 'prompt' });
        if (!injectionReport.safe) {
            const criticals = injectionReport.matches.filter(m => m.severity === 'critical');
            if (criticals.length > 0) {
                logger_1.logger.warn({ to, rules: criticals.map(m => m.rule) }, 'Blocked agent message: injection detected');
                return server_1.NextResponse.json({ error: 'Message blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) }, { status: 422 });
            }
        }
        const secretHits = (0, secret_scanner_1.scanForSecrets)(message);
        if (secretHits.length > 0) {
            try {
                (0, security_events_1.logSecurityEvent)({ event_type: 'secret_exposure', severity: 'critical', source: 'agent-message', agent_name: from, detail: JSON.stringify({ count: secretHits.length, types: secretHits.map(s => s.type) }), workspace_id: (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1, tenant_id: 1 });
            }
            catch (_c) { }
        }
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_b = auth.user.workspace_id) !== null && _b !== void 0 ? _b : 1;
        const agent = db
            .prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?')
            .get(to, workspaceId);
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Recipient agent not found' }, { status: 404 });
        }
        if (!agent.session_key) {
            return server_1.NextResponse.json({ error: 'Recipient agent has no session key configured' }, { status: 400 });
        }
        await (0, command_1.runOpenClaw)([
            'gateway',
            'sessions_send',
            '--session',
            agent.session_key,
            '--message',
            `Message from ${from}: ${message}`
        ], { timeoutMs: 10000 });
        db_1.db_helpers.createNotification(to, 'message', 'Direct Message', `${from}: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}`, 'agent', agent.id, workspaceId);
        db_1.db_helpers.logActivity('agent_message', 'agent', agent.id, from, `Sent message to ${to}`, { to }, workspaceId);
        return server_1.NextResponse.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/agents/message error');
        return server_1.NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
