"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const GATEWAY_BASE = `http://${config_1.config.gatewayHost}:${config_1.config.gatewayPort}`;
async function gatewayFetch(path, options = {}) {
    const { method = 'GET', body, timeoutMs = 5000 } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${GATEWAY_BASE}${path}`, {
            method,
            signal: controller.signal,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body,
        });
        return res;
    }
    finally {
        clearTimeout(timer);
    }
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    try {
        switch (action) {
            case 'status': {
                try {
                    const res = await gatewayFetch('/api/status');
                    const data = await res.json();
                    return server_1.NextResponse.json(data);
                }
                catch (err) {
                    logger_1.logger.warn({ err }, 'debug: gateway unreachable for status');
                    return server_1.NextResponse.json({ gatewayReachable: false });
                }
            }
            case 'health': {
                try {
                    const res = await gatewayFetch('/api/health');
                    const data = await res.json();
                    return server_1.NextResponse.json(data);
                }
                catch (err) {
                    logger_1.logger.warn({ err }, 'debug: gateway unreachable for health');
                    return server_1.NextResponse.json({ healthy: false, error: 'Gateway unreachable' });
                }
            }
            case 'models': {
                try {
                    const res = await gatewayFetch('/api/models');
                    const data = await res.json();
                    return server_1.NextResponse.json(data);
                }
                catch (err) {
                    logger_1.logger.warn({ err }, 'debug: gateway unreachable for models');
                    return server_1.NextResponse.json({ models: [] });
                }
            }
            case 'heartbeat': {
                const start = performance.now();
                try {
                    const res = await gatewayFetch('/api/heartbeat', { timeoutMs: 3000 });
                    const latencyMs = Math.round(performance.now() - start);
                    const ok = res.ok;
                    return server_1.NextResponse.json({ ok, latencyMs, timestamp: Date.now() });
                }
                catch (_a) {
                    const latencyMs = Math.round(performance.now() - start);
                    return server_1.NextResponse.json({ ok: false, latencyMs, timestamp: Date.now() });
                }
            }
            default:
                return server_1.NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    }
    catch (err) {
        logger_1.logger.error({ err }, 'debug: unexpected error');
        return server_1.NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    if (action !== 'call') {
        return server_1.NextResponse.json({ error: 'POST only supports action=call' }, { status: 400 });
    }
    let body;
    try {
        body = await request.json();
    }
    catch (_a) {
        return server_1.NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { method, path, body: callBody } = body;
    if (!method || !['GET', 'POST'].includes(method)) {
        return server_1.NextResponse.json({ error: 'method must be GET or POST' }, { status: 400 });
    }
    if (!path || typeof path !== 'string' || !path.startsWith('/api/')) {
        return server_1.NextResponse.json({ error: 'path must start with /api/' }, { status: 400 });
    }
    try {
        const res = await gatewayFetch(path, {
            method,
            body: callBody ? JSON.stringify(callBody) : undefined,
            timeoutMs: 5000,
        });
        let responseBody;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            responseBody = await res.json();
        }
        else {
            responseBody = await res.text();
        }
        return server_1.NextResponse.json({
            status: res.status,
            statusText: res.statusText,
            contentType,
            body: responseBody,
        });
    }
    catch (err) {
        logger_1.logger.warn({ err, path }, 'debug: gateway call failed');
        return server_1.NextResponse.json({ error: 'Gateway unreachable', path }, { status: 502 });
    }
}
