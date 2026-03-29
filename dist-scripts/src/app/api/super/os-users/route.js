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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
// Well-known service account usernames to exclude from OS user discovery.
// These are created by package managers (Homebrew, apt, etc.) and are not real users.
const SERVICE_ACCOUNTS = new Set([
    'postgres', 'mysql', 'redis', 'mongodb', 'memcached', 'rabbitmq',
    'elasticsearch', 'kibana', 'logstash', 'grafana', 'prometheus',
    'nginx', 'apache', 'www-data', 'httpd', 'caddy',
    'git', 'svn', 'jenkins', 'gitlab-runner', 'circleci',
    'docker', 'containerd', 'podman',
    'node', 'npm', 'yarn',
    'sshd', 'ftp', 'mail', 'postfix', 'dovecot',
    'solr', 'kafka', 'zookeeper', 'consul', 'vault', 'nomad',
    'influxdb', 'clickhouse', 'cassandra', 'couchdb',
    'puppet', 'chef', 'ansible', 'terraform',
    'ntp', 'chrony', 'systemd-network', 'systemd-resolve',
]);
/** Check if a CLI tool (claude, codex) is accessible for a given user home dir */
function checkToolExists(homeDir, tool) {
    // Check common install locations relative to user home
    const candidates = [
        path_1.default.join(homeDir, '.local', 'bin', tool),
        path_1.default.join(homeDir, '.npm-global', 'bin', tool),
        path_1.default.join(homeDir, `.${tool}`), // e.g. ~/.claude, ~/.openclaw config dir = installed
    ];
    for (const p of candidates) {
        try {
            if (fs_1.default.existsSync(p))
                return true;
        }
        catch (_a) { }
    }
    // Also check system-wide
    try {
        (0, child_process_1.execFileSync)('/usr/bin/which', [tool], { encoding: 'utf-8', timeout: 2000, stdio: 'pipe' });
        return true;
    }
    catch (_b) { }
    return false;
}
/** Install a tool (openclaw, claude, codex) for a given OS user. Non-fatal — returns success/error. */
function installToolForUser(homeDir, username, tool) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        if (tool === 'openclaw') {
            // openclaw is managed by MC — create dir structure + install latest from npm
            const openclawDir = path_1.default.join(homeDir, '.openclaw');
            const workspaceDir = path_1.default.join(homeDir, 'workspace');
            for (const dir of [openclawDir, workspaceDir]) {
                try {
                    (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', 'install', '-d', '-o', username, dir], { timeout: 5000, stdio: 'pipe' });
                }
                catch (_k) {
                    // Fallback: mkdir directly (works if running as that user or root)
                    fs_1.default.mkdirSync(dir, { recursive: true });
                }
            }
            // Install latest openclaw from GitHub (always latest) with npm fallback
            try {
                (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', '-u', username, 'npm', 'install', '-g', 'openclaw/openclaw'], {
                    timeout: 120000,
                    stdio: 'pipe',
                    env: Object.assign(Object.assign({}, process.env), { HOME: homeDir }),
                });
            }
            catch (npmErr) {
                // Dir structure created but npm install failed — still partially useful
                const msg = ((_c = (_b = (_a = npmErr === null || npmErr === void 0 ? void 0 : npmErr.stderr) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.slice(0, 200)) || (npmErr === null || npmErr === void 0 ? void 0 : npmErr.message) || 'npm install failed';
                logger_1.logger.warn({ tool, username, err: msg }, 'openclaw npm install failed, dir structure created');
                return { success: true, error: `dirs created but npm install failed: ${msg}` };
            }
            return { success: true };
        }
        if (tool === 'claude') {
            // Install claude code CLI globally for the user
            try {
                (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', '-u', username, 'npm', 'install', '-g', '@anthropic-ai/claude-code@latest'], {
                    timeout: 120000,
                    stdio: 'pipe',
                    env: Object.assign(Object.assign({}, process.env), { HOME: homeDir }),
                });
            }
            catch (npmErr) {
                // Fallback: create config dir so checkToolExists detects it
                const claudeDir = path_1.default.join(homeDir, '.claude');
                try {
                    (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', 'install', '-d', '-o', username, claudeDir], { timeout: 5000, stdio: 'pipe' });
                }
                catch (_l) {
                    fs_1.default.mkdirSync(claudeDir, { recursive: true });
                }
                const msg = ((_f = (_e = (_d = npmErr === null || npmErr === void 0 ? void 0 : npmErr.stderr) === null || _d === void 0 ? void 0 : _d.toString) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.slice(0, 200)) || (npmErr === null || npmErr === void 0 ? void 0 : npmErr.message) || 'npm install failed';
                return { success: false, error: msg };
            }
            return { success: true };
        }
        if (tool === 'codex') {
            // Install codex CLI globally for the user
            try {
                (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', '-u', username, 'npm', 'install', '-g', '@openai/codex@latest'], {
                    timeout: 120000,
                    stdio: 'pipe',
                    env: Object.assign(Object.assign({}, process.env), { HOME: homeDir }),
                });
            }
            catch (npmErr) {
                // Fallback: create config dir so checkToolExists detects it
                const codexDir = path_1.default.join(homeDir, '.codex');
                try {
                    (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', 'install', '-d', '-o', username, codexDir], { timeout: 5000, stdio: 'pipe' });
                }
                catch (_m) {
                    fs_1.default.mkdirSync(codexDir, { recursive: true });
                }
                const msg = ((_j = (_h = (_g = npmErr === null || npmErr === void 0 ? void 0 : npmErr.stderr) === null || _g === void 0 ? void 0 : _g.toString) === null || _h === void 0 ? void 0 : _h.call(_g)) === null || _j === void 0 ? void 0 : _j.slice(0, 200)) || (npmErr === null || npmErr === void 0 ? void 0 : npmErr.message) || 'npm install failed';
                return { success: false, error: msg };
            }
            return { success: true };
        }
        return { success: false, error: `Unknown tool: ${tool}` };
    }
    catch (e) {
        return { success: false, error: (e === null || e === void 0 ? void 0 : e.message) || 'Unknown error' };
    }
}
/**
 * Discover real (non-system, non-service) OS-level user accounts.
 * macOS: dscl (Directory Services)
 * Linux: getent passwd
 *
 * Uses execFileSync (no shell) to prevent command injection.
 */
function discoverOsUsers() {
    const platform = os_1.default.platform();
    const users = [];
    try {
        if (platform === 'darwin') {
            // macOS: list users + UIDs via dscl (no shell needed)
            const raw = (0, child_process_1.execFileSync)('/usr/bin/dscl', ['.', 'list', '/Users', 'UniqueID'], { encoding: 'utf-8', timeout: 5000 });
            for (const line of raw.split('\n')) {
                const match = line.match(/^(\S+)\s+(\d+)$/);
                if (!match)
                    continue;
                const [, username, uidStr] = match;
                const uid = parseInt(uidStr, 10);
                // Skip system accounts (uid < 500 on macOS), special users, and known service accounts
                if (uid < 500 || username.startsWith('_') || username === 'nobody' || username === 'root' || username === 'daemon')
                    continue;
                if (SERVICE_ACCOUNTS.has(username))
                    continue;
                let homeDir = `/Users/${username}`;
                let shell = '/bin/zsh';
                try {
                    const info = (0, child_process_1.execFileSync)('/usr/bin/dscl', ['.', 'read', `/Users/${username}`, 'NFSHomeDirectory', 'UserShell'], { encoding: 'utf-8', timeout: 3000 });
                    const homeMatch = info.match(/NFSHomeDirectory:\s*(.+)/);
                    const shellMatch = info.match(/UserShell:\s*(.+)/);
                    if (homeMatch)
                        homeDir = homeMatch[1].trim();
                    if (shellMatch)
                        shell = shellMatch[1].trim();
                }
                catch (_a) { }
                const hasClaude = checkToolExists(homeDir, 'claude');
                const hasCodex = checkToolExists(homeDir, 'codex');
                const hasOpenclaw = checkToolExists(homeDir, 'openclaw');
                users.push({ username, uid, home_dir: homeDir, shell, linked_tenant_id: null, has_claude: hasClaude, has_codex: hasCodex, has_openclaw: hasOpenclaw, is_process_owner: false });
            }
        }
        else if (platform === 'linux') {
            // Linux: getent passwd returns colon-separated fields (no shell needed)
            const raw = (0, child_process_1.execFileSync)('/usr/bin/getent', ['passwd'], { encoding: 'utf-8', timeout: 5000 });
            for (const line of raw.split('\n')) {
                const parts = line.split(':');
                if (parts.length < 7)
                    continue;
                const [username, , uidStr, , , homeDir, shell] = parts;
                const uid = parseInt(uidStr, 10);
                // Skip system accounts (uid < 1000 on Linux), nfsnobody, and known service accounts
                if (uid < 1000 || username === 'nobody' || username === 'nfsnobody')
                    continue;
                if (SERVICE_ACCOUNTS.has(username))
                    continue;
                // Skip users with non-interactive shells (service accounts that slipped through)
                if (shell.endsWith('/nologin') || shell.endsWith('/false'))
                    continue;
                const hasClaude = checkToolExists(homeDir, 'claude');
                const hasCodex = checkToolExists(homeDir, 'codex');
                const hasOpenclaw = checkToolExists(homeDir, 'openclaw');
                users.push({ username, uid, home_dir: homeDir, shell, linked_tenant_id: null, has_claude: hasClaude, has_codex: hasCodex, has_openclaw: hasOpenclaw, is_process_owner: false });
            }
        }
    }
    catch (_b) {
        // If discovery fails (permissions, missing binary), return empty
    }
    return users.sort((a, b) => a.uid - b.uid);
}
/**
 * GET /api/super/os-users - Discover OS-level user accounts (admin only)
 *
 * Returns discovered OS users cross-referenced with existing tenants.
 * Users already linked to a tenant have linked_tenant_id set.
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const users = discoverOsUsers();
    // Mark the OS user that owns the MC process (represented by "Default" org)
    const processHomeDir = os_1.default.homedir();
    for (const user of users) {
        if (user.home_dir === processHomeDir) {
            user.is_process_owner = true;
        }
    }
    // Cross-reference with existing tenants to mark linked ones
    try {
        const { listTenants } = await Promise.resolve().then(() => __importStar(require('@/lib/super-admin')));
        const tenants = listTenants();
        const tenantByLinuxUser = new Map(tenants.map(t => [t.linux_user, t.id]));
        for (const user of users) {
            user.linked_tenant_id = (_a = tenantByLinuxUser.get(user.username)) !== null && _a !== void 0 ? _a : null;
        }
    }
    catch (_b) { }
    return server_1.NextResponse.json({ users, platform: os_1.default.platform() });
}
/**
 * POST /api/super/os-users - Create a new OS-level user and register as tenant (admin only)
 *
 * Local mode: creates OS user + home dir, registers in tenants table as active
 * Gateway mode: creates OS user + delegates to full bootstrap pipeline (openclaw + workspace + agents)
 *
 * Body: { username, display_name, password?, gateway_mode?: boolean, gateway_port?, owner_gateway? }
 */
async function POST(request) {
    var _a, _b, _c, _d;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const currentUser = (0, auth_1.getUserFromRequest)(request);
    const actor = (currentUser === null || currentUser === void 0 ? void 0 : currentUser.username) || 'system';
    let body;
    try {
        body = await request.json();
    }
    catch (_e) {
        return server_1.NextResponse.json({ error: 'Request body required' }, { status: 400 });
    }
    const username = String(body.username || '').trim().toLowerCase();
    const displayName = String(body.display_name || '').trim();
    const password = body.password ? String(body.password) : undefined;
    const gatewayMode = !!body.gateway_mode;
    const installOpenclaw = !!body.install_openclaw;
    const installClaude = !!body.install_claude;
    const installCodex = !!body.install_codex;
    // Validate username (safe for OS user creation — alphanumeric + dash/underscore)
    if (!/^[a-z][a-z0-9_-]{1,30}[a-z0-9]$/.test(username)) {
        return server_1.NextResponse.json({ error: 'Invalid username. Use lowercase letters, numbers, dashes, and underscores (3-32 chars).' }, { status: 400 });
    }
    if (!displayName) {
        return server_1.NextResponse.json({ error: 'display_name is required' }, { status: 400 });
    }
    if (SERVICE_ACCOUNTS.has(username)) {
        return server_1.NextResponse.json({ error: 'Cannot use a reserved service account name' }, { status: 400 });
    }
    // Check if user already exists on OS
    const existingUsers = discoverOsUsers();
    const alreadyExists = existingUsers.some(u => u.username === username);
    // Check if already registered as tenant
    const db = (0, db_1.getDatabase)();
    const existingTenant = db.prepare('SELECT id FROM tenants WHERE linux_user = ? OR slug = ?').get(username, username);
    if (existingTenant) {
        return server_1.NextResponse.json({ error: 'This user is already registered as an organization' }, { status: 409 });
    }
    const platform = os_1.default.platform();
    // Gateway mode: delegate to full provisioning pipeline
    if (gatewayMode) {
        try {
            const { createTenantAndBootstrapJob } = await Promise.resolve().then(() => __importStar(require('@/lib/super-admin')));
            const result = createTenantAndBootstrapJob({
                slug: username,
                display_name: displayName,
                linux_user: username,
                gateway_port: body.gateway_port ? Number(body.gateway_port) : undefined,
                owner_gateway: body.owner_gateway || undefined,
                dry_run: body.dry_run !== false,
                config: { install_openclaw: installOpenclaw, install_claude: installClaude, install_codex: installCodex },
            }, actor);
            return server_1.NextResponse.json(result, { status: 201 });
        }
        catch (e) {
            return server_1.NextResponse.json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Failed to create tenant bootstrap job' }, { status: 400 });
        }
    }
    // Local mode: create OS user directly + register in tenants table
    try {
        if (!alreadyExists) {
            if (platform === 'darwin') {
                // macOS: use sysadminctl to create user (requires admin/sudo)
                const args = ['-addUser', username, '-fullName', displayName, '-home', `/Users/${username}`];
                if (password) {
                    args.push('-password', password);
                }
                else {
                    args.push('-password', ''); // empty password, can be set later
                }
                try {
                    (0, child_process_1.execFileSync)('/usr/sbin/sysadminctl', args, { timeout: 15000, stdio: 'pipe' });
                }
                catch (e) {
                    // sysadminctl may need sudo — try with sudo
                    try {
                        (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', '/usr/sbin/sysadminctl', ...args], { timeout: 15000, stdio: 'pipe' });
                    }
                    catch (sudoErr) {
                        const msg = ((_b = (_a = sudoErr === null || sudoErr === void 0 ? void 0 : sudoErr.stderr) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) || (sudoErr === null || sudoErr === void 0 ? void 0 : sudoErr.message) || 'Failed to create OS user';
                        logger_1.logger.error({ err: sudoErr }, 'Failed to create macOS user');
                        return server_1.NextResponse.json({
                            error: `Failed to create OS user. This requires admin privileges. ${msg}`,
                            hint: 'Run Mission Control with sudo or grant the current user admin rights.',
                        }, { status: 500 });
                    }
                }
            }
            else if (platform === 'linux') {
                // Linux: useradd
                const args = ['-m', '-s', '/bin/bash', '-c', displayName, username];
                try {
                    (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', '/usr/sbin/useradd', ...args], { timeout: 15000, stdio: 'pipe' });
                }
                catch (e) {
                    const msg = ((_d = (_c = e === null || e === void 0 ? void 0 : e.stderr) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) || (e === null || e === void 0 ? void 0 : e.message) || 'Failed to create OS user';
                    logger_1.logger.error({ err: e }, 'Failed to create Linux user');
                    return server_1.NextResponse.json({
                        error: `Failed to create OS user: ${msg}`,
                        hint: 'Ensure the MC process user has passwordless sudo for useradd.',
                    }, { status: 500 });
                }
                // Set password if provided
                if (password) {
                    try {
                        (0, child_process_1.execFileSync)('/usr/bin/sudo', ['-n', '/usr/sbin/chpasswd'], {
                            timeout: 5000,
                            input: `${username}:${password}`,
                            stdio: ['pipe', 'pipe', 'pipe'],
                        });
                    }
                    catch (_f) {
                        // Non-critical — user created but password not set
                    }
                }
            }
            else {
                return server_1.NextResponse.json({ error: `OS user creation not supported on ${platform}` }, { status: 400 });
            }
        }
        // Determine home directory for the new user
        const homeDir = platform === 'darwin' ? `/Users/${username}` : `/home/${username}`;
        const openclawHome = path_1.default.posix.join(homeDir, '.openclaw');
        const workspaceRoot = path_1.default.posix.join(homeDir, 'workspace');
        // Register as tenant in DB
        const tenantRes = db.prepare(`
      INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, owner_gateway)
      VALUES (?, ?, ?, 'local', 'active', ?, ?, NULL, NULL, '{}', ?, 'local')
    `).run(username, displayName, username, openclawHome, workspaceRoot, actor);
        const tenantId = Number(tenantRes.lastInsertRowid);
        (0, db_1.logAuditEvent)({
            action: 'tenant_local_created',
            actor,
            target_type: 'tenant',
            target_id: tenantId,
            detail: { username, display_name: displayName, os_user_existed: alreadyExists, platform },
        });
        const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
        // Install requested tools (non-fatal)
        const installResults = {};
        const toolsToInstall = [];
        if (installOpenclaw)
            toolsToInstall.push('openclaw');
        // When openclaw is selected, claude+codex are bundled — skip separate installs
        if (installClaude && !installOpenclaw)
            toolsToInstall.push('claude');
        if (installCodex && !installOpenclaw)
            toolsToInstall.push('codex');
        for (const tool of toolsToInstall) {
            installResults[tool] = installToolForUser(homeDir, username, tool);
        }
        const installSummary = Object.entries(installResults)
            .map(([tool, r]) => r.success ? `${tool} installed` : `${tool} failed: ${r.error}`)
            .join('. ');
        const baseMsg = alreadyExists
            ? `OS user "${username}" already existed. Registered as organization.`
            : `OS user "${username}" created and registered as organization.`;
        return server_1.NextResponse.json({
            tenant,
            os_user_created: !alreadyExists,
            install_results: Object.keys(installResults).length > 0 ? installResults : undefined,
            message: installSummary ? `${baseMsg} ${installSummary}.` : baseMsg,
        }, { status: 201 });
    }
    catch (e) {
        if (String((e === null || e === void 0 ? void 0 : e.message) || '').includes('UNIQUE')) {
            return server_1.NextResponse.json({ error: 'Organization slug or user already exists' }, { status: 409 });
        }
        logger_1.logger.error({ err: e }, 'POST /api/super/os-users error');
        return server_1.NextResponse.json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Failed to create organization' }, { status: 500 });
    }
}
