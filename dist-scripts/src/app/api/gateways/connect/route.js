"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const gateway_url_1 = require("@/lib/gateway-url");
const gateway_runtime_1 = require("@/lib/gateway-runtime");
const tailscale_serve_1 = require("@/lib/tailscale-serve");
function inferBrowserProtocol(request) {
    var _a;
    const forwardedProto = (_a = String(request.headers.get('x-forwarded-proto') || '').split(',')[0]) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
    if (forwardedProto === 'https')
        return 'https:';
    if (forwardedProto === 'http')
        return 'http:';
    const origin = request.headers.get('origin') || request.headers.get('referer') || '';
    if (origin) {
        try {
            const parsed = new URL(origin);
            if (parsed.protocol === 'https:')
                return 'https:';
            if (parsed.protocol === 'http:')
                return 'http:';
        }
        catch (_b) {
            // ignore and continue fallback resolution
        }
    }
    if (request.nextUrl.protocol === 'https:')
        return 'https:';
    return 'http:';
}
const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
/** Extract the browser-facing hostname from the request. */
function getBrowserHostname(request) {
    const origin = request.headers.get('origin') || request.headers.get('referer') || '';
    if (origin) {
        try {
            return new URL(origin).hostname;
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
    const hostHeader = request.headers.get('host') || '';
    return hostHeader.split(':')[0];
}
/**
 * When the gateway is on localhost but the browser is remote, resolve the
 * correct WebSocket URL the browser should use.
 *
 * - Tailscale Serve mode: `wss://<dashboard-host>/gw` (Tailscale proxies /gw to localhost gateway)
 * - Otherwise: rewrite host to dashboard hostname with the gateway port
 */
function resolveRemoteGatewayUrl(gateway, request) {
    const normalized = (gateway.host || '').toLowerCase().trim();
    if (!LOCALHOST_HOSTS.has(normalized))
        return null; // remote host — use normal path
    const browserHost = getBrowserHostname(request);
    if (!browserHost || LOCALHOST_HOSTS.has(browserHost.toLowerCase()))
        return null; // local access
    // Browser is remote — determine the correct proxied URL
    if ((0, tailscale_serve_1.isTailscaleServe)()) {
        // Check for a /gw path-based proxy first
        (0, tailscale_serve_1.refreshTailscaleCache)();
        const web = (0, tailscale_serve_1.getCachedTailscaleWeb)();
        if ((0, tailscale_serve_1.hasGwPathHandler)(web)) {
            return `wss://${browserHost}/gw`;
        }
        // Port-based proxy: find the Tailscale Serve port that proxies to the gateway port
        const tsPort = (0, tailscale_serve_1.findTailscaleServePort)(web, gateway.port);
        if (tsPort) {
            return `wss://${browserHost}:${tsPort}`;
        }
    }
    // No Tailscale Serve — try direct connection to dashboard host on gateway port
    const protocol = inferBrowserProtocol(request) === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${browserHost}:${gateway.port}`;
}
function ensureTable(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}
/**
 * POST /api/gateways/connect
 * Resolves websocket URL and token for a selected gateway without exposing tokens in list payloads.
 */
async function POST(request) {
    // Any authenticated dashboard user may initiate a gateway websocket connect.
    // Restricting this to operator can cause startup fallback to connect without auth,
    // which then fails as "device identity required".
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    ensureTable(db);
    let id = null;
    try {
        const body = await request.json();
        id = Number(body === null || body === void 0 ? void 0 : body.id);
    }
    catch (_a) {
        return server_1.NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (!id || !Number.isInteger(id) || id < 1) {
        return server_1.NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const gateway = db.prepare('SELECT id, host, port, token, is_primary FROM gateways WHERE id = ?').get(id);
    if (!gateway) {
        return server_1.NextResponse.json({ error: 'Gateway not found' }, { status: 404 });
    }
    // Prefer an explicitly configured browser WebSocket URL when provided.
    // This is required for reverse-proxy setups where the browser-facing gateway
    // lives on a different host/path than the server-side localhost gateway.
    const explicitBrowserWsUrl = String(process.env.NEXT_PUBLIC_GATEWAY_URL || '').trim();
    // When gateway host is localhost but the browser is remote (e.g. Tailscale),
    // resolve the correct browser-accessible WebSocket URL.
    const remoteUrl = explicitBrowserWsUrl || resolveRemoteGatewayUrl(gateway, request);
    const ws_url = remoteUrl || (0, gateway_url_1.buildGatewayWebSocketUrl)({
        host: gateway.host,
        port: gateway.port,
        browserProtocol: inferBrowserProtocol(request),
    });
    const dbToken = (gateway.token || '').trim();
    const detectedToken = gateway.is_primary === 1 ? (0, gateway_runtime_1.getDetectedGatewayToken)() : '';
    const token = detectedToken || dbToken;
    // Keep runtime DB aligned with detected OpenClaw gateway token for primary gateway.
    if (gateway.is_primary === 1 && detectedToken && detectedToken !== dbToken) {
        try {
            db.prepare('UPDATE gateways SET token = ?, updated_at = (unixepoch()) WHERE id = ?').run(detectedToken, gateway.id);
        }
        catch (_b) {
            // Non-fatal: connect still succeeds with detected token even if persistence fails.
        }
    }
    return server_1.NextResponse.json({
        id: gateway.id,
        ws_url,
        token,
        token_set: token.length > 0,
    });
}
