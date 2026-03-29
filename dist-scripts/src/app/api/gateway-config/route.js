"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
const server_1 = require("next/server");
const node_crypto_1 = require("node:crypto");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const config_1 = require("@/lib/config");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
const gateway_runtime_1 = require("@/lib/gateway-runtime");
function getConfigPath() {
    return config_1.config.openclawConfigPath || null;
}
function gatewayUrl(path) {
    return `http://${config_1.config.gatewayHost}:${config_1.config.gatewayPort}${path}`;
}
function gatewayHeaders() {
    const token = (0, gateway_runtime_1.getDetectedGatewayToken)();
    const headers = { 'Content-Type': 'application/json' };
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    return headers;
}
function computeHash(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw, 'utf8').digest('hex');
}
/**
 * GET /api/gateway-config - Read the gateway configuration
 * GET /api/gateway-config?action=schema - Get the config JSON schema
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const action = request.nextUrl.searchParams.get('action');
    if (action === 'schema') {
        return getSchema();
    }
    const configPath = getConfigPath();
    if (!configPath) {
        return server_1.NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 });
    }
    try {
        const { readFile } = require('fs/promises');
        const raw = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const hash = computeHash(raw);
        // Redact sensitive fields for display
        const redacted = redactSensitive(JSON.parse(JSON.stringify(parsed)));
        return server_1.NextResponse.json({
            path: configPath,
            config: redacted,
            raw_size: raw.length,
            hash,
        });
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return server_1.NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 });
        }
        return server_1.NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 });
    }
}
async function getSchema() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(gatewayUrl('/api/config/schema'), {
            signal: controller.signal,
            headers: gatewayHeaders(),
        });
        clearTimeout(timeout);
        if (!res.ok) {
            return server_1.NextResponse.json({ error: `Gateway returned ${res.status}` }, { status: 502 });
        }
        const data = await res.json();
        return server_1.NextResponse.json(data);
    }
    catch (err) {
        clearTimeout(timeout);
        return server_1.NextResponse.json({ error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' }, { status: 502 });
    }
}
/**
 * PUT /api/gateway-config - Update specific config fields
 * PUT /api/gateway-config?action=apply - Hot-apply config via gateway RPC
 * PUT /api/gateway-config?action=update - System update via gateway RPC
 *
 * Body: { updates: { "path.to.key": value, ... }, hash?: string }
 */
async function PUT(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const action = request.nextUrl.searchParams.get('action');
    if (action === 'apply') {
        return applyConfig(request, auth);
    }
    if (action === 'update') {
        return updateSystem(request, auth);
    }
    const configPath = getConfigPath();
    if (!configPath) {
        return server_1.NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 });
    }
    const result = await (0, validation_1.validateBody)(request, validation_1.gatewayConfigUpdateSchema);
    if ('error' in result)
        return result.error;
    const body = result.data;
    // Block writes to sensitive paths
    const blockedPaths = ['gateway.auth.password', 'gateway.auth.secret'];
    for (const key of Object.keys(body.updates)) {
        if (blockedPaths.some(bp => key.startsWith(bp))) {
            return server_1.NextResponse.json({ error: `Cannot modify protected field: ${key}` }, { status: 403 });
        }
    }
    try {
        const { readFile, writeFile } = require('fs/promises');
        const raw = await readFile(configPath, 'utf-8');
        // Hash-based concurrency check
        const clientHash = body.hash;
        if (clientHash) {
            const serverHash = computeHash(raw);
            if (clientHash !== serverHash) {
                return server_1.NextResponse.json({ error: 'Config has been modified by another user. Please reload and try again.', code: 'CONFLICT' }, { status: 409 });
            }
        }
        const parsed = JSON.parse(raw);
        for (const dotPath of Object.keys(body.updates)) {
            const [rootKey] = dotPath.split('.');
            if (!rootKey || !(rootKey in parsed)) {
                return server_1.NextResponse.json({ error: `Unknown config root: ${rootKey || dotPath}` }, { status: 400 });
            }
        }
        // Apply updates via dot-notation
        const appliedKeys = [];
        for (const [dotPath, value] of Object.entries(body.updates)) {
            setNestedValue(parsed, dotPath, value);
            appliedKeys.push(dotPath);
        }
        // Write back with pretty formatting
        const newRaw = JSON.stringify(parsed, null, 2) + '\n';
        await writeFile(configPath, newRaw);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'gateway_config_update',
            actor: auth.user.username,
            actor_id: auth.user.id,
            detail: { updated_keys: appliedKeys },
            ip_address: ipAddress,
        });
        return server_1.NextResponse.json({
            updated: appliedKeys,
            count: appliedKeys.length,
            hash: computeHash(newRaw),
        });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: `Failed to update config: ${err.message}` }, { status: 500 });
    }
}
async function applyConfig(request, auth) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(gatewayUrl('/api/config/apply'), {
            method: 'POST',
            signal: controller.signal,
            headers: gatewayHeaders(),
        });
        clearTimeout(timeout);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'gateway_config_apply',
            actor: auth.user.username,
            actor_id: auth.user.id,
            detail: { status: res.status },
            ip_address: ipAddress,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            return server_1.NextResponse.json({ error: `Apply failed (${res.status}): ${text}` }, { status: 502 });
        }
        const data = await res.json().catch(() => ({}));
        return server_1.NextResponse.json(Object.assign({ ok: true }, data));
    }
    catch (err) {
        clearTimeout(timeout);
        return server_1.NextResponse.json({ error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' }, { status: 502 });
    }
}
async function updateSystem(request, auth) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(gatewayUrl('/api/config/update'), {
            method: 'POST',
            signal: controller.signal,
            headers: gatewayHeaders(),
        });
        clearTimeout(timeout);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'gateway_config_system_update',
            actor: auth.user.username,
            actor_id: auth.user.id,
            detail: { status: res.status },
            ip_address: ipAddress,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            return server_1.NextResponse.json({ error: `Update failed (${res.status}): ${text}` }, { status: 502 });
        }
        const data = await res.json().catch(() => ({}));
        return server_1.NextResponse.json(Object.assign({ ok: true }, data));
    }
    catch (err) {
        clearTimeout(timeout);
        return server_1.NextResponse.json({ error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' }, { status: 502 });
    }
}
/** Set a value in a nested object using dot-notation path */
function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === undefined)
            current[keys[i]] = {};
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}
/** Redact sensitive values for display */
function redactSensitive(obj, parentKey = '') {
    if (typeof obj !== 'object' || obj === null)
        return obj;
    const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'apiKey'];
    for (const key of Object.keys(obj)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
            if (typeof obj[key] === 'string' && obj[key].length > 0) {
                obj[key] = '--------';
            }
        }
        else if (typeof obj[key] === 'object' && obj[key] !== null) {
            redactSensitive(obj[key], key);
        }
    }
    return obj;
}
