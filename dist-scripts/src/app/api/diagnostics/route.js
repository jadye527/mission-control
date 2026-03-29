"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = require("node:fs");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const db_1 = require("@/lib/db");
const command_1 = require("@/lib/command");
const logger_1 = require("@/lib/logger");
const version_1 = require("@/lib/version");
const INSECURE_PASSWORDS = new Set([
    'admin',
    'password',
    'change-me-on-first-login',
    'changeme',
    'testpass123',
]);
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const [version, security, database, agents, sessions, gateway] = await Promise.all([
            getVersionInfo(),
            getSecurityInfo(),
            getDatabaseInfo(),
            getAgentInfo(),
            getSessionInfo(),
            getGatewayInfo(),
        ]);
        return server_1.NextResponse.json({
            system: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                processMemory: process.memoryUsage(),
                processUptime: process.uptime(),
                isDocker: (0, node_fs_1.existsSync)('/.dockerenv'),
            },
            version,
            security,
            database,
            agents,
            sessions,
            gateway,
            retention: config_1.config.retention,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Diagnostics API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function getVersionInfo() {
    let openclaw = null;
    try {
        const { stdout } = await (0, command_1.runOpenClaw)(['--version'], { timeoutMs: 3000 });
        openclaw = stdout.trim();
    }
    catch (_a) {
        // openclaw not available
    }
    return { app: version_1.APP_VERSION, openclaw };
}
function getSecurityInfo() {
    const checks = [];
    const apiKey = process.env.API_KEY || '';
    checks.push({
        name: 'API key configured',
        pass: Boolean(apiKey) && apiKey !== 'generate-a-random-key',
        detail: !apiKey ? 'API_KEY is not set' : apiKey === 'generate-a-random-key' ? 'API_KEY is default value' : 'API_KEY is set',
    });
    const authPass = process.env.AUTH_PASS || '';
    checks.push({
        name: 'Auth password secure',
        pass: Boolean(authPass) && !INSECURE_PASSWORDS.has(authPass),
        detail: !authPass ? 'AUTH_PASS is not set' : INSECURE_PASSWORDS.has(authPass) ? 'AUTH_PASS is a known insecure password' : 'AUTH_PASS is not a common default',
    });
    const allowedHosts = process.env.MC_ALLOWED_HOSTS || '';
    checks.push({
        name: 'Allowed hosts configured',
        pass: Boolean(allowedHosts.trim()),
        detail: allowedHosts.trim() ? 'MC_ALLOWED_HOSTS is configured' : 'MC_ALLOWED_HOSTS is not set',
    });
    const sameSite = process.env.MC_COOKIE_SAMESITE || '';
    checks.push({
        name: 'Cookie SameSite strict',
        pass: sameSite.toLowerCase() === 'strict',
        detail: sameSite ? `MC_COOKIE_SAMESITE is '${sameSite}'` : 'MC_COOKIE_SAMESITE is not set',
    });
    const hsts = process.env.MC_ENABLE_HSTS || '';
    checks.push({
        name: 'HSTS enabled',
        pass: hsts === '1',
        detail: hsts === '1' ? 'HSTS is enabled' : 'MC_ENABLE_HSTS is not set to 1',
    });
    const rateLimitDisabled = process.env.MC_DISABLE_RATE_LIMIT || '';
    checks.push({
        name: 'Rate limiting enabled',
        pass: !rateLimitDisabled,
        detail: rateLimitDisabled ? 'Rate limiting is disabled' : 'Rate limiting is active',
    });
    const gwHost = config_1.config.gatewayHost;
    checks.push({
        name: 'Gateway bound to localhost',
        pass: gwHost === '127.0.0.1' || gwHost === 'localhost',
        detail: `Gateway host is '${gwHost}'`,
    });
    const passing = checks.filter(c => c.pass).length;
    const score = Math.round((passing / checks.length) * 100);
    return { score, checks };
}
function getDatabaseInfo() {
    var _a;
    try {
        const db = (0, db_1.getDatabase)();
        let sizeBytes = 0;
        try {
            sizeBytes = (0, node_fs_1.statSync)(config_1.config.dbPath).size;
        }
        catch (_b) {
            // ignore
        }
        const journalRow = db.prepare('PRAGMA journal_mode').get();
        const walMode = (journalRow === null || journalRow === void 0 ? void 0 : journalRow.journal_mode) === 'wal';
        let migrationVersion = null;
        try {
            const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").get();
            if (row === null || row === void 0 ? void 0 : row.name) {
                const latest = db.prepare('SELECT version FROM migrations ORDER BY rowid DESC LIMIT 1').get();
                migrationVersion = (_a = latest === null || latest === void 0 ? void 0 : latest.version) !== null && _a !== void 0 ? _a : null;
            }
        }
        catch (_c) {
            // migrations table may not exist
        }
        return { sizeBytes, walMode, migrationVersion };
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Diagnostics: database info error');
        return { sizeBytes: 0, walMode: false, migrationVersion: null };
    }
}
function getAgentInfo() {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare('SELECT status, COUNT(*) as count FROM agents GROUP BY status').all();
        const byStatus = {};
        let total = 0;
        for (const row of rows) {
            byStatus[row.status] = row.count;
            total += row.count;
        }
        return { total, byStatus };
    }
    catch (_a) {
        return { total: 0, byStatus: {} };
    }
}
function getSessionInfo() {
    var _a, _b;
    try {
        const db = (0, db_1.getDatabase)();
        const totalRow = db.prepare('SELECT COUNT(*) as c FROM claude_sessions').get();
        const activeRow = db.prepare("SELECT COUNT(*) as c FROM claude_sessions WHERE is_active = 1").get();
        return { active: (_a = activeRow === null || activeRow === void 0 ? void 0 : activeRow.c) !== null && _a !== void 0 ? _a : 0, total: (_b = totalRow === null || totalRow === void 0 ? void 0 : totalRow.c) !== null && _b !== void 0 ? _b : 0 };
    }
    catch (_c) {
        return { active: 0, total: 0 };
    }
}
async function getGatewayInfo() {
    const host = config_1.config.gatewayHost;
    const port = config_1.config.gatewayPort;
    const configured = Boolean(host && port);
    let reachable = false;
    if (configured) {
        reachable = await new Promise((resolve) => {
            const socket = new node_net_1.default.Socket();
            socket.setTimeout(1500);
            socket.once('connect', () => { socket.destroy(); resolve(true); });
            socket.once('timeout', () => { socket.destroy(); resolve(false); });
            socket.once('error', () => { socket.destroy(); resolve(false); });
            socket.connect(port, host);
        });
    }
    return { configured, reachable, host, port };
}
