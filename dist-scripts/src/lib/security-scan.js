"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIX_SAFETY = void 0;
exports.runSecurityScan = runSecurityScan;
exports.readSystemUptimeSeconds = readSystemUptimeSeconds;
const node_fs_1 = require("node:fs");
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const config_1 = require("@/lib/config");
const db_1 = require("@/lib/db");
// ---------------------------------------------------------------------------
// Fix safety map — exported for agent endpoint and UI
// ---------------------------------------------------------------------------
exports.FIX_SAFETY = {
    env_permissions: 'safe',
    config_permissions: 'safe',
    world_writable: 'safe',
    hsts_enabled: 'requires-restart',
    cookie_secure: 'requires-restart',
    allowed_hosts: 'requires-restart',
    rate_limiting: 'requires-restart',
    api_key_set: 'requires-restart',
    log_redaction: 'requires-restart',
    dm_isolation: 'requires-restart',
    fs_workspace_only: 'requires-restart',
    exec_restricted: 'requires-review',
    gateway_auth: 'requires-review',
    gateway_bind: 'requires-review',
    elevated_disabled: 'requires-review',
    control_ui_device_auth: 'requires-review',
    control_ui_insecure_auth: 'requires-review',
};
// ---------------------------------------------------------------------------
// Severity-weighted scoring
// ---------------------------------------------------------------------------
const SEVERITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };
const INSECURE_PASSWORDS = new Set([
    'admin', 'password', 'change-me-on-first-login', 'changeme', 'testpass123',
]);
function runSecurityScan() {
    const credentials = scanCredentials();
    const network = scanNetwork();
    const openclaw = scanOpenClaw();
    const runtime = scanRuntime();
    const osLevel = scanOS();
    const categories = { credentials, network, openclaw, runtime, os: osLevel };
    const allChecks = Object.values(categories).flatMap(c => c.checks);
    const weightedMax = allChecks.reduce((s, c) => { var _a; return s + SEVERITY_WEIGHT[(_a = c.severity) !== null && _a !== void 0 ? _a : 'medium']; }, 0);
    const weightedScore = allChecks
        .filter(c => c.status === 'pass')
        .reduce((s, c) => { var _a; return s + SEVERITY_WEIGHT[(_a = c.severity) !== null && _a !== void 0 ? _a : 'medium']; }, 0);
    const score = weightedMax > 0 ? Math.round((weightedScore / weightedMax) * 100) : 0;
    let overall;
    if (score >= 90)
        overall = 'hardened';
    else if (score >= 70)
        overall = 'secure';
    else if (score >= 40)
        overall = 'needs-attention';
    else
        overall = 'at-risk';
    return { overall, score, timestamp: Date.now(), categories };
}
function readSystemUptimeSeconds() {
    try {
        const value = node_os_1.default.uptime();
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    catch (_a) {
        return null;
    }
}
function scoreCategory(checks) {
    const weightedMax = checks.reduce((s, c) => { var _a; return s + SEVERITY_WEIGHT[(_a = c.severity) !== null && _a !== void 0 ? _a : 'medium']; }, 0);
    const weightedScore = checks
        .filter(c => c.status === 'pass')
        .reduce((s, c) => { var _a; return s + SEVERITY_WEIGHT[(_a = c.severity) !== null && _a !== void 0 ? _a : 'medium']; }, 0);
    return { score: weightedMax > 0 ? Math.round((weightedScore / weightedMax) * 100) : 100, checks };
}
// ---------------------------------------------------------------------------
// Exec helpers
// All exec calls below use only hardcoded string literals — no user input.
// ---------------------------------------------------------------------------
function tryExec(cmd, timeout = 5000) {
    try {
        return (0, node_child_process_1.execSync)(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch (_a) {
        return null;
    }
}
const execCache = new Map();
function cachedExec(key, cmd, ttlMs = 60000) {
    const cached = execCache.get(key);
    if (cached && Date.now() - cached.ts < ttlMs)
        return cached.value;
    const value = tryExec(cmd);
    execCache.set(key, { value, ts: Date.now() });
    return value;
}
/**
 * Runs a multi-line script that outputs KEY=VALUE pairs.
 * Returns a map of key -> value. Used to batch multiple sysctl reads.
 */
function tryExecBatch(script) {
    const out = tryExec(script);
    if (!out)
        return {};
    const result = {};
    for (const line of out.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0)
            result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return result;
}
// ---------------------------------------------------------------------------
// Category: Credentials
// ---------------------------------------------------------------------------
function scanCredentials() {
    const checks = [];
    const authPass = process.env.AUTH_PASS || '';
    if (!authPass) {
        checks.push({ id: 'auth_pass', name: 'Admin password configured', status: 'fail', detail: 'AUTH_PASS is not configured', fix: 'Set AUTH_PASS in .env to a strong password (12+ characters)', severity: 'critical' });
    }
    else if (INSECURE_PASSWORDS.has(authPass)) {
        checks.push({ id: 'auth_pass', name: 'Admin password strength', status: 'fail', detail: 'AUTH_PASS is set to a known insecure default', fix: 'Change AUTH_PASS to a unique password with 12+ characters', severity: 'critical' });
    }
    else if (authPass.length < 12) {
        checks.push({ id: 'auth_pass', name: 'Admin password strength', status: 'warn', detail: `AUTH_PASS is only ${authPass.length} characters`, fix: 'Use a password with at least 12 characters', severity: 'critical' });
    }
    else {
        checks.push({ id: 'auth_pass', name: 'Admin password strength', status: 'pass', detail: 'AUTH_PASS is a strong, non-default password', fix: '', severity: 'critical' });
    }
    const apiKey = process.env.API_KEY || '';
    checks.push({
        id: 'api_key_set',
        name: 'API key configured',
        status: apiKey && apiKey !== 'generate-a-random-key' ? 'pass' : 'fail',
        detail: !apiKey ? 'API_KEY is not set' : apiKey === 'generate-a-random-key' ? 'API_KEY uses the default placeholder' : 'API_KEY is configured',
        fix: !apiKey || apiKey === 'generate-a-random-key' ? 'Run: bash scripts/generate-env.sh --force' : '',
        severity: 'critical',
    });
    const envPath = node_path_1.default.join(process.cwd(), '.env');
    if ((0, node_fs_1.existsSync)(envPath)) {
        try {
            const stat = (0, node_fs_1.statSync)(envPath);
            const mode = (stat.mode & 0o777).toString(8);
            checks.push({
                id: 'env_permissions',
                name: '.env file permissions',
                status: mode === '600' ? 'pass' : 'warn',
                detail: `.env permissions are ${mode}`,
                fix: mode !== '600' ? 'Run: chmod 600 .env' : '',
                severity: 'medium',
                fixSafety: 'safe',
            });
        }
        catch (_a) {
            checks.push({ id: 'env_permissions', name: '.env file permissions', status: 'warn', detail: 'Could not check .env permissions', fix: 'Run: chmod 600 .env', severity: 'medium', fixSafety: 'safe' });
        }
    }
    return scoreCategory(checks);
}
// ---------------------------------------------------------------------------
// Category: Network
// ---------------------------------------------------------------------------
function scanNetwork() {
    const checks = [];
    const allowedHosts = (process.env.MC_ALLOWED_HOSTS || '').trim();
    const allowAny = process.env.MC_ALLOW_ANY_HOST;
    checks.push({
        id: 'allowed_hosts',
        name: 'Host allowlist configured',
        status: allowAny === '1' || allowAny === 'true' ? 'fail' : allowedHosts ? 'pass' : 'warn',
        detail: allowAny === '1' || allowAny === 'true' ? 'MC_ALLOW_ANY_HOST is enabled — any host can connect' : allowedHosts ? `MC_ALLOWED_HOSTS: ${allowedHosts}` : 'MC_ALLOWED_HOSTS is not set',
        fix: allowAny ? 'Remove MC_ALLOW_ANY_HOST and set MC_ALLOWED_HOSTS instead' : !allowedHosts ? 'Set MC_ALLOWED_HOSTS=localhost,127.0.0.1 in .env' : '',
        severity: 'high',
    });
    const hsts = process.env.MC_ENABLE_HSTS;
    checks.push({
        id: 'hsts_enabled',
        name: 'HSTS enabled',
        status: hsts === '1' ? 'pass' : 'warn',
        detail: hsts === '1' ? 'Strict-Transport-Security header enabled' : 'HSTS is not enabled',
        fix: hsts !== '1' ? 'Set MC_ENABLE_HSTS=1 in .env (requires HTTPS)' : '',
        severity: 'medium',
    });
    const cookieSecure = process.env.MC_COOKIE_SECURE;
    checks.push({
        id: 'cookie_secure',
        name: 'Secure cookies',
        status: cookieSecure === '1' || cookieSecure === 'true' ? 'pass' : 'warn',
        detail: cookieSecure === '1' || cookieSecure === 'true' ? 'Cookies marked secure' : 'Cookies not explicitly set to secure',
        fix: !(cookieSecure === '1' || cookieSecure === 'true') ? 'Set MC_COOKIE_SECURE=1 in .env (requires HTTPS)' : '',
        severity: 'medium',
    });
    const gwHost = config_1.config.gatewayHost;
    checks.push({
        id: 'gateway_local',
        name: 'Gateway bound to localhost',
        status: gwHost === '127.0.0.1' || gwHost === 'localhost' ? 'pass' : 'fail',
        detail: `Gateway host is ${gwHost}`,
        fix: gwHost !== '127.0.0.1' && gwHost !== 'localhost' ? 'Set OPENCLAW_GATEWAY_HOST=127.0.0.1 — never expose the gateway publicly' : '',
        severity: 'critical',
    });
    return scoreCategory(checks);
}
// ---------------------------------------------------------------------------
// Category: OpenClaw
// ---------------------------------------------------------------------------
function scanOpenClaw() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    const checks = [];
    const configPath = config_1.config.openclawConfigPath;
    if (!configPath || !(0, node_fs_1.existsSync)(configPath)) {
        checks.push({
            id: 'config_found',
            name: 'OpenClaw config found',
            status: 'warn',
            detail: 'openclaw.json not found — OpenClaw checks skipped',
            fix: 'Set OPENCLAW_HOME or OPENCLAW_CONFIG_PATH in .env',
            severity: 'medium',
        });
        return scoreCategory(checks);
    }
    let ocConfig;
    try {
        ocConfig = JSON.parse((0, node_fs_1.readFileSync)(configPath, 'utf-8'));
    }
    catch (err) {
        checks.push({
            id: 'config_valid',
            name: 'OpenClaw config valid',
            status: 'fail',
            detail: 'openclaw.json could not be parsed',
            fix: 'Check openclaw.json for syntax errors',
            severity: 'high',
        });
        return scoreCategory(checks);
    }
    try {
        const stat = (0, node_fs_1.statSync)(configPath);
        const mode = (stat.mode & 0o777).toString(8);
        checks.push({
            id: 'config_permissions',
            name: 'Config file permissions',
            status: mode === '600' ? 'pass' : 'warn',
            detail: `openclaw.json permissions are ${mode}`,
            fix: mode !== '600' ? `Run: chmod 600 ${configPath}` : '',
            severity: 'medium',
            fixSafety: 'safe',
        });
    }
    catch ( /* skip */_x) { /* skip */ }
    const gwAuth = (_a = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.gateway) === null || _a === void 0 ? void 0 : _a.auth;
    const tokenOk = (gwAuth === null || gwAuth === void 0 ? void 0 : gwAuth.mode) === 'token' && ((_b = gwAuth === null || gwAuth === void 0 ? void 0 : gwAuth.token) !== null && _b !== void 0 ? _b : '').trim().length > 0;
    const passwordOk = (gwAuth === null || gwAuth === void 0 ? void 0 : gwAuth.mode) === 'password' && ((_c = gwAuth === null || gwAuth === void 0 ? void 0 : gwAuth.password) !== null && _c !== void 0 ? _c : '').trim().length > 0;
    const authOk = tokenOk || passwordOk;
    checks.push({
        id: 'gateway_auth',
        name: 'Gateway authentication',
        status: authOk ? 'pass' : 'fail',
        detail: tokenOk ? 'Token auth enabled' : passwordOk ? 'Password auth enabled' : `Auth mode: ${(gwAuth === null || gwAuth === void 0 ? void 0 : gwAuth.mode) || 'none'} (credential required)`,
        fix: !authOk ? 'Set gateway.auth.mode to "token" with gateway.auth.token, or "password" with gateway.auth.password' : '',
        severity: 'critical',
    });
    const gwBind = (_d = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.gateway) === null || _d === void 0 ? void 0 : _d.bind;
    checks.push({
        id: 'gateway_bind',
        name: 'Gateway bind address',
        status: gwBind === 'loopback' || gwBind === '127.0.0.1' ? 'pass' : 'fail',
        detail: `Gateway bind: ${gwBind || 'not set'}`,
        fix: gwBind !== 'loopback' ? 'Set gateway.bind to "loopback" to prevent external access' : '',
        severity: 'critical',
    });
    const toolsProfile = (_e = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.tools) === null || _e === void 0 ? void 0 : _e.profile;
    checks.push({
        id: 'tools_restricted',
        name: 'Tool permissions restricted',
        status: toolsProfile && toolsProfile !== 'all' ? 'pass' : 'warn',
        detail: `Tools profile: ${toolsProfile || 'default'}`,
        fix: toolsProfile === 'all' ? 'Use a restrictive tools profile like "messaging" or "coding"' : '',
        severity: 'low',
    });
    const elevated = (_f = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.elevated) === null || _f === void 0 ? void 0 : _f.enabled;
    checks.push({
        id: 'elevated_disabled',
        name: 'Elevated mode disabled',
        status: elevated !== true ? 'pass' : 'fail',
        detail: elevated === true ? 'Elevated mode is enabled' : 'Elevated mode is disabled',
        fix: elevated === true ? 'Set elevated.enabled to false unless explicitly needed' : '',
        severity: 'high',
    });
    const dmScope = (_g = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.session) === null || _g === void 0 ? void 0 : _g.dmScope;
    checks.push({
        id: 'dm_isolation',
        name: 'DM session isolation',
        status: dmScope === 'per-channel-peer' ? 'pass' : 'warn',
        detail: `DM scope: ${dmScope || 'default'}`,
        fix: dmScope !== 'per-channel-peer' ? 'Set session.dmScope to "per-channel-peer" to prevent context leakage' : '',
        severity: 'medium',
    });
    const execSecurity = (_j = (_h = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.tools) === null || _h === void 0 ? void 0 : _h.exec) === null || _j === void 0 ? void 0 : _j.security;
    checks.push({
        id: 'exec_restricted',
        name: 'Exec tool restricted',
        status: execSecurity === 'deny' ? 'pass' : execSecurity === 'allowlist' ? 'pass' : 'warn',
        detail: `Exec security: ${execSecurity || 'default'}`,
        fix: execSecurity !== 'deny' && execSecurity !== 'allowlist' ? 'Set tools.exec.security to "deny" or "allowlist"' : '',
        severity: 'high',
    });
    const controlUi = (_k = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.gateway) === null || _k === void 0 ? void 0 : _k.controlUi;
    if (controlUi) {
        checks.push({
            id: 'control_ui_device_auth',
            name: 'Control UI device auth',
            status: controlUi.dangerouslyDisableDeviceAuth === true ? 'fail' : 'pass',
            detail: controlUi.dangerouslyDisableDeviceAuth === true
                ? 'DANGEROUS: dangerouslyDisableDeviceAuth is enabled — device identity checks are bypassed'
                : 'Control UI device auth is active',
            fix: controlUi.dangerouslyDisableDeviceAuth === true
                ? 'Set gateway.controlUi.dangerouslyDisableDeviceAuth to false unless in a break-glass scenario'
                : '',
            severity: 'critical',
        });
        checks.push({
            id: 'control_ui_insecure_auth',
            name: 'Control UI secure auth',
            status: controlUi.allowInsecureAuth === true ? 'warn' : 'pass',
            detail: controlUi.allowInsecureAuth === true
                ? 'allowInsecureAuth is enabled — consider HTTPS or localhost-only access'
                : 'Insecure auth toggle is disabled',
            fix: controlUi.allowInsecureAuth === true
                ? 'Set gateway.controlUi.allowInsecureAuth to false, use HTTPS (Tailscale Serve) or localhost'
                : '',
            severity: 'high',
        });
    }
    const fsWorkspaceOnly = (_m = (_l = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.tools) === null || _l === void 0 ? void 0 : _l.fs) === null || _m === void 0 ? void 0 : _m.workspaceOnly;
    checks.push({
        id: 'fs_workspace_only',
        name: 'Filesystem workspace isolation',
        status: fsWorkspaceOnly === true ? 'pass' : 'warn',
        detail: fsWorkspaceOnly === true
            ? 'File operations restricted to workspace directory'
            : 'Agents can access files outside the workspace',
        fix: fsWorkspaceOnly !== true ? 'Set tools.fs.workspaceOnly to true to restrict file access to the workspace' : '',
        severity: 'medium',
    });
    const toolsDeny = (_o = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.tools) === null || _o === void 0 ? void 0 : _o.deny;
    const dangerousGroups = ['group:automation', 'group:runtime', 'group:fs'];
    const deniedGroups = Array.isArray(toolsDeny)
        ? dangerousGroups.filter(g => toolsDeny.includes(g))
        : [];
    checks.push({
        id: 'tools_deny_list',
        name: 'Dangerous tool groups denied',
        status: deniedGroups.length >= 2 ? 'pass' : deniedGroups.length > 0 ? 'warn' : 'warn',
        detail: Array.isArray(toolsDeny) && toolsDeny.length > 0
            ? `Denied: ${toolsDeny.join(', ')}`
            : 'No tool deny list configured',
        fix: deniedGroups.length < 2
            ? 'Add tools.deny: ["group:automation", "group:runtime", "group:fs"] for agents that don\'t need them'
            : '',
        severity: 'low',
    });
    const logRedact = (_p = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.logging) === null || _p === void 0 ? void 0 : _p.redactSensitive;
    checks.push({
        id: 'log_redaction',
        name: 'Log redaction enabled',
        status: logRedact ? 'pass' : 'warn',
        detail: logRedact ? `Log redaction: ${logRedact}` : 'Sensitive data redaction is not configured',
        fix: !logRedact ? 'Set logging.redactSensitive to "tools" to prevent secrets leaking into logs' : '',
        severity: 'low',
    });
    const sandboxMode = (_s = (_r = (_q = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.agents) === null || _q === void 0 ? void 0 : _q.defaults) === null || _r === void 0 ? void 0 : _r.sandbox) === null || _s === void 0 ? void 0 : _s.mode;
    checks.push({
        id: 'sandbox_mode',
        name: 'Agent sandbox mode',
        status: sandboxMode === 'all' ? 'pass' : sandboxMode ? 'warn' : 'warn',
        detail: sandboxMode ? `Sandbox mode: ${sandboxMode}` : 'No default sandbox mode configured',
        fix: sandboxMode !== 'all'
            ? 'Set agents.defaults.sandbox.mode to "all" for full isolation (recommended for untrusted inputs)'
            : '',
        severity: 'medium',
    });
    const safeBins = (_u = (_t = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.tools) === null || _t === void 0 ? void 0 : _t.exec) === null || _u === void 0 ? void 0 : _u.safeBins;
    if (Array.isArray(safeBins) && safeBins.length > 0) {
        const interpreters = ['python', 'python3', 'node', 'bun', 'deno', 'ruby', 'perl', 'bash', 'sh', 'zsh'];
        const unsafeInterpreters = safeBins.filter((b) => interpreters.includes(b));
        const safeBinProfiles = ((_w = (_v = ocConfig === null || ocConfig === void 0 ? void 0 : ocConfig.tools) === null || _v === void 0 ? void 0 : _v.exec) === null || _w === void 0 ? void 0 : _w.safeBinProfiles) || {};
        const unprofiledInterps = unsafeInterpreters.filter((b) => !safeBinProfiles[b]);
        checks.push({
            id: 'safe_bins_interpreters',
            name: 'Safe bins interpreter profiling',
            status: unprofiledInterps.length === 0 ? 'pass' : 'warn',
            detail: unprofiledInterps.length > 0
                ? `Interpreter binaries without profiles: ${unprofiledInterps.join(', ')}`
                : 'All interpreter binaries in safeBins have hardened profiles',
            fix: unprofiledInterps.length > 0
                ? `Define tools.exec.safeBinProfiles for: ${unprofiledInterps.join(', ')} — or remove them from safeBins`
                : '',
            severity: 'medium',
        });
    }
    return scoreCategory(checks);
}
// ---------------------------------------------------------------------------
// Category: Runtime
// ---------------------------------------------------------------------------
function scanRuntime() {
    const checks = [];
    try {
        require('@/lib/injection-guard');
        checks.push({
            id: 'injection_guard',
            name: 'Injection guard active',
            status: 'pass',
            detail: 'Prompt and command injection protection is loaded',
            fix: '',
            severity: 'critical',
        });
    }
    catch (_a) {
        checks.push({
            id: 'injection_guard',
            name: 'Injection guard active',
            status: 'fail',
            detail: 'Injection guard module not found',
            fix: 'Ensure src/lib/injection-guard.ts exists and is importable',
            severity: 'critical',
        });
    }
    const rlDisabled = process.env.MC_DISABLE_RATE_LIMIT;
    checks.push({
        id: 'rate_limiting',
        name: 'Rate limiting active',
        status: !rlDisabled ? 'pass' : 'fail',
        detail: rlDisabled ? 'Rate limiting is disabled' : 'Rate limiting is active',
        fix: rlDisabled ? 'Remove MC_DISABLE_RATE_LIMIT from .env' : '',
        severity: 'high',
    });
    const isDocker = (0, node_fs_1.existsSync)('/.dockerenv');
    if (isDocker) {
        checks.push({
            id: 'docker_detected',
            name: 'Running in Docker',
            status: 'pass',
            detail: 'Container environment detected',
            fix: '',
            severity: 'low',
        });
    }
    try {
        const backupDir = node_path_1.default.join(node_path_1.default.dirname(config_1.config.dbPath), 'backups');
        if ((0, node_fs_1.existsSync)(backupDir)) {
            const files = (0, node_fs_1.readdirSync)(backupDir)
                .filter((f) => f.endsWith('.db'))
                .map((f) => {
                const stat = (0, node_fs_1.statSync)(node_path_1.default.join(backupDir, f));
                return { mtime: stat.mtimeMs };
            })
                .sort((a, b) => b.mtime - a.mtime);
            if (files.length > 0) {
                const ageHours = Math.round((Date.now() - files[0].mtime) / 3600000);
                checks.push({
                    id: 'backup_recent',
                    name: 'Recent backup exists',
                    status: ageHours < 24 ? 'pass' : ageHours < 168 ? 'warn' : 'fail',
                    detail: `Latest backup is ${ageHours}h old`,
                    fix: ageHours >= 24 ? 'Enable auto_backup in Settings or run: curl -X POST /api/backup' : '',
                    severity: 'medium',
                });
            }
            else {
                checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backups found', fix: 'Enable auto_backup in Settings', severity: 'medium' });
            }
        }
        else {
            checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backup directory', fix: 'Enable auto_backup in Settings', severity: 'medium' });
        }
    }
    catch (_b) {
        checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'Could not check backups', fix: '', severity: 'medium' });
    }
    try {
        const db = (0, db_1.getDatabase)();
        const result = db.prepare('PRAGMA integrity_check').get();
        checks.push({
            id: 'db_integrity',
            name: 'Database integrity',
            status: (result === null || result === void 0 ? void 0 : result.integrity_check) === 'ok' ? 'pass' : 'fail',
            detail: (result === null || result === void 0 ? void 0 : result.integrity_check) === 'ok' ? 'Integrity check passed' : `Integrity: ${(result === null || result === void 0 ? void 0 : result.integrity_check) || 'unknown'}`,
            fix: (result === null || result === void 0 ? void 0 : result.integrity_check) !== 'ok' ? 'Database may be corrupted — restore from backup' : '',
            severity: 'critical',
        });
    }
    catch (_c) {
        checks.push({ id: 'db_integrity', name: 'Database integrity', status: 'warn', detail: 'Could not run integrity check', fix: '', severity: 'critical' });
    }
    return scoreCategory(checks);
}
// ---------------------------------------------------------------------------
// Category: OS — base + platform-specific hardening checks
// ---------------------------------------------------------------------------
function scanOS() {
    var _a;
    const checks = [];
    const platform = node_os_1.default.platform();
    const isLinux = platform === 'linux';
    const isDarwin = platform === 'darwin';
    const isWindows = platform === 'win32';
    // -- Cross-platform checks --
    const uid = (_a = process.getuid) === null || _a === void 0 ? void 0 : _a.call(process);
    if (uid !== undefined) {
        checks.push({
            id: 'not_root',
            name: 'Not running as root',
            status: uid === 0 ? 'fail' : 'pass',
            detail: uid === 0 ? 'Process is running as root (UID 0)' : `Running as UID ${uid}`,
            fix: uid === 0 ? 'Run Mission Control as a non-root user' : '',
            severity: 'critical',
            platform: 'all',
        });
    }
    const nodeVersion = process.versions.node;
    const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
    checks.push({
        id: 'node_supported',
        name: 'Node.js version supported',
        status: nodeMajor >= 20 ? 'pass' : nodeMajor >= 18 ? 'warn' : 'fail',
        detail: `Node.js v${nodeVersion}`,
        fix: nodeMajor < 20 ? 'Upgrade to Node.js 20 LTS or later' : '',
        severity: 'medium',
        platform: 'all',
    });
    // Node.js elevated capabilities (Linux only)
    if (isLinux && uid !== undefined && uid !== 0) {
        const caps = cachedExec('node_caps', 'getcap $(which node) 2>/dev/null');
        const hasCaps = caps ? caps.includes('=') : false;
        checks.push({
            id: 'node_permissions',
            name: 'Node.js no elevated capabilities',
            status: hasCaps ? 'warn' : 'pass',
            detail: hasCaps ? `Node binary has capabilities: ${caps}` : 'Node binary has no special capabilities',
            fix: hasCaps ? 'Remove capabilities: sudo setcap -r $(which node)' : '',
            severity: 'medium',
            platform: 'linux',
        });
    }
    // Uptime
    const uptimeSeconds = readSystemUptimeSeconds();
    if (uptimeSeconds === null) {
        checks.push({
            id: 'uptime',
            name: 'System reboot freshness',
            status: 'warn',
            detail: 'System uptime is unavailable in this runtime environment',
            fix: '',
            severity: 'low',
            platform: 'all',
        });
    }
    else {
        const uptimeDays = Math.floor(uptimeSeconds / 86400);
        checks.push({
            id: 'uptime',
            name: 'System reboot freshness',
            status: uptimeDays < 30 ? 'pass' : uptimeDays < 90 ? 'warn' : 'fail',
            detail: `System uptime: ${uptimeDays} day${uptimeDays !== 1 ? 's' : ''}`,
            fix: uptimeDays >= 30 ? 'Consider rebooting to apply kernel and system updates' : '',
            severity: 'low',
            platform: 'all',
        });
    }
    // NTP sync
    if (isLinux) {
        const ntpStatus = cachedExec('ntp_sync', 'timedatectl status 2>/dev/null | grep -i "synchronized\\|ntp" | head -2');
        const ntpActive = (ntpStatus === null || ntpStatus === void 0 ? void 0 : ntpStatus.toLowerCase().includes('yes')) || (ntpStatus === null || ntpStatus === void 0 ? void 0 : ntpStatus.toLowerCase().includes('active'));
        checks.push({
            id: 'ntp_sync',
            name: 'Time synchronization',
            status: ntpActive ? 'pass' : 'warn',
            detail: ntpActive ? 'NTP synchronization is active' : 'NTP sync status unknown or inactive',
            fix: !ntpActive ? 'Enable NTP: sudo timedatectl set-ntp true' : '',
            severity: 'low',
            platform: 'linux',
        });
    }
    else if (isDarwin) {
        const ntpStatus = cachedExec('ntp_sync', 'systemsetup -getusingnetworktime 2>/dev/null');
        const ntpActive = ntpStatus === null || ntpStatus === void 0 ? void 0 : ntpStatus.toLowerCase().includes('on');
        checks.push({
            id: 'ntp_sync',
            name: 'Time synchronization',
            status: ntpActive ? 'pass' : 'warn',
            detail: ntpActive ? 'Network time is enabled' : 'Network time may be disabled',
            fix: !ntpActive ? 'Enable: sudo systemsetup -setusingnetworktime on' : '',
            severity: 'low',
            platform: 'darwin',
        });
    }
    // -- Firewall --
    if (isLinux) {
        const ufwStatus = tryExec('ufw status 2>/dev/null');
        const iptablesCount = tryExec('iptables -L -n 2>/dev/null | wc -l');
        const nftCount = tryExec('nft list ruleset 2>/dev/null | wc -l');
        const hasUfw = ufwStatus === null || ufwStatus === void 0 ? void 0 : ufwStatus.includes('active');
        const hasIptables = iptablesCount ? parseInt(iptablesCount, 10) > 8 : false;
        const hasNft = nftCount ? parseInt(nftCount, 10) > 0 : false;
        checks.push({
            id: 'firewall',
            name: 'Firewall active',
            status: hasUfw || hasIptables || hasNft ? 'pass' : 'warn',
            detail: hasUfw ? 'UFW firewall is active' : hasIptables ? 'iptables rules present' : hasNft ? 'nftables rules present' : 'No firewall detected',
            fix: !hasUfw && !hasIptables && !hasNft ? 'Enable a firewall: sudo ufw enable' : '',
            severity: 'critical',
            platform: 'linux',
        });
    }
    else if (isDarwin) {
        const pfStatus = tryExec('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null');
        const fwEnabled = pfStatus === null || pfStatus === void 0 ? void 0 : pfStatus.includes('enabled');
        checks.push({
            id: 'firewall',
            name: 'Firewall active',
            status: fwEnabled ? 'pass' : 'warn',
            detail: fwEnabled ? 'macOS application firewall is enabled' : 'macOS firewall is disabled',
            fix: !fwEnabled ? 'Enable firewall: System Settings > Network > Firewall' : '',
            severity: 'critical',
            platform: 'darwin',
        });
    }
    // -- Open ports --
    if (isLinux || isDarwin) {
        const portCmd = isLinux
            ? 'ss -tlnp 2>/dev/null | tail -n +2 | wc -l'
            : 'netstat -an 2>/dev/null | grep LISTEN | wc -l';
        const portCount = tryExec(portCmd);
        const count = portCount ? parseInt(portCount.trim(), 10) : 0;
        checks.push({
            id: 'open_ports',
            name: 'Listening ports',
            status: count <= 10 ? 'pass' : count <= 25 ? 'warn' : 'fail',
            detail: `${count} listening port${count !== 1 ? 's' : ''} detected`,
            fix: count > 10 ? 'Review open ports and close unnecessary services' : '',
            severity: 'medium',
            platform: isLinux ? 'linux' : 'darwin',
        });
    }
    // -- SSH hardening (Linux) --
    if (isLinux && (0, node_fs_1.existsSync)('/etc/ssh/sshd_config')) {
        const sshdConfig = tryExec('grep -i "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null');
        if (sshdConfig !== null) {
            const allowsRoot = sshdConfig.toLowerCase().includes('yes');
            checks.push({
                id: 'ssh_root',
                name: 'SSH root login disabled',
                status: allowsRoot ? 'fail' : 'pass',
                detail: allowsRoot ? 'SSH allows root login' : 'SSH root login is restricted',
                fix: allowsRoot ? 'Set PermitRootLogin no in /etc/ssh/sshd_config and restart sshd' : '',
                severity: 'critical',
                platform: 'linux',
            });
        }
        const sshPwAuth = tryExec('grep -i "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null');
        if (sshPwAuth !== null) {
            const allowsPw = sshPwAuth.toLowerCase().includes('yes');
            checks.push({
                id: 'ssh_password',
                name: 'SSH password auth disabled',
                status: allowsPw ? 'warn' : 'pass',
                detail: allowsPw ? 'SSH allows password authentication' : 'SSH uses key-based authentication only',
                fix: allowsPw ? 'Set PasswordAuthentication no in /etc/ssh/sshd_config' : '',
                severity: 'high',
                platform: 'linux',
            });
        }
    }
    // -- Auto updates --
    if (isLinux) {
        const hasUnattended = (0, node_fs_1.existsSync)('/etc/apt/apt.conf.d/20auto-upgrades')
            || (0, node_fs_1.existsSync)('/etc/yum/yum-cron.conf')
            || (0, node_fs_1.existsSync)('/etc/dnf/automatic.conf');
        checks.push({
            id: 'auto_updates',
            name: 'Automatic security updates',
            status: hasUnattended ? 'pass' : 'warn',
            detail: hasUnattended ? 'Automatic update configuration found' : 'No automatic update configuration detected',
            fix: !hasUnattended ? 'Install unattended-upgrades (Debian/Ubuntu) or dnf-automatic (RHEL/Fedora)' : '',
            severity: 'medium',
            platform: 'linux',
        });
    }
    else if (isDarwin) {
        const autoUpdate = tryExec('defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled 2>/dev/null');
        checks.push({
            id: 'auto_updates',
            name: 'Automatic software updates',
            status: autoUpdate === '1' ? 'pass' : 'warn',
            detail: autoUpdate === '1' ? 'Automatic update checks enabled' : 'Automatic update status unknown',
            fix: autoUpdate !== '1' ? 'Enable in System Settings > General > Software Update' : '',
            severity: 'medium',
            platform: 'darwin',
        });
    }
    // -- Disk encryption --
    if (isDarwin) {
        const fvStatus = tryExec('fdesetup status 2>/dev/null');
        const encrypted = fvStatus === null || fvStatus === void 0 ? void 0 : fvStatus.includes('On');
        checks.push({
            id: 'disk_encryption',
            name: 'Disk encryption (FileVault)',
            status: encrypted ? 'pass' : 'fail',
            detail: encrypted ? 'FileVault is enabled' : 'FileVault is not enabled',
            fix: !encrypted ? 'Enable FileVault in System Settings > Privacy & Security' : '',
            severity: 'high',
            platform: 'darwin',
        });
    }
    else if (isLinux) {
        const luksDevices = tryExec('lsblk -o TYPE 2>/dev/null | grep -c crypt');
        const hasCrypt = luksDevices ? parseInt(luksDevices, 10) > 0 : false;
        checks.push({
            id: 'disk_encryption',
            name: 'Disk encryption (LUKS)',
            status: hasCrypt ? 'pass' : 'warn',
            detail: hasCrypt ? 'Encrypted volumes detected' : 'No LUKS-encrypted volumes detected',
            fix: !hasCrypt ? 'Consider encrypting data volumes with LUKS' : '',
            severity: 'high',
            platform: 'linux',
        });
    }
    // -- World-writable files --
    if (isLinux || isDarwin) {
        const cwd = process.cwd();
        const wwFiles = tryExec(`find "${cwd}" -maxdepth 2 -perm -o+w -not -type l 2>/dev/null | head -5`);
        const wwCount = wwFiles ? wwFiles.split('\n').filter(Boolean).length : 0;
        checks.push({
            id: 'world_writable',
            name: 'No world-writable app files',
            status: wwCount === 0 ? 'pass' : 'warn',
            detail: wwCount === 0 ? 'No world-writable files in app directory' : `${wwCount}+ world-writable file${wwCount > 1 ? 's' : ''} found`,
            fix: wwCount > 0 ? 'Run: chmod o-w on affected files' : '',
            severity: 'medium',
            fixSafety: 'safe',
            platform: isLinux ? 'linux' : 'darwin',
        });
    }
    // -- Linux-specific hardening --
    if (isLinux) {
        // Batch read kernel parameters in a single exec
        const kernelParams = tryExecBatch('echo "aslr=$(cat /proc/sys/kernel/randomize_va_space 2>/dev/null)"; ' +
            'echo "core_pattern=$(cat /proc/sys/kernel/core_pattern 2>/dev/null)"; ' +
            'echo "syn_cookies=$(cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null)"');
        const aslr = kernelParams['aslr'];
        checks.push({
            id: 'linux_aslr',
            name: 'Kernel ASLR enabled',
            status: aslr === '2' ? 'pass' : aslr === '1' ? 'warn' : 'fail',
            detail: aslr === '2' ? 'Full ASLR randomization active' : aslr === '1' ? 'Partial ASLR — upgrade to full' : aslr ? `ASLR value: ${aslr}` : 'Could not read ASLR status',
            fix: aslr !== '2' ? 'Set: sysctl -w kernel.randomize_va_space=2' : '',
            severity: 'critical',
            fixSafety: 'manual-only',
            platform: 'linux',
        });
        const corePattern = kernelParams['core_pattern'] || '';
        const coreToFile = !corePattern.startsWith('|') && corePattern !== '';
        checks.push({
            id: 'linux_core_dumps',
            name: 'Core dumps restricted',
            status: coreToFile ? 'warn' : 'pass',
            detail: coreToFile ? `Core pattern writes to file: ${corePattern}` : 'Core dumps piped to handler or disabled',
            fix: coreToFile ? 'Restrict core dumps: echo "|/bin/false" > /proc/sys/kernel/core_pattern' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'linux',
        });
        const synCookies = kernelParams['syn_cookies'];
        checks.push({
            id: 'linux_syn_cookies',
            name: 'TCP SYN cookies enabled',
            status: synCookies === '1' ? 'pass' : 'warn',
            detail: synCookies === '1' ? 'SYN cookie protection active' : 'SYN cookies are not enabled',
            fix: synCookies !== '1' ? 'Set: sysctl -w net.ipv4.tcp_syncookies=1' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'linux',
        });
        // MAC framework
        const selinux = cachedExec('selinux', 'cat /sys/fs/selinux/enforce 2>/dev/null');
        const apparmor = cachedExec('apparmor', 'aa-status --enabled 2>/dev/null; echo $?');
        const hasSELinux = selinux === '1';
        const hasAppArmor = apparmor === null || apparmor === void 0 ? void 0 : apparmor.trim().endsWith('0');
        checks.push({
            id: 'linux_mac_framework',
            name: 'Mandatory access control',
            status: hasSELinux || hasAppArmor ? 'pass' : 'warn',
            detail: hasSELinux ? 'SELinux enforcing' : hasAppArmor ? 'AppArmor active' : 'No MAC framework detected',
            fix: !hasSELinux && !hasAppArmor ? 'Enable AppArmor or SELinux for mandatory access control' : '',
            severity: 'high',
            fixSafety: 'manual-only',
            platform: 'linux',
        });
        // fail2ban
        const f2bStatus = cachedExec('fail2ban', 'systemctl is-active fail2ban 2>/dev/null');
        checks.push({
            id: 'linux_fail2ban',
            name: 'Brute-force protection (fail2ban)',
            status: f2bStatus === 'active' ? 'pass' : 'warn',
            detail: f2bStatus === 'active' ? 'fail2ban is active' : 'fail2ban is not running',
            fix: f2bStatus !== 'active' ? 'Install and enable fail2ban: sudo apt install fail2ban && sudo systemctl enable --now fail2ban' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'linux',
        });
        // /tmp noexec
        const tmpMount = cachedExec('tmp_mount', 'mount 2>/dev/null | grep " /tmp "');
        const tmpNoexec = tmpMount === null || tmpMount === void 0 ? void 0 : tmpMount.includes('noexec');
        checks.push({
            id: 'linux_tmp_noexec',
            name: '/tmp mounted noexec',
            status: tmpNoexec ? 'pass' : 'warn',
            detail: tmpNoexec ? '/tmp is mounted with noexec' : '/tmp may allow execution — consider noexec mount',
            fix: !tmpNoexec ? 'Add noexec,nosuid,nodev to /tmp mount options in /etc/fstab' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'linux',
        });
    }
    // -- macOS-specific hardening --
    if (isDarwin) {
        const sipStatus = cachedExec('sip', 'csrutil status 2>/dev/null');
        const sipEnabled = sipStatus === null || sipStatus === void 0 ? void 0 : sipStatus.toLowerCase().includes('enabled');
        checks.push({
            id: 'macos_sip',
            name: 'System Integrity Protection',
            status: sipEnabled ? 'pass' : 'fail',
            detail: sipEnabled ? 'SIP is enabled' : 'SIP is disabled — system files are unprotected',
            fix: !sipEnabled ? 'Re-enable SIP from Recovery Mode: csrutil enable' : '',
            severity: 'critical',
            fixSafety: 'manual-only',
            platform: 'darwin',
        });
        const gkStatus = cachedExec('gatekeeper', 'spctl --status 2>/dev/null');
        const gkEnabled = gkStatus === null || gkStatus === void 0 ? void 0 : gkStatus.includes('enabled');
        checks.push({
            id: 'macos_gatekeeper',
            name: 'Gatekeeper active',
            status: gkEnabled ? 'pass' : 'warn',
            detail: gkEnabled ? 'Gatekeeper is enabled' : 'Gatekeeper is disabled',
            fix: !gkEnabled ? 'Enable Gatekeeper: sudo spctl --master-enable' : '',
            severity: 'high',
            fixSafety: 'manual-only',
            platform: 'darwin',
        });
        const stealthStatus = cachedExec('stealth', '/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null');
        const stealthEnabled = stealthStatus === null || stealthStatus === void 0 ? void 0 : stealthStatus.includes('enabled');
        checks.push({
            id: 'macos_stealth_mode',
            name: 'Firewall stealth mode',
            status: stealthEnabled ? 'pass' : 'warn',
            detail: stealthEnabled ? 'Stealth mode is enabled' : 'Stealth mode is disabled',
            fix: !stealthEnabled ? 'Enable: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'darwin',
        });
        const remoteLogin = cachedExec('remote_login', 'systemsetup -getremotelogin 2>/dev/null');
        const remoteOff = remoteLogin === null || remoteLogin === void 0 ? void 0 : remoteLogin.toLowerCase().includes('off');
        checks.push({
            id: 'macos_remote_login',
            name: 'Remote login disabled',
            status: remoteOff ? 'pass' : 'warn',
            detail: remoteOff ? 'Remote login (SSH) is disabled' : 'Remote login (SSH) is enabled',
            fix: !remoteOff ? 'Disable if not needed: sudo systemsetup -setremotelogin off' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'darwin',
        });
        const guestAccount = cachedExec('guest', 'defaults read /Library/Preferences/com.apple.loginwindow GuestEnabled 2>/dev/null');
        const guestDisabled = guestAccount === '0';
        checks.push({
            id: 'macos_guest_account',
            name: 'Guest account disabled',
            status: guestDisabled || guestAccount === null ? 'pass' : 'warn',
            detail: guestDisabled || guestAccount === null ? 'Guest account is disabled' : 'Guest account is enabled',
            fix: !guestDisabled && guestAccount !== null ? 'Disable: sudo defaults write /Library/Preferences/com.apple.loginwindow GuestEnabled -bool false' : '',
            severity: 'low',
            fixSafety: 'manual-only',
            platform: 'darwin',
        });
    }
    // -- Windows-specific hardening --
    if (isWindows) {
        const defenderStatus = cachedExec('win_defender', 'powershell -NoProfile -Command "(Get-MpComputerStatus).RealTimeProtectionEnabled" 2>nul');
        checks.push({
            id: 'win_defender',
            name: 'Windows Defender active',
            status: defenderStatus === 'True' ? 'pass' : 'fail',
            detail: defenderStatus === 'True' ? 'Real-time protection is enabled' : 'Windows Defender real-time protection is not active',
            fix: defenderStatus !== 'True' ? 'Enable Windows Defender real-time protection in Windows Security settings' : '',
            severity: 'critical',
            fixSafety: 'manual-only',
            platform: 'win32',
        });
        const fwProfiles = cachedExec('win_firewall', 'powershell -NoProfile -Command "(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $true}).Count" 2>nul');
        const fwCount = fwProfiles ? parseInt(fwProfiles, 10) : 0;
        checks.push({
            id: 'win_firewall',
            name: 'Windows Firewall active',
            status: fwCount >= 3 ? 'pass' : fwCount > 0 ? 'warn' : 'fail',
            detail: fwCount >= 3 ? 'All firewall profiles are active' : `${fwCount} of 3 firewall profiles active`,
            fix: fwCount < 3 ? 'Enable all firewall profiles in Windows Defender Firewall settings' : '',
            severity: 'critical',
            fixSafety: 'manual-only',
            platform: 'win32',
        });
        const bitlocker = cachedExec('win_bitlocker', 'powershell -NoProfile -Command "(Get-BitLockerVolume -MountPoint C:).ProtectionStatus" 2>nul');
        checks.push({
            id: 'win_bitlocker',
            name: 'BitLocker encryption',
            status: bitlocker === 'On' ? 'pass' : 'warn',
            detail: bitlocker === 'On' ? 'BitLocker is active on C:' : 'BitLocker is not active on C:',
            fix: bitlocker !== 'On' ? 'Enable BitLocker in Control Panel > BitLocker Drive Encryption' : '',
            severity: 'high',
            fixSafety: 'manual-only',
            platform: 'win32',
        });
        const uac = cachedExec('win_uac', 'powershell -NoProfile -Command "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System).EnableLUA" 2>nul');
        checks.push({
            id: 'win_uac',
            name: 'UAC enabled',
            status: uac === '1' ? 'pass' : 'fail',
            detail: uac === '1' ? 'User Account Control is enabled' : 'UAC is disabled',
            fix: uac !== '1' ? 'Enable UAC in Control Panel > User Account Control Settings' : '',
            severity: 'high',
            fixSafety: 'manual-only',
            platform: 'win32',
        });
        const rdp = cachedExec('win_rdp', "powershell -NoProfile -Command \"(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections\" 2>nul");
        checks.push({
            id: 'win_rdp_disabled',
            name: 'Remote Desktop disabled',
            status: rdp === '1' ? 'pass' : 'warn',
            detail: rdp === '1' ? 'Remote Desktop is disabled' : 'Remote Desktop is enabled',
            fix: rdp !== '1' ? 'Disable RDP if not needed: System Properties > Remote > disable Remote Desktop' : '',
            severity: 'medium',
            fixSafety: 'manual-only',
            platform: 'win32',
        });
        const smb1 = cachedExec('win_smb1', 'powershell -NoProfile -Command "(Get-SmbServerConfiguration).EnableSMB1Protocol" 2>nul');
        checks.push({
            id: 'win_smb1_disabled',
            name: 'SMBv1 disabled',
            status: smb1 === 'False' ? 'pass' : 'warn',
            detail: smb1 === 'False' ? 'SMBv1 is disabled' : 'SMBv1 may be enabled',
            fix: smb1 !== 'False' ? 'Disable: Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force' : '',
            severity: 'high',
            fixSafety: 'manual-only',
            platform: 'win32',
        });
    }
    return scoreCategory(checks);
}
