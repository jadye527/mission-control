"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const gateway_runtime_1 = require("@/lib/gateway-runtime");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
const gatewayInternalUrl = `http://${config_1.config.gatewayHost}:${config_1.config.gatewayPort}`;
function gatewayHeaders() {
    const token = (0, gateway_runtime_1.getDetectedGatewayToken)();
    const headers = { 'Content-Type': 'application/json' };
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    return headers;
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : null;
}
function readBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function readString(value) {
    return typeof value === 'string' ? value : undefined;
}
function readNumber(value) {
    return typeof value === 'number' ? value : undefined;
}
function transformGatewayChannels(data) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const parsed = asRecord(data);
    const rawChannels = (_a = asRecord(parsed === null || parsed === void 0 ? void 0 : parsed.channels)) !== null && _a !== void 0 ? _a : {};
    const rawAccounts = (_b = asRecord(parsed === null || parsed === void 0 ? void 0 : parsed.channelAccounts)) !== null && _b !== void 0 ? _b : {};
    const channelLabels = asRecord(parsed === null || parsed === void 0 ? void 0 : parsed.channelLabels);
    const order = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.channelOrder)
        ? parsed.channelOrder.filter((value) => typeof value === 'string')
        : Object.keys(rawChannels);
    const channels = {};
    const channelAccounts = {};
    const labels = Object.fromEntries(Object.entries(channelLabels !== null && channelLabels !== void 0 ? channelLabels : {}).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []));
    for (const key of order) {
        const ch = asRecord(rawChannels[key]);
        if (!ch)
            continue;
        channels[key] = {
            configured: !!readBoolean(ch.configured),
            linked: readBoolean(ch.linked),
            running: !!readBoolean(ch.running),
            connected: readBoolean(ch.connected),
            lastConnectedAt: (_c = readNumber(ch.lastConnectedAt)) !== null && _c !== void 0 ? _c : null,
            lastMessageAt: (_d = readNumber(ch.lastMessageAt)) !== null && _d !== void 0 ? _d : null,
            lastStartAt: (_e = readNumber(ch.lastStartAt)) !== null && _e !== void 0 ? _e : null,
            lastError: (_f = readString(ch.lastError)) !== null && _f !== void 0 ? _f : null,
            authAgeMs: (_g = readNumber(ch.authAgeMs)) !== null && _g !== void 0 ? _g : null,
            mode: (_h = readString(ch.mode)) !== null && _h !== void 0 ? _h : null,
            baseUrl: (_j = readString(ch.baseUrl)) !== null && _j !== void 0 ? _j : null,
            publicKey: (_k = readString(ch.publicKey)) !== null && _k !== void 0 ? _k : null,
            probe: (_l = ch.probe) !== null && _l !== void 0 ? _l : null,
            profile: (_m = ch.profile) !== null && _m !== void 0 ? _m : null,
        };
        const accounts = rawAccounts[key] || [];
        const accountEntries = (Array.isArray(accounts) ? accounts : Object.values(accounts));
        channelAccounts[key] = accountEntries.map((acct) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
            const parsedAccount = (_a = asRecord(acct)) !== null && _a !== void 0 ? _a : {};
            return {
                accountId: (_b = readString(parsedAccount.accountId)) !== null && _b !== void 0 ? _b : 'default',
                name: (_c = readString(parsedAccount.name)) !== null && _c !== void 0 ? _c : null,
                configured: (_d = readBoolean(parsedAccount.configured)) !== null && _d !== void 0 ? _d : null,
                linked: (_e = readBoolean(parsedAccount.linked)) !== null && _e !== void 0 ? _e : null,
                running: (_f = readBoolean(parsedAccount.running)) !== null && _f !== void 0 ? _f : null,
                connected: (_g = readBoolean(parsedAccount.connected)) !== null && _g !== void 0 ? _g : null,
                lastConnectedAt: (_h = readNumber(parsedAccount.lastConnectedAt)) !== null && _h !== void 0 ? _h : null,
                lastInboundAt: (_j = readNumber(parsedAccount.lastInboundAt)) !== null && _j !== void 0 ? _j : null,
                lastOutboundAt: (_k = readNumber(parsedAccount.lastOutboundAt)) !== null && _k !== void 0 ? _k : null,
                lastError: (_l = readString(parsedAccount.lastError)) !== null && _l !== void 0 ? _l : null,
                lastStartAt: (_m = readNumber(parsedAccount.lastStartAt)) !== null && _m !== void 0 ? _m : null,
                mode: (_o = readString(parsedAccount.mode)) !== null && _o !== void 0 ? _o : null,
                probe: (_p = parsedAccount.probe) !== null && _p !== void 0 ? _p : null,
                publicKey: (_q = readString(parsedAccount.publicKey)) !== null && _q !== void 0 ? _q : null,
                profile: (_r = parsedAccount.profile) !== null && _r !== void 0 ? _r : null,
            };
        });
    }
    return {
        channels,
        channelAccounts,
        channelOrder: order,
        channelLabels: labels,
        connected: true,
        updatedAt: readNumber(parsed === null || parsed === void 0 ? void 0 : parsed.ts),
    };
}
async function loadChannelsViaRpc(probe = false) {
    const payload = await (0, openclaw_gateway_1.callOpenClawGateway)('channels.status', { probe, timeoutMs: 8000 }, probe ? 20000 : 15000);
    return Object.assign(Object.assign({}, transformGatewayChannels(payload)), { connected: true });
}
async function loadChannelsViaCli(probe = false) {
    const payload = await (0, openclaw_gateway_1.callOpenClawGateway)('channels.status', { probe, timeoutMs: 8000 }, probe ? 20000 : 15000).catch(() => null);
    if (payload) {
        return Object.assign(Object.assign({}, transformGatewayChannels(payload)), { connected: true });
    }
    const { runOpenClaw } = await Promise.resolve().then(() => __importStar(require('@/lib/command')));
    const args = ['channels', 'status', '--json', '--timeout', '5000'];
    if (probe)
        args.push('--probe');
    const { stdout } = await runOpenClaw(args, { timeoutMs: probe ? 20000 : 15000 });
    return Object.assign(Object.assign({}, transformGatewayChannels(JSON.parse(stdout))), { connected: true });
}
async function isGatewayReachable() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${gatewayInternalUrl}/api/health`, {
            headers: gatewayHeaders(),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.ok;
    }
    catch (_a) {
        return false;
    }
}
/**
 * GET /api/channels - Fetch channel status from the gateway
 * Supports ?action=probe&channel=<name> to probe a specific channel
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    // Probe a specific channel
    if (action === 'probe') {
        const channel = searchParams.get('channel');
        if (!channel) {
            return server_1.NextResponse.json({ error: 'channel parameter required' }, { status: 400 });
        }
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${gatewayInternalUrl}/api/channels/probe`, {
                method: 'POST',
                headers: gatewayHeaders(),
                body: JSON.stringify({ channel }),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) {
                if (res.status === 404) {
                    return server_1.NextResponse.json(await loadChannelsViaRpc(true).catch(() => loadChannelsViaCli(true)));
                }
                throw new Error(`Gateway channel probe failed with status ${res.status}`);
            }
            const data = await res.json();
            return server_1.NextResponse.json(data);
        }
        catch (err) {
            try {
                return server_1.NextResponse.json(await loadChannelsViaRpc(true).catch(() => loadChannelsViaCli(true)));
            }
            catch (cliErr) {
                logger_1.logger.warn({ err, cliErr, channel }, 'Channel probe failed');
                return server_1.NextResponse.json({ ok: false, error: 'Gateway unreachable' }, { status: 502 });
            }
        }
    }
    // Default: fetch all channel statuses
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${gatewayInternalUrl}/api/channels/status`, {
            headers: gatewayHeaders(),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
            if (res.status === 404) {
                return server_1.NextResponse.json(await loadChannelsViaRpc(false).catch(() => loadChannelsViaCli(false)));
            }
            throw new Error(`Gateway channel status failed with status ${res.status}`);
        }
        const data = await res.json();
        return server_1.NextResponse.json(transformGatewayChannels(data));
    }
    catch (err) {
        try {
            return server_1.NextResponse.json(await loadChannelsViaRpc(false).catch(() => loadChannelsViaCli(false)));
        }
        catch (cliErr) {
            logger_1.logger.warn({ err, cliErr }, 'Gateway unreachable for channel status');
            const reachable = await isGatewayReachable();
            return server_1.NextResponse.json({
                channels: {},
                channelAccounts: {},
                channelOrder: [],
                channelLabels: {},
                connected: reachable,
            });
        }
    }
}
/**
 * POST /api/channels - Platform-specific actions
 * Body: { action: string, ...params }
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => null);
    if (!body || !body.action) {
        return server_1.NextResponse.json({ error: 'action required' }, { status: 400 });
    }
    const { action } = body;
    try {
        switch (action) {
            case 'whatsapp-link': {
                const force = body.force === true;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 30000);
                    const res = await fetch(`${gatewayInternalUrl}/api/channels/whatsapp/link`, {
                        method: 'POST',
                        headers: gatewayHeaders(),
                        body: JSON.stringify({ force }),
                        signal: controller.signal,
                    });
                    clearTimeout(timeout);
                    if (res.ok) {
                        const data = await res.json();
                        return server_1.NextResponse.json(data);
                    }
                    if (res.status !== 404) {
                        const data = await res.json().catch(() => ({}));
                        return server_1.NextResponse.json(data, { status: res.status });
                    }
                }
                catch (_a) {
                    // Fallback to RPC below.
                }
                return server_1.NextResponse.json(await (0, openclaw_gateway_1.callOpenClawGateway)('web.login.start', { force, timeoutMs: 30000 }, 32000));
            }
            case 'whatsapp-wait': {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 120000);
                    const res = await fetch(`${gatewayInternalUrl}/api/channels/whatsapp/wait`, {
                        method: 'POST',
                        headers: gatewayHeaders(),
                        signal: controller.signal,
                    });
                    clearTimeout(timeout);
                    if (res.ok) {
                        const data = await res.json();
                        return server_1.NextResponse.json(data);
                    }
                    if (res.status !== 404) {
                        const data = await res.json().catch(() => ({}));
                        return server_1.NextResponse.json(data, { status: res.status });
                    }
                }
                catch (_b) {
                    // Fallback to RPC below.
                }
                return server_1.NextResponse.json(await (0, openclaw_gateway_1.callOpenClawGateway)('web.login.wait', { timeoutMs: 120000 }, 122000));
            }
            case 'whatsapp-logout': {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    const res = await fetch(`${gatewayInternalUrl}/api/channels/whatsapp/logout`, {
                        method: 'POST',
                        headers: gatewayHeaders(),
                        signal: controller.signal,
                    });
                    clearTimeout(timeout);
                    if (res.ok) {
                        const data = await res.json();
                        return server_1.NextResponse.json(data);
                    }
                    if (res.status !== 404) {
                        const data = await res.json().catch(() => ({}));
                        return server_1.NextResponse.json(data, { status: res.status });
                    }
                }
                catch (_c) {
                    // Fallback to RPC below.
                }
                return server_1.NextResponse.json(await (0, openclaw_gateway_1.callOpenClawGateway)('channels.logout', { channel: 'whatsapp' }, 12000));
            }
            case 'nostr-profile-save': {
                const accountId = body.accountId || 'default';
                const profile = body.profile;
                if (!profile) {
                    return server_1.NextResponse.json({ error: 'profile required' }, { status: 400 });
                }
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(`${gatewayInternalUrl}/api/channels/nostr/${encodeURIComponent(accountId)}/profile`, {
                    method: 'PUT',
                    headers: gatewayHeaders(),
                    body: JSON.stringify(profile),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                const data = await res.json();
                return server_1.NextResponse.json(data, { status: res.ok ? 200 : res.status });
            }
            case 'nostr-profile-import': {
                const accountId = body.accountId || 'default';
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                const res = await fetch(`${gatewayInternalUrl}/api/channels/nostr/${encodeURIComponent(accountId)}/profile/import`, {
                    method: 'POST',
                    headers: gatewayHeaders(),
                    body: JSON.stringify({ autoMerge: true }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                const data = await res.json();
                return server_1.NextResponse.json(data, { status: res.ok ? 200 : res.status });
            }
            default:
                return server_1.NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    }
    catch (err) {
        logger_1.logger.warn({ err, action }, 'Channel action failed');
        return server_1.NextResponse.json({ ok: false, error: 'Gateway unreachable' }, { status: 502 });
    }
}
