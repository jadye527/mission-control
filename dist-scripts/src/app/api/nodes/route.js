"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
const GATEWAY_TIMEOUT = 5000;
/** Probe the gateway HTTP /health endpoint to check reachability. */
async function isGatewayReachable() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT);
    try {
        const res = await fetch(`http://${config_1.config.gatewayHost}:${config_1.config.gatewayPort}/health`, { signal: controller.signal });
        return res.ok;
    }
    catch (_a) {
        return false;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function GET(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const action = request.nextUrl.searchParams.get('action') || 'list';
    if (action === 'list') {
        try {
            const connected = await isGatewayReachable();
            if (!connected) {
                return server_1.NextResponse.json({ nodes: [], connected: false });
            }
            try {
                const data = await (0, openclaw_gateway_1.callOpenClawGateway)('node.list', {}, GATEWAY_TIMEOUT);
                return server_1.NextResponse.json({ nodes: (_a = data === null || data === void 0 ? void 0 : data.nodes) !== null && _a !== void 0 ? _a : [], connected: true });
            }
            catch (rpcErr) {
                // Gateway is reachable but openclaw CLI unavailable (e.g. Docker) or
                // node.list not supported — return connected=true with empty node list
                logger_1.logger.warn({ err: rpcErr }, 'node.list RPC failed, returning empty node list');
                return server_1.NextResponse.json({ nodes: [], connected: true });
            }
        }
        catch (err) {
            logger_1.logger.warn({ err }, 'Gateway unreachable for node listing');
            return server_1.NextResponse.json({ nodes: [], connected: false });
        }
    }
    if (action === 'devices') {
        try {
            const connected = await isGatewayReachable();
            if (!connected) {
                return server_1.NextResponse.json({ devices: [] });
            }
            try {
                const data = await (0, openclaw_gateway_1.callOpenClawGateway)('device.pair.list', {}, GATEWAY_TIMEOUT);
                return server_1.NextResponse.json({ devices: (_b = data === null || data === void 0 ? void 0 : data.devices) !== null && _b !== void 0 ? _b : [] });
            }
            catch (rpcErr) {
                logger_1.logger.warn({ err: rpcErr }, 'device.pair.list RPC failed, returning empty device list');
                return server_1.NextResponse.json({ devices: [] });
            }
        }
        catch (err) {
            logger_1.logger.warn({ err }, 'Gateway unreachable for device listing');
            return server_1.NextResponse.json({ devices: [] });
        }
    }
    return server_1.NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
const VALID_DEVICE_ACTIONS = ['approve', 'reject', 'rotate-token', 'revoke-token'];
/** Map UI action names to gateway RPC method names and their required param keys. */
const ACTION_RPC_MAP = {
    'approve': { method: 'device.pair.approve', paramKey: 'requestId' },
    'reject': { method: 'device.pair.reject', paramKey: 'requestId' },
    'rotate-token': { method: 'device.token.rotate', paramKey: 'deviceId' },
    'revoke-token': { method: 'device.token.revoke', paramKey: 'deviceId' },
};
/**
 * POST /api/nodes - Device management actions
 * Body: { action: DeviceAction, requestId?: string, deviceId?: string, role?: string, scopes?: string[] }
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    let body;
    try {
        body = await request.json();
    }
    catch (_a) {
        return server_1.NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const action = body.action;
    if (!action || !VALID_DEVICE_ACTIONS.includes(action)) {
        return server_1.NextResponse.json({ error: `Invalid action. Must be one of: ${VALID_DEVICE_ACTIONS.join(', ')}` }, { status: 400 });
    }
    const spec = ACTION_RPC_MAP[action];
    // Validate required param
    const id = body[spec.paramKey];
    if (!id || typeof id !== 'string') {
        return server_1.NextResponse.json({ error: `Missing required field: ${spec.paramKey}` }, { status: 400 });
    }
    // Build RPC params
    const params = { [spec.paramKey]: id };
    if ((action === 'rotate-token' || action === 'revoke-token') && body.role) {
        params.role = body.role;
    }
    if (action === 'rotate-token' && Array.isArray(body.scopes)) {
        params.scopes = body.scopes;
    }
    try {
        const result = await (0, openclaw_gateway_1.callOpenClawGateway)(spec.method, params, GATEWAY_TIMEOUT);
        return server_1.NextResponse.json(result);
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Gateway device action failed');
        return server_1.NextResponse.json({ error: 'Gateway device action failed' }, { status: 502 });
    }
}
