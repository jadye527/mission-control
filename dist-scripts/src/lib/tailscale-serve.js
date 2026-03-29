"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execTailscaleServeJson = execTailscaleServeJson;
exports.findTailscaleServePort = findTailscaleServePort;
exports.detectTailscaleServe = detectTailscaleServe;
exports.hasGwPathHandler = hasGwPathHandler;
exports.refreshTailscaleCache = refreshTailscaleCache;
exports.getCachedTailscaleWeb = getCachedTailscaleWeb;
exports.isTailscaleServe = isTailscaleServe;
exports._resetCaches = _resetCaches;
const node_fs_1 = require("node:fs");
/** Tailscale CLI binary paths to try (macOS app bundle, then PATH). */
const TAILSCALE_BINS = [
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    'tailscale',
];
function execTailscaleServeJson() {
    const { execFileSync } = require('node:child_process');
    for (const bin of TAILSCALE_BINS) {
        try {
            const raw = execFileSync(bin, ['serve', 'status', '--json'], {
                timeout: 3000,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            return JSON.parse(raw);
        }
        catch (_a) {
            continue;
        }
    }
    return null;
}
/**
 * Find the Tailscale Serve port that proxies to a given local port.
 *
 * Looks through the `Web` section of `tailscale serve status --json` for any
 * handler whose Proxy target points at localhost:<targetPort>. Returns the
 * external Tailscale Serve port (e.g. 8443) or null if not found.
 */
function findTailscaleServePort(web, targetPort) {
    if (!web)
        return null;
    const targetSuffixes = [`:${targetPort}`, `:${targetPort}/`];
    for (const [hostPort, hostConfig] of Object.entries(web)) {
        const handlers = hostConfig === null || hostConfig === void 0 ? void 0 : hostConfig.Handlers;
        if (!handlers)
            continue;
        for (const handler of Object.values(handlers)) {
            const proxy = (handler === null || handler === void 0 ? void 0 : handler.Proxy) || '';
            if (targetSuffixes.some(s => proxy.endsWith(s) || proxy === `http://127.0.0.1:${targetPort}` || proxy === `http://localhost:${targetPort}`)) {
                // hostPort is like "hostname:8443"
                const port = parseInt(hostPort.split(':').pop() || '', 10);
                if (port > 0)
                    return port;
            }
        }
    }
    return null;
}
/**
 * Detect whether Tailscale Serve is proxying to the gateway.
 *
 * Checks the Web config for:
 * 1. A `/gw` path handler (authoritative)
 * 2. Any handler proxying to port 18789 (port-based proxy)
 * 3. Fallback: `gateway.tailscale.mode === 'serve'` in openclaw.json (legacy)
 */
function detectTailscaleServe(web, configPath) {
    var _a, _b;
    if (web) {
        for (const hostConfig of Object.values(web)) {
            const handlers = hostConfig === null || hostConfig === void 0 ? void 0 : hostConfig.Handlers;
            if (!handlers)
                continue;
            if (handlers['/gw'])
                return true;
            // Also detect port-based proxy to gateway (e.g. :8443 → localhost:18789)
            for (const handler of Object.values(handlers)) {
                const proxy = (handler === null || handler === void 0 ? void 0 : handler.Proxy) || '';
                if (proxy.includes(':18789'))
                    return true;
            }
        }
    }
    // Legacy: check openclaw.json config
    const effectivePath = configPath || process.env.OPENCLAW_CONFIG_PATH || '';
    if (!effectivePath)
        return false;
    try {
        const raw = (0, node_fs_1.readFileSync)(effectivePath, 'utf-8');
        const config = JSON.parse(raw);
        return ((_b = (_a = config === null || config === void 0 ? void 0 : config.gateway) === null || _a === void 0 ? void 0 : _a.tailscale) === null || _b === void 0 ? void 0 : _b.mode) === 'serve';
    }
    catch (_c) {
        return false;
    }
}
/**
 * Check whether any Tailscale Serve handler has a `/gw` path.
 */
function hasGwPathHandler(web) {
    var _a;
    if (!web)
        return false;
    for (const hostConfig of Object.values(web)) {
        if ((_a = hostConfig === null || hostConfig === void 0 ? void 0 : hostConfig.Handlers) === null || _a === void 0 ? void 0 : _a['/gw'])
            return true;
    }
    return false;
}
/** Cache Tailscale Serve JSON with 60-second TTL. */
let _tailscaleServeJsonCache = null;
let _tailscaleServeCache = null;
const TAILSCALE_CACHE_TTL_MS = 60000;
function refreshTailscaleCache() {
    const now = Date.now();
    if (!_tailscaleServeJsonCache || now > _tailscaleServeJsonCache.expiresAt) {
        _tailscaleServeJsonCache = { value: execTailscaleServeJson(), expiresAt: now + TAILSCALE_CACHE_TTL_MS };
        _tailscaleServeCache = null; // invalidate derived cache
    }
}
function getCachedTailscaleWeb() {
    var _a, _b;
    return (_b = (_a = _tailscaleServeJsonCache === null || _tailscaleServeJsonCache === void 0 ? void 0 : _tailscaleServeJsonCache.value) === null || _a === void 0 ? void 0 : _a.Web) !== null && _b !== void 0 ? _b : null;
}
function isTailscaleServe() {
    refreshTailscaleCache();
    const now = Date.now();
    if (!_tailscaleServeCache || now > _tailscaleServeCache.expiresAt) {
        _tailscaleServeCache = { value: detectTailscaleServe(getCachedTailscaleWeb()), expiresAt: now + TAILSCALE_CACHE_TTL_MS };
    }
    return _tailscaleServeCache.value;
}
/** Reset caches — for testing only. */
function _resetCaches() {
    _tailscaleServeJsonCache = null;
    _tailscaleServeCache = null;
}
