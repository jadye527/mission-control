"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const node_fs_1 = require("node:fs");
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const security_scan_1 = require("@/lib/security-scan");
function shouldMutateRuntimeEnv() {
    return process.env.MISSION_CONTROL_TEST_MODE !== '1';
}
function normalizeHostname(raw) {
    return raw.trim().replace(/^\[|\]$/g, '').split(':')[0].replace(/\.$/, '').toLowerCase();
}
function parseForwardedHost(forwarded) {
    if (!forwarded)
        return [];
    const hosts = [];
    for (const part of forwarded.split(',')) {
        const match = /(?:^|;)\s*host="?([^";]+)"?/i.exec(part);
        if (match === null || match === void 0 ? void 0 : match[1])
            hosts.push(match[1]);
    }
    return hosts;
}
function getRequestHostCandidates(request) {
    const rawCandidates = [
        ...(request.headers.get('x-forwarded-host') || '').split(','),
        ...(request.headers.get('x-original-host') || '').split(','),
        ...(request.headers.get('x-forwarded-server') || '').split(','),
        ...parseForwardedHost(request.headers.get('forwarded')),
        request.headers.get('host') || '',
        request.nextUrl.host || '',
        request.nextUrl.hostname || '',
    ];
    return [...new Set(rawCandidates.map(normalizeHostname).filter(Boolean))];
}
function getFailingChecks() {
    return Object.values((0, security_scan_1.runSecurityScan)().categories)
        .flatMap((category) => category.checks)
        .filter((check) => check.status !== 'pass');
}
async function POST(request) {
    var _a, _b, _c, _d;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    // Optional: pass { ids: ["check_id"] } to fix only specific issues
    let targetIds = null;
    try {
        const body = await request.json();
        if (Array.isArray(body === null || body === void 0 ? void 0 : body.ids) && body.ids.length > 0) {
            targetIds = new Set(body.ids);
        }
    }
    catch ( /* no body = fix all */_e) { /* no body = fix all */ }
    const shouldFix = (id) => !targetIds || targetIds.has(id);
    const results = [];
    const envPaths = [
        node_path_1.default.join(process.cwd(), '.env'),
        node_path_1.default.join(process.cwd(), '.env.local'),
    ];
    function readEnv(filePath) {
        try {
            return (0, node_fs_1.readFileSync)(filePath, 'utf-8');
        }
        catch (_a) {
            return '';
        }
    }
    function setEnvVar(key, value) {
        let targetPath = envPaths[0];
        for (const filePath of envPaths) {
            const content = readEnv(filePath);
            if (new RegExp(`^${key}=.*$`, 'm').test(content)) {
                targetPath = filePath;
                break;
            }
        }
        let content = readEnv(targetPath);
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
        }
        else {
            content = content.trimEnd() + `\n${key}=${value}\n`;
        }
        (0, node_fs_1.writeFileSync)(targetPath, content, 'utf-8');
        if (shouldMutateRuntimeEnv()) {
            process.env[key] = value;
        }
    }
    function unsetEnvVar(key) {
        const regex = new RegExp(`^${key}=.*\n?`, 'm');
        for (const filePath of envPaths) {
            let content = readEnv(filePath);
            if (regex.test(content)) {
                content = content.replace(regex, '');
                (0, node_fs_1.writeFileSync)(filePath, content, 'utf-8');
            }
        }
        if (shouldMutateRuntimeEnv()) {
            delete process.env[key];
        }
    }
    // 1. Fix .env file permissions
    const envPath = envPaths[0];
    if (shouldFix('env_permissions') && (0, node_fs_1.existsSync)(envPath)) {
        try {
            const stat = (0, node_fs_1.statSync)(envPath);
            const mode = (stat.mode & 0o777).toString(8);
            if (mode !== '600') {
                (0, node_fs_1.chmodSync)(envPath, 0o600);
                results.push({ id: 'env_permissions', name: '.env file permissions', fixed: true, detail: `Changed from ${mode} to 600`, fixSafety: security_scan_1.FIX_SAFETY['env_permissions'] });
            }
            else {
                results.push({ id: 'env_permissions', name: '.env file permissions', fixed: true, detail: 'Already 600', fixSafety: security_scan_1.FIX_SAFETY['env_permissions'] });
            }
        }
        catch (e) {
            results.push({ id: 'env_permissions', name: '.env file permissions', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['env_permissions'] });
        }
    }
    // 2. Fix MC_ALLOWED_HOSTS if not set
    const allowedHosts = (process.env.MC_ALLOWED_HOSTS || '').trim();
    const allowAny = process.env.MC_ALLOW_ANY_HOST;
    if (shouldFix('allowed_hosts') && (!allowedHosts || allowAny === '1' || allowAny === 'true')) {
        try {
            if (allowAny) {
                unsetEnvVar('MC_ALLOW_ANY_HOST');
            }
            const preservedHosts = new Set([
                'localhost',
                '127.0.0.1',
                ...allowedHosts.split(',').map((host) => normalizeHostname(host)).filter(Boolean),
                ...getRequestHostCandidates(request),
            ]);
            const mergedHosts = Array.from(preservedHosts);
            setEnvVar('MC_ALLOWED_HOSTS', mergedHosts.join(','));
            results.push({ id: 'allowed_hosts', name: 'Host allowlist', fixed: true, detail: `Set MC_ALLOWED_HOSTS=${mergedHosts.join(',')}`, fixSafety: security_scan_1.FIX_SAFETY['allowed_hosts'] });
        }
        catch (e) {
            results.push({ id: 'allowed_hosts', name: 'Host allowlist', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['allowed_hosts'] });
        }
    }
    // 3. Fix MC_ENABLE_HSTS
    if (shouldFix('hsts_enabled') && process.env.MC_ENABLE_HSTS !== '1') {
        try {
            setEnvVar('MC_ENABLE_HSTS', '1');
            results.push({ id: 'hsts_enabled', name: 'HSTS enabled', fixed: true, detail: 'Set MC_ENABLE_HSTS=1', fixSafety: security_scan_1.FIX_SAFETY['hsts_enabled'] });
        }
        catch (e) {
            results.push({ id: 'hsts_enabled', name: 'HSTS', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['hsts_enabled'] });
        }
    }
    // 4. Fix MC_COOKIE_SECURE
    const cookieSecure = process.env.MC_COOKIE_SECURE;
    if (shouldFix('cookie_secure') && cookieSecure !== '1' && cookieSecure !== 'true') {
        try {
            setEnvVar('MC_COOKIE_SECURE', '1');
            results.push({ id: 'cookie_secure', name: 'Secure cookies', fixed: true, detail: 'Set MC_COOKIE_SECURE=1', fixSafety: security_scan_1.FIX_SAFETY['cookie_secure'] });
        }
        catch (e) {
            results.push({ id: 'cookie_secure', name: 'Secure cookies', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['cookie_secure'] });
        }
    }
    // 4b. Re-enable runtime rate limiting
    const rateLimitDisabled = process.env.MC_DISABLE_RATE_LIMIT;
    if (shouldFix('rate_limiting') && rateLimitDisabled) {
        try {
            unsetEnvVar('MC_DISABLE_RATE_LIMIT');
            results.push({ id: 'rate_limiting', name: 'Rate limiting active', fixed: true, detail: 'Removed MC_DISABLE_RATE_LIMIT', fixSafety: security_scan_1.FIX_SAFETY['rate_limiting'] });
        }
        catch (e) {
            results.push({ id: 'rate_limiting', name: 'Rate limiting active', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['rate_limiting'] });
        }
    }
    // 5. Fix API_KEY if it's a known default
    const apiKey = process.env.API_KEY || '';
    if (shouldFix('api_key_set') && (!apiKey || apiKey === 'generate-a-random-key')) {
        try {
            const newKey = node_crypto_1.default.randomBytes(32).toString('hex');
            setEnvVar('API_KEY', newKey);
            results.push({ id: 'api_key_set', name: 'API key', fixed: true, detail: 'Generated new random API key', fixSafety: security_scan_1.FIX_SAFETY['api_key_set'] });
        }
        catch (e) {
            results.push({ id: 'api_key_set', name: 'API key', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['api_key_set'] });
        }
    }
    // 6. Fix OpenClaw config
    const ocFixIds = ['config_permissions', 'gateway_auth', 'gateway_bind', 'elevated_disabled', 'dm_isolation', 'exec_restricted', 'control_ui_device_auth', 'control_ui_insecure_auth', 'fs_workspace_only', 'log_redaction'];
    const configPath = config_1.config.openclawConfigPath;
    if (ocFixIds.some(id => shouldFix(id)) && configPath && (0, node_fs_1.existsSync)(configPath)) {
        let ocConfig;
        try {
            ocConfig = JSON.parse((0, node_fs_1.readFileSync)(configPath, 'utf-8'));
        }
        catch (_f) {
            ocConfig = null;
        }
        if (ocConfig) {
            let configChanged = false;
            // Fix config file permissions
            if (shouldFix('config_permissions'))
                try {
                    const stat = (0, node_fs_1.statSync)(configPath);
                    const mode = (stat.mode & 0o777).toString(8);
                    if (mode !== '600') {
                        (0, node_fs_1.chmodSync)(configPath, 0o600);
                        results.push({ id: 'config_permissions', name: 'OpenClaw config permissions', fixed: true, detail: `Changed from ${mode} to 600`, fixSafety: security_scan_1.FIX_SAFETY['config_permissions'] });
                    }
                }
                catch (e) {
                    results.push({ id: 'config_permissions', name: 'OpenClaw config permissions', fixed: false, detail: e.message, fixSafety: security_scan_1.FIX_SAFETY['config_permissions'] });
                }
            // Fix gateway auth
            if (shouldFix('gateway_auth')) {
                if (!ocConfig.gateway)
                    ocConfig.gateway = {};
                if (!ocConfig.gateway.auth)
                    ocConfig.gateway.auth = {};
                if (ocConfig.gateway.auth.mode !== 'token') {
                    ocConfig.gateway.auth.mode = 'token';
                    if (!ocConfig.gateway.auth.token) {
                        ocConfig.gateway.auth.token = node_crypto_1.default.randomBytes(32).toString('hex');
                    }
                    configChanged = true;
                    results.push({ id: 'gateway_auth', name: 'Gateway authentication', fixed: true, detail: 'Set auth.mode to "token" with generated token', fixSafety: security_scan_1.FIX_SAFETY['gateway_auth'] });
                }
            }
            // Fix gateway bind
            if (shouldFix('gateway_bind')) {
                if (!ocConfig.gateway)
                    ocConfig.gateway = {};
                if (ocConfig.gateway.bind !== 'loopback' && ocConfig.gateway.bind !== '127.0.0.1') {
                    ocConfig.gateway.bind = 'loopback';
                    configChanged = true;
                    results.push({ id: 'gateway_bind', name: 'Gateway bind address', fixed: true, detail: 'Set bind to "loopback"', fixSafety: security_scan_1.FIX_SAFETY['gateway_bind'] });
                }
            }
            // Fix elevated mode
            if (shouldFix('elevated_disabled')) {
                if (!ocConfig.elevated)
                    ocConfig.elevated = {};
                if (ocConfig.elevated.enabled === true) {
                    ocConfig.elevated.enabled = false;
                    configChanged = true;
                    results.push({ id: 'elevated_disabled', name: 'Elevated mode', fixed: true, detail: 'Disabled elevated mode', fixSafety: security_scan_1.FIX_SAFETY['elevated_disabled'] });
                }
            }
            // Fix DM isolation
            if (shouldFix('dm_isolation')) {
                if (!ocConfig.session)
                    ocConfig.session = {};
                if (ocConfig.session.dmScope !== 'per-channel-peer') {
                    ocConfig.session.dmScope = 'per-channel-peer';
                    configChanged = true;
                    results.push({ id: 'dm_isolation', name: 'DM session isolation', fixed: true, detail: 'Set dmScope to "per-channel-peer"', fixSafety: security_scan_1.FIX_SAFETY['dm_isolation'] });
                }
            }
            // Fix exec security
            if (shouldFix('exec_restricted')) {
                if (!ocConfig.tools)
                    ocConfig.tools = {};
                if (!ocConfig.tools.exec)
                    ocConfig.tools.exec = {};
                if (ocConfig.tools.exec.security !== 'allowlist' && ocConfig.tools.exec.security !== 'deny') {
                    ocConfig.tools.exec.security = 'allowlist';
                    configChanged = true;
                    results.push({ id: 'exec_restricted', name: 'Exec tool restriction', fixed: true, detail: 'Set exec security to "allowlist"', fixSafety: security_scan_1.FIX_SAFETY['exec_restricted'] });
                }
            }
            // Fix Control UI device auth
            if (shouldFix('control_ui_device_auth')) {
                if (((_b = (_a = ocConfig.gateway) === null || _a === void 0 ? void 0 : _a.controlUi) === null || _b === void 0 ? void 0 : _b.dangerouslyDisableDeviceAuth) === true) {
                    ocConfig.gateway.controlUi.dangerouslyDisableDeviceAuth = false;
                    configChanged = true;
                    results.push({ id: 'control_ui_device_auth', name: 'Control UI device auth', fixed: true, detail: 'Disabled dangerouslyDisableDeviceAuth', fixSafety: security_scan_1.FIX_SAFETY['control_ui_device_auth'] });
                }
            }
            // Fix Control UI insecure auth
            if (shouldFix('control_ui_insecure_auth')) {
                if (((_d = (_c = ocConfig.gateway) === null || _c === void 0 ? void 0 : _c.controlUi) === null || _d === void 0 ? void 0 : _d.allowInsecureAuth) === true) {
                    ocConfig.gateway.controlUi.allowInsecureAuth = false;
                    configChanged = true;
                    results.push({ id: 'control_ui_insecure_auth', name: 'Control UI secure auth', fixed: true, detail: 'Disabled allowInsecureAuth', fixSafety: security_scan_1.FIX_SAFETY['control_ui_insecure_auth'] });
                }
            }
            // Fix filesystem workspace isolation
            if (shouldFix('fs_workspace_only')) {
                if (!ocConfig.tools)
                    ocConfig.tools = {};
                if (!ocConfig.tools.fs)
                    ocConfig.tools.fs = {};
                if (ocConfig.tools.fs.workspaceOnly !== true) {
                    ocConfig.tools.fs.workspaceOnly = true;
                    configChanged = true;
                    results.push({ id: 'fs_workspace_only', name: 'Filesystem workspace isolation', fixed: true, detail: 'Set tools.fs.workspaceOnly to true', fixSafety: security_scan_1.FIX_SAFETY['fs_workspace_only'] });
                }
            }
            // Fix log redaction
            if (shouldFix('log_redaction')) {
                if (!ocConfig.logging)
                    ocConfig.logging = {};
                if (!ocConfig.logging.redactSensitive) {
                    ocConfig.logging.redactSensitive = 'tools';
                    configChanged = true;
                    results.push({ id: 'log_redaction', name: 'Log redaction', fixed: true, detail: 'Set logging.redactSensitive to "tools"', fixSafety: security_scan_1.FIX_SAFETY['log_redaction'] });
                }
            }
            if (configChanged) {
                try {
                    (0, node_fs_1.writeFileSync)(configPath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf-8');
                }
                catch (e) {
                    results.push({ id: 'config_write', name: 'Write OpenClaw config', fixed: false, detail: e.message });
                }
            }
        }
    }
    // 7. Fix world-writable files (uses execFileSync with find — no user input)
    if (shouldFix('world_writable'))
        try {
            const cwd = process.cwd();
            const wwOutput = (0, node_child_process_1.execFileSync)('find', [cwd, '-maxdepth', '2', '-perm', '-o+w', '-not', '-type', 'l'], {
                encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            if (wwOutput) {
                const files = wwOutput.split('\n').filter(Boolean).slice(0, 20);
                let fixedCount = 0;
                for (const f of files) {
                    try {
                        (0, node_fs_1.chmodSync)(f, 0o755);
                        fixedCount++;
                    }
                    catch ( /* skip */_g) { /* skip */ }
                }
                if (fixedCount > 0) {
                    results.push({ id: 'world_writable', name: 'World-writable files', fixed: true, detail: `Fixed permissions on ${fixedCount} file(s)`, fixSafety: security_scan_1.FIX_SAFETY['world_writable'] });
                }
            }
        }
        catch ( /* no world-writable files or find not available */_h) { /* no world-writable files or find not available */ }
    // Audit log
    try {
        const db = (0, db_1.getDatabase)();
        db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('security.auto_fix', auth.user.username, JSON.stringify({ fixes: results.filter(r => r.fixed).map(r => r.id) }));
    }
    catch ( /* non-critical */_j) { /* non-critical */ }
    const fixed = results.filter(r => r.fixed).length;
    const failed = results.filter(r => !r.fixed).length;
    const remainingChecks = getFailingChecks();
    const remainingAutoFixable = remainingChecks.filter((check) => check.id in security_scan_1.FIX_SAFETY).length;
    const remainingManual = remainingChecks.length - remainingAutoFixable;
    logger_1.logger.info({ fixed, failed, actor: auth.user.username }, 'Security auto-fix completed');
    return server_1.NextResponse.json({
        attempted: results.length,
        fixed,
        failed,
        remaining: remainingChecks.length,
        remainingAutoFixable,
        remainingManual,
        results,
        note: remainingChecks.length > 0
            ? 'Some issues require manual action or additional review. Environment-backed fixes may still require a server restart to fully apply.'
            : 'All currently detected auto-fixable issues have been resolved. Restart the server if you changed environment-backed settings.',
    });
}
