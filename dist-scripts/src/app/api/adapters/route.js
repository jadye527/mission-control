"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const adapters_1 = require("@/lib/adapters");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/adapters — List available framework adapters.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json({ adapters: (0, adapters_1.listAdapters)() });
}
/**
 * POST /api/adapters — Framework-agnostic agent action dispatcher.
 *
 * Body: { framework, action, payload }
 *
 * Actions:
 *   register   — Register an agent via its framework adapter
 *   heartbeat  — Send a heartbeat/status update
 *   report     — Report task progress
 *   assignments — Get pending task assignments
 *   disconnect — Disconnect an agent
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateLimited = (0, rate_limit_1.agentHeartbeatLimiter)(request);
    if (rateLimited)
        return rateLimited;
    let body;
    try {
        body = await request.json();
    }
    catch (_b) {
        return server_1.NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const framework = typeof (body === null || body === void 0 ? void 0 : body.framework) === 'string' ? body.framework.trim() : '';
    const action = typeof (body === null || body === void 0 ? void 0 : body.action) === 'string' ? body.action.trim() : '';
    const payload = (_a = body === null || body === void 0 ? void 0 : body.payload) !== null && _a !== void 0 ? _a : {};
    if (!framework || !action) {
        return server_1.NextResponse.json({ error: 'framework and action are required' }, { status: 400 });
    }
    let adapter;
    try {
        adapter = (0, adapters_1.getAdapter)(framework);
    }
    catch (_c) {
        return server_1.NextResponse.json({
            error: `Unknown framework: ${framework}. Available: ${(0, adapters_1.listAdapters)().join(', ')}`,
        }, { status: 400 });
    }
    try {
        switch (action) {
            case 'register': {
                const { agentId, name, metadata } = payload;
                if (!agentId || !name) {
                    return server_1.NextResponse.json({ error: 'payload.agentId and payload.name required' }, { status: 400 });
                }
                await adapter.register({ agentId, name, framework, metadata });
                return server_1.NextResponse.json({ ok: true, action: 'register', framework });
            }
            case 'heartbeat': {
                const { agentId, status, metrics } = payload;
                if (!agentId) {
                    return server_1.NextResponse.json({ error: 'payload.agentId required' }, { status: 400 });
                }
                await adapter.heartbeat({ agentId, status: status || 'online', metrics });
                return server_1.NextResponse.json({ ok: true, action: 'heartbeat', framework });
            }
            case 'report': {
                const { taskId, agentId, progress, status: taskStatus, output } = payload;
                if (!taskId || !agentId) {
                    return server_1.NextResponse.json({ error: 'payload.taskId and payload.agentId required' }, { status: 400 });
                }
                await adapter.reportTask({ taskId, agentId, progress: progress !== null && progress !== void 0 ? progress : 0, status: taskStatus || 'in_progress', output });
                return server_1.NextResponse.json({ ok: true, action: 'report', framework });
            }
            case 'assignments': {
                const { agentId } = payload;
                if (!agentId) {
                    return server_1.NextResponse.json({ error: 'payload.agentId required' }, { status: 400 });
                }
                const assignments = await adapter.getAssignments(agentId);
                return server_1.NextResponse.json({ assignments, framework });
            }
            case 'disconnect': {
                const { agentId } = payload;
                if (!agentId) {
                    return server_1.NextResponse.json({ error: 'payload.agentId required' }, { status: 400 });
                }
                await adapter.disconnect(agentId);
                return server_1.NextResponse.json({ ok: true, action: 'disconnect', framework });
            }
            default:
                return server_1.NextResponse.json({
                    error: `Unknown action: ${action}. Use: register, heartbeat, report, assignments, disconnect`,
                }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error, framework, action }, 'POST /api/adapters error');
        return server_1.NextResponse.json({ error: 'Adapter action failed' }, { status: 500 });
    }
}
exports.dynamic = 'force-dynamic';
