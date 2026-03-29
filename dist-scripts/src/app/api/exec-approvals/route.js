"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.POST = POST;
const server_1 = require("next/server");
const node_crypto_1 = require("node:crypto");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const node_path_1 = __importDefault(require("node:path"));
function gatewayUrl(p) {
    return `http://${config_1.config.gatewayHost}:${config_1.config.gatewayPort}${p}`;
}
function execApprovalsPath() {
    return node_path_1.default.join(config_1.config.openclawHome, 'exec-approvals.json');
}
function computeHash(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw, 'utf8').digest('hex');
}
/**
 * GET /api/exec-approvals - Fetch pending execution approval requests
 * GET /api/exec-approvals?action=allowlist - Fetch per-agent allowlists
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const action = request.nextUrl.searchParams.get('action');
    if (action === 'allowlist') {
        return getAllowlist();
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(gatewayUrl('/api/exec-approvals'), {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        });
        clearTimeout(timeout);
        if (!res.ok) {
            logger_1.logger.warn({ status: res.status }, 'Gateway exec-approvals endpoint returned error');
            return server_1.NextResponse.json({ approvals: [] });
        }
        const data = await res.json();
        return server_1.NextResponse.json(data);
    }
    catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            logger_1.logger.warn('Gateway exec-approvals request timed out');
        }
        else {
            logger_1.logger.warn({ err }, 'Gateway exec-approvals unreachable');
        }
        return server_1.NextResponse.json({ approvals: [] });
    }
}
async function getAllowlist() {
    const filePath = execApprovalsPath();
    try {
        const { readFile } = require('fs/promises');
        const raw = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const agents = {};
        if ((parsed === null || parsed === void 0 ? void 0 : parsed.agents) && typeof parsed.agents === 'object') {
            for (const [agentId, agentConfig] of Object.entries(parsed.agents)) {
                const cfg = agentConfig;
                if (Array.isArray(cfg === null || cfg === void 0 ? void 0 : cfg.allowlist)) {
                    agents[agentId] = cfg.allowlist.map((e) => { var _a; return ({ pattern: String((_a = e === null || e === void 0 ? void 0 : e.pattern) !== null && _a !== void 0 ? _a : '') }); });
                }
                else {
                    agents[agentId] = [];
                }
            }
        }
        return server_1.NextResponse.json({ agents, hash: computeHash(raw) });
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return server_1.NextResponse.json({ agents: {}, hash: computeHash('') });
        }
        logger_1.logger.warn({ err }, 'Failed to read exec-approvals config');
        return server_1.NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 });
    }
}
/**
 * PUT /api/exec-approvals - Save allowlist changes
 * Body: { agents: Record<string, { pattern: string }[]>, hash?: string }
 */
async function PUT(request) {
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
    if (!body.agents || typeof body.agents !== 'object') {
        return server_1.NextResponse.json({ error: 'Missing required field: agents' }, { status: 400 });
    }
    const filePath = execApprovalsPath();
    try {
        const { readFile, writeFile, mkdir } = require('fs/promises');
        const { existsSync } = require('fs');
        let parsed = { version: 1, agents: {} };
        try {
            const raw = await readFile(filePath, 'utf-8');
            parsed = JSON.parse(raw);
            if (body.hash) {
                const serverHash = computeHash(raw);
                if (body.hash !== serverHash) {
                    return server_1.NextResponse.json({ error: 'Config has been modified. Please reload and try again.', code: 'CONFLICT' }, { status: 409 });
                }
            }
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
        if (!parsed.agents)
            parsed.agents = {};
        for (const [agentId, patterns] of Object.entries(body.agents)) {
            if (!parsed.agents[agentId])
                parsed.agents[agentId] = {};
            if (patterns.length === 0) {
                delete parsed.agents[agentId].allowlist;
            }
            else {
                parsed.agents[agentId].allowlist = patterns.map((p) => {
                    var _a;
                    return ({
                        pattern: String((_a = p.pattern) !== null && _a !== void 0 ? _a : ''),
                    });
                });
            }
        }
        const dir = node_path_1.default.dirname(filePath);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
        const newRaw = JSON.stringify(parsed, null, 2) + '\n';
        await writeFile(filePath, newRaw, { mode: 0o600 });
        return server_1.NextResponse.json({ ok: true, hash: computeHash(newRaw) });
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to save exec-approvals config');
        return server_1.NextResponse.json({ error: `Failed to save: ${err.message}` }, { status: 500 });
    }
}
/**
 * POST /api/exec-approvals - Respond to an execution approval request
 * Body: { id: string, action: 'approve' | 'deny' | 'always_allow', reason?: string }
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
    if (!body.id || typeof body.id !== 'string') {
        return server_1.NextResponse.json({ error: 'Missing required field: id' }, { status: 400 });
    }
    const validActions = ['approve', 'deny', 'always_allow'];
    if (!validActions.includes(body.action)) {
        return server_1.NextResponse.json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, { status: 400 });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(gatewayUrl('/api/exec-approvals/respond'), {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: body.id,
                action: body.action,
                reason: body.reason,
            }),
        });
        clearTimeout(timeout);
        const data = await res.json();
        return server_1.NextResponse.json(data, { status: res.status });
    }
    catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            logger_1.logger.error('Gateway exec-approvals respond request timed out');
            return server_1.NextResponse.json({ error: 'Gateway request timed out' }, { status: 504 });
        }
        logger_1.logger.error({ err }, 'Gateway exec-approvals respond failed');
        return server_1.NextResponse.json({ error: 'Gateway unreachable' }, { status: 502 });
    }
}
