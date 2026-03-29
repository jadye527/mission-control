"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const node_net_1 = __importDefault(require("node:net"));
const node_os_1 = __importDefault(require("node:os"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const command_1 = require("@/lib/command");
const config_1 = require("@/lib/config");
const db_1 = require("@/lib/db");
const sessions_1 = require("@/lib/sessions");
const auth_1 = require("@/lib/auth");
const models_1 = require("@/lib/models");
const logger_1 = require("@/lib/logger");
const provider_subscriptions_1 = require("@/lib/provider-subscriptions");
const version_1 = require("@/lib/version");
const hermes_sessions_1 = require("@/lib/hermes-sessions");
const gateway_runtime_1 = require("@/lib/gateway-runtime");
async function GET(request) {
    var _a, _b;
    // Docker/Kubernetes health probes must work without auth/cookies.
    const preAction = new URL(request.url).searchParams.get('action') || 'overview';
    if (preAction === 'health') {
        const health = await performHealthCheck();
        return server_1.NextResponse.json(health);
    }
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action') || 'overview';
        if (action === 'overview') {
            const status = await getSystemStatus((_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1);
            return server_1.NextResponse.json(status);
        }
        if (action === 'dashboard') {
            const data = await getDashboardData((_b = auth.user.workspace_id) !== null && _b !== void 0 ? _b : 1);
            return server_1.NextResponse.json(data);
        }
        if (action === 'gateway') {
            const gatewayStatus = await getGatewayStatus();
            return server_1.NextResponse.json(gatewayStatus);
        }
        if (action === 'models') {
            const models = await getAvailableModels();
            return server_1.NextResponse.json({ models });
        }
        if (action === 'health') {
            const health = await performHealthCheck();
            return server_1.NextResponse.json(health);
        }
        if (action === 'capabilities') {
            const capabilities = await getCapabilities(request);
            return server_1.NextResponse.json(capabilities);
        }
        return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Status API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
/**
 * Aggregate all dashboard data in a single request.
 * Combines system health, DB stats, audit summary, and recent activity.
 */
async function getDashboardData(workspaceId) {
    const [system, dbStats] = await Promise.all([
        getSystemStatus(workspaceId),
        getDbStats(workspaceId),
    ]);
    return Object.assign(Object.assign({}, system), { db: dbStats });
}
async function getMemorySnapshot() {
    const totalBytes = node_os_1.default.totalmem();
    let availableBytes = node_os_1.default.freemem();
    if (process.platform === 'darwin') {
        try {
            const { stdout } = await (0, command_1.runCommand)('vm_stat', [], { timeoutMs: 3000 });
            const pageSizeMatch = stdout.match(/page size of (\d+) bytes/i);
            const pageSize = parseInt((pageSizeMatch === null || pageSizeMatch === void 0 ? void 0 : pageSizeMatch[1]) || '4096', 10);
            const pageLabels = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable'];
            const availablePages = pageLabels.reduce((sum, label) => {
                const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const match = stdout.match(new RegExp(`${escapedLabel}:\\s+([\\d.]+)`, 'i'));
                const pages = parseInt(((match === null || match === void 0 ? void 0 : match[1]) || '0').replace(/\./g, ''), 10);
                return sum + (Number.isFinite(pages) ? pages : 0);
            }, 0);
            const vmAvailableBytes = availablePages * pageSize;
            if (vmAvailableBytes > 0) {
                availableBytes = Math.min(vmAvailableBytes, totalBytes);
            }
        }
        catch (_a) {
            // Fall back to os.freemem()
        }
    }
    else {
        try {
            const { stdout } = await (0, command_1.runCommand)('free', ['-b'], { timeoutMs: 3000 });
            const memLine = stdout.split('\n').find((line) => line.startsWith('Mem:'));
            if (memLine) {
                const parts = memLine.trim().split(/\s+/);
                const available = parseInt(parts[6] || parts[3] || '0', 10);
                if (Number.isFinite(available) && available > 0) {
                    availableBytes = Math.min(available, totalBytes);
                }
            }
        }
        catch (_b) {
            // Fall back to os.freemem()
        }
    }
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    return {
        totalBytes,
        availableBytes,
        usedBytes,
        usagePercent,
    };
}
function getDbStats(workspaceId) {
    try {
        const db = (0, db_1.getDatabase)();
        const now = Math.floor(Date.now() / 1000);
        const day = now - 86400;
        const week = now - 7 * 86400;
        // Task breakdown
        const taskStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId);
        const tasksByStatus = {};
        let totalTasks = 0;
        for (const row of taskStats) {
            tasksByStatus[row.status] = row.count;
            totalTasks += row.count;
        }
        // Agent breakdown
        const agentStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM agents WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId);
        const agentsByStatus = {};
        let totalAgents = 0;
        for (const row of agentStats) {
            agentsByStatus[row.status] = row.count;
            totalAgents += row.count;
        }
        // Audit events (24h / 7d)
        const auditDay = db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(day).c;
        const auditWeek = db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(week).c;
        // Security events (login failures in last 24h)
        const loginFailures = db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE action = 'login_failed' AND created_at > ?").get(day).c;
        // Activities (24h)
        const activityDay = db.prepare('SELECT COUNT(*) as c FROM activities WHERE created_at > ? AND workspace_id = ?').get(day, workspaceId).c;
        // Notifications (unread)
        const unreadNotifs = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL AND workspace_id = ?').get(workspaceId).c;
        // Pipeline runs (active + recent)
        let pipelineActive = 0;
        let pipelineRecent = 0;
        try {
            pipelineActive = db.prepare("SELECT COUNT(*) as c FROM pipeline_runs WHERE workspace_id = ? AND status = 'running'").get(workspaceId).c;
            pipelineRecent = db.prepare('SELECT COUNT(*) as c FROM pipeline_runs WHERE workspace_id = ? AND created_at > ?').get(workspaceId, day).c;
        }
        catch (_a) {
            // Pipeline tables may not exist yet
        }
        // Latest backup
        let latestBackup = null;
        try {
            const { readdirSync } = require('fs');
            const { join, dirname } = require('path');
            const backupDir = join(dirname(config_1.config.dbPath), 'backups');
            const files = readdirSync(backupDir)
                .filter((f) => f.endsWith('.db'))
                .map((f) => {
                const stat = (0, node_fs_1.statSync)(join(backupDir, f));
                return { name: f, size: stat.size, mtime: stat.mtimeMs };
            })
                .sort((a, b) => b.mtime - a.mtime);
            if (files.length > 0) {
                latestBackup = {
                    name: files[0].name,
                    size: files[0].size,
                    age_hours: Math.round((Date.now() - files[0].mtime) / 3600000),
                };
            }
        }
        catch (_b) {
            // No backups dir
        }
        // DB file size
        let dbSizeBytes = 0;
        try {
            dbSizeBytes = (0, node_fs_1.statSync)(config_1.config.dbPath).size;
        }
        catch (_c) {
            // ignore
        }
        // Webhook configs count
        let webhookCount = 0;
        try {
            webhookCount = db.prepare('SELECT COUNT(*) as c FROM webhooks').get().c;
        }
        catch (_d) {
            // table may not exist
        }
        return {
            tasks: { total: totalTasks, byStatus: tasksByStatus },
            agents: { total: totalAgents, byStatus: agentsByStatus },
            audit: { day: auditDay, week: auditWeek, loginFailures },
            activities: { day: activityDay },
            notifications: { unread: unreadNotifs },
            pipelines: { active: pipelineActive, recentDay: pipelineRecent },
            backup: latestBackup,
            dbSizeBytes,
            webhookCount,
        };
    }
    catch (err) {
        logger_1.logger.error({ err }, 'getDbStats error');
        return null;
    }
}
async function getSystemStatus(workspaceId) {
    const status = {
        timestamp: Date.now(),
        uptime: 0,
        memory: { total: 0, used: 0, available: 0 },
        disk: { total: 0, used: 0, available: 0 },
        sessions: { total: 0, active: 0 },
        processes: []
    };
    try {
        // System uptime (cross-platform)
        if (process.platform === 'darwin') {
            const { stdout } = await (0, command_1.runCommand)('sysctl', ['-n', 'kern.boottime'], {
                timeoutMs: 3000
            });
            // Output format: { sec = 1234567890, usec = 0 } ...
            const match = stdout.match(/sec\s*=\s*(\d+)/);
            if (match) {
                status.uptime = Date.now() - parseInt(match[1]) * 1000;
            }
        }
        else {
            const { stdout } = await (0, command_1.runCommand)('uptime', ['-s'], {
                timeoutMs: 3000
            });
            const bootTime = new Date(stdout.trim());
            status.uptime = Date.now() - bootTime.getTime();
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error getting uptime');
    }
    try {
        // Memory info (cross-platform)
        const snapshot = await getMemorySnapshot();
        status.memory = {
            total: Math.round(snapshot.totalBytes / (1024 * 1024)),
            used: Math.round(snapshot.usedBytes / (1024 * 1024)),
            available: Math.round(snapshot.availableBytes / (1024 * 1024)),
        };
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error getting memory info');
    }
    try {
        // Disk info
        const { stdout: diskOutput } = await (0, command_1.runCommand)('df', ['-h', '/'], {
            timeoutMs: 3000
        });
        const lastLine = diskOutput.trim().split('\n').pop() || '';
        const diskParts = lastLine.split(/\s+/);
        if (diskParts.length >= 4) {
            status.disk = {
                total: diskParts[1],
                used: diskParts[2],
                available: diskParts[3],
                usage: diskParts[4]
            };
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error getting disk info');
    }
    try {
        // ClawdBot processes
        const { stdout: processOutput } = await (0, command_1.runCommand)('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 });
        const processes = processOutput.split('\n')
            .filter(line => line.trim())
            .filter(line => !line.trim().toLowerCase().startsWith('pid '))
            .map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                pid: parts[0],
                command: parts.slice(2).join(' ')
            };
        })
            .filter((proc) => /clawdbot|openclaw/i.test(proc.command));
        status.processes = processes;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error getting process info');
    }
    try {
        // Read sessions directly from agent session stores on disk
        const gatewaySessions = (0, sessions_1.getAllGatewaySessions)();
        status.sessions = {
            total: gatewaySessions.length,
            active: gatewaySessions.filter((s) => s.active).length,
        };
        // Sync agent statuses in DB from live session data
        try {
            const db = (0, db_1.getDatabase)();
            const liveStatuses = (0, sessions_1.getAgentLiveStatuses)();
            const now = Math.floor(Date.now() / 1000);
            // Match by: exact name, lowercase, or normalized (spaces→hyphens)
            const updateStmt = db.prepare(`UPDATE agents SET status = ?, last_seen = ?, updated_at = ?
         WHERE workspace_id = ?
           AND (LOWER(name) = LOWER(?)
           OR LOWER(REPLACE(name, ' ', '-')) = LOWER(?))`);
            for (const [agentName, info] of liveStatuses) {
                updateStmt.run(info.status, Math.floor(info.lastActivity / 1000), now, workspaceId, agentName, agentName);
            }
        }
        catch (dbErr) {
            logger_1.logger.error({ err: dbErr }, 'Error syncing agent statuses');
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error reading session stores');
    }
    return status;
}
async function getGatewayStatus() {
    const gatewayStatus = {
        running: false,
        port: config_1.config.gatewayPort,
        pid: null,
        uptime: 0,
        version: null,
        connections: 0
    };
    try {
        const { stdout } = await (0, command_1.runCommand)('ps', ['-A', '-o', 'pid,comm,args'], {
            timeoutMs: 3000
        });
        const match = stdout
            .split('\n')
            .find((line) => /clawdbot-gateway|openclaw-gateway|openclaw.*gateway/i.test(line));
        if (match) {
            const parts = match.trim().split(/\s+/);
            gatewayStatus.running = true;
            gatewayStatus.pid = parts[0];
        }
    }
    catch (error) {
        // Gateway not running
    }
    try {
        gatewayStatus.port_listening = await isPortOpen(config_1.config.gatewayHost, config_1.config.gatewayPort);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error checking port');
    }
    try {
        const { stdout } = await (0, command_1.runOpenClaw)(['--version'], { timeoutMs: 3000 });
        gatewayStatus.version = stdout.trim();
    }
    catch (error) {
        try {
            const { stdout } = await (0, command_1.runClawdbot)(['--version'], { timeoutMs: 3000 });
            gatewayStatus.version = stdout.trim();
        }
        catch (innerError) {
            gatewayStatus.version = 'unknown';
        }
    }
    return gatewayStatus;
}
async function getAvailableModels() {
    // This would typically query the gateway or config files
    // Model catalog is the single source of truth
    const models = [...models_1.MODEL_CATALOG];
    try {
        // Check which Ollama models are available locally
        const { stdout: ollamaOutput } = await (0, command_1.runCommand)('ollama', ['list'], {
            timeoutMs: 5000
        });
        const ollamaModels = ollamaOutput.split('\n')
            .slice(1) // Skip header
            .filter(line => line.trim())
            .map(line => {
            const parts = line.split(/\s+/);
            return {
                alias: parts[0],
                name: `ollama/${parts[0]}`,
                provider: 'ollama',
                description: 'Local model',
                costPer1k: 0.0,
                size: parts[1] || 'unknown'
            };
        });
        // Add Ollama models that aren't already in the list
        ollamaModels.forEach(model => {
            if (!models.find(m => m.name === model.name)) {
                models.push(model);
            }
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error checking Ollama models');
    }
    return models;
}
async function performHealthCheck() {
    const health = {
        status: 'healthy',
        version: version_1.APP_VERSION,
        uptime: process.uptime(),
        checks: [],
        timestamp: Date.now()
    };
    // Check DB connectivity
    try {
        const db = (0, db_1.getDatabase)();
        const start = Date.now();
        db.prepare('SELECT 1').get();
        const elapsed = Date.now() - start;
        let dbStatus;
        if (elapsed > 1000) {
            dbStatus = 'warning';
        }
        else {
            dbStatus = 'healthy';
        }
        health.checks.push({
            name: 'Database',
            status: dbStatus,
            message: dbStatus === 'healthy' ? `DB reachable (${elapsed}ms)` : `DB slow (${elapsed}ms)`
        });
    }
    catch (error) {
        health.checks.push({
            name: 'Database',
            status: 'unhealthy',
            message: 'DB connectivity failed'
        });
    }
    // Check process memory
    try {
        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / (1024 * 1024));
        let memStatus = 'healthy';
        if (mem.rss > 800 * 1024 * 1024) {
            memStatus = 'critical';
        }
        else if (mem.rss > 400 * 1024 * 1024) {
            memStatus = 'warning';
        }
        health.checks.push({
            name: 'Process Memory',
            status: memStatus,
            message: `RSS: ${rssMB}MB, Heap: ${Math.round(mem.heapUsed / (1024 * 1024))}/${Math.round(mem.heapTotal / (1024 * 1024))}MB`,
            detail: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
            }
        });
    }
    catch (error) {
        health.checks.push({
            name: 'Process Memory',
            status: 'error',
            message: 'Failed to check process memory'
        });
    }
    // Check gateway connection
    try {
        const gatewayStatus = await getGatewayStatus();
        health.checks.push({
            name: 'Gateway',
            status: gatewayStatus.running ? 'healthy' : 'unhealthy',
            message: gatewayStatus.running ? 'Gateway is running' : 'Gateway is not running'
        });
    }
    catch (error) {
        health.checks.push({
            name: 'Gateway',
            status: 'error',
            message: 'Failed to check gateway status'
        });
    }
    // Check disk space (cross-platform: use df -h / and parse capacity column)
    try {
        const { stdout } = await (0, command_1.runCommand)('df', ['-h', '/'], {
            timeoutMs: 3000
        });
        const lines = stdout.trim().split('\n');
        const last = lines[lines.length - 1] || '';
        const parts = last.split(/\s+/);
        // On macOS capacity is col 4 ("85%"), on Linux use% is col 4 as well
        const pctField = parts.find(p => p.endsWith('%')) || '0%';
        const usagePercent = parseInt(pctField.replace('%', '') || '0');
        health.checks.push({
            name: 'Disk Space',
            status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
            message: `Disk usage: ${usagePercent}%`
        });
    }
    catch (error) {
        health.checks.push({
            name: 'Disk Space',
            status: 'error',
            message: 'Failed to check disk space'
        });
    }
    // Check memory usage (cross-platform)
    try {
        const usagePercent = (await getMemorySnapshot()).usagePercent;
        health.checks.push({
            name: 'Memory Usage',
            status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
            message: `Memory usage: ${usagePercent}%`
        });
    }
    catch (error) {
        health.checks.push({
            name: 'Memory Usage',
            status: 'error',
            message: 'Failed to check memory usage'
        });
    }
    // Determine overall health
    const hasError = health.checks.some((check) => check.status === 'error');
    const hasCritical = health.checks.some((check) => check.status === 'critical');
    const hasWarning = health.checks.some((check) => check.status === 'warning');
    const hasDegraded = health.checks.some((check) => check.name === 'Database' && check.status === 'warning');
    if (hasError || hasCritical) {
        health.status = 'unhealthy';
    }
    else if (hasDegraded) {
        health.status = 'degraded';
    }
    else if (hasWarning) {
        health.status = 'warning';
    }
    return health;
}
async function getCapabilities(request) {
    var _a;
    // Probe configured gateways (if any) or fall back to the default port.
    // A DB row alone isn't enough — the gateway must actually be reachable.
    let gatewayReachable = false;
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gateways'").get();
        if (table === null || table === void 0 ? void 0 : table.name) {
            const rows = db.prepare('SELECT host, port FROM gateways').all();
            if (rows.length > 0) {
                const probes = rows.map(r => isPortOpen(r.host, Number(r.port)));
                const results = await Promise.all(probes);
                gatewayReachable = results.some(Boolean);
            }
        }
    }
    catch (_b) {
        // ignore — fall through to default probe
    }
    const gateway = gatewayReachable || await isPortOpen(config_1.config.gatewayHost, config_1.config.gatewayPort);
    const openclawHome = Boolean((config_1.config.openclawStateDir && (0, node_fs_1.existsSync)(config_1.config.openclawStateDir)) ||
        (config_1.config.openclawConfigPath && (0, node_fs_1.existsSync)(config_1.config.openclawConfigPath)));
    const claudeProjectsPath = node_path_1.default.join(config_1.config.claudeHome, 'projects');
    const claudeHome = (0, node_fs_1.existsSync)(claudeProjectsPath);
    let claudeSessions = 0;
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare("SELECT COUNT(*) as c FROM claude_sessions WHERE is_active = 1").get();
        claudeSessions = (_a = row === null || row === void 0 ? void 0 : row.c) !== null && _a !== void 0 ? _a : 0;
    }
    catch (_c) {
        // claude_sessions table may not exist
    }
    const subscriptions = (0, provider_subscriptions_1.detectProviderSubscriptions)().active;
    const primary = (0, provider_subscriptions_1.getPrimarySubscription)();
    const subscription = primary ? {
        type: primary.type,
        provider: primary.provider,
    } : null;
    // Apply subscription overrides from settings
    try {
        const settingsDb = (0, db_1.getDatabase)();
        const planOverride = settingsDb.prepare("SELECT value FROM settings WHERE key = 'subscription.plan_override'").get();
        if ((planOverride === null || planOverride === void 0 ? void 0 : planOverride.value) && subscription) {
            subscription.type = planOverride.value;
        }
        const codexPlan = settingsDb.prepare("SELECT value FROM settings WHERE key = 'subscription.codex_plan'").get();
        if (codexPlan === null || codexPlan === void 0 ? void 0 : codexPlan.value) {
            subscriptions['openai'] = { provider: 'openai', type: codexPlan.value, source: 'env' };
        }
    }
    catch (_d) {
        // settings table may not exist yet
    }
    const processUser = process.env.MC_DEFAULT_ORG_NAME || node_os_1.default.userInfo().username;
    // Interface mode preference
    let interfaceMode = 'essential';
    try {
        const settingsDb = (0, db_1.getDatabase)();
        const modeRow = settingsDb.prepare("SELECT value FROM settings WHERE key = 'general.interface_mode'").get();
        if ((modeRow === null || modeRow === void 0 ? void 0 : modeRow.value) === 'full' || (modeRow === null || modeRow === void 0 ? void 0 : modeRow.value) === 'essential') {
            interfaceMode = modeRow.value;
        }
    }
    catch (_e) {
        // settings table may not exist yet
    }
    const hermesInstalled = (0, hermes_sessions_1.isHermesInstalled)();
    let hermesSessions = 0;
    if (hermesInstalled) {
        try {
            hermesSessions = (0, hermes_sessions_1.scanHermesSessions)(50).filter(s => s.isActive).length;
        }
        catch ( /* ignore */_f) { /* ignore */ }
    }
    // Auto-register MC as default dashboard when gateway + openclaw home detected
    let dashboardRegistration = null;
    if (gateway && openclawHome) {
        try {
            let mcUrl = process.env.MC_BASE_URL || '';
            if (!mcUrl && request) {
                const host = request.headers.get('host');
                const proto = request.headers.get('x-forwarded-proto') || 'http';
                if (host)
                    mcUrl = `${proto}://${host}`;
            }
            if (mcUrl) {
                dashboardRegistration = (0, gateway_runtime_1.registerMcAsDashboard)(mcUrl);
            }
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Dashboard registration failed');
        }
    }
    return { gateway, openclawHome, claudeHome, claudeSessions, hermesInstalled, hermesSessions, subscription, subscriptions, processUser, interfaceMode, dashboardRegistration };
}
function isPortOpen(host, port) {
    return new Promise((resolve) => {
        const socket = new node_net_1.default.Socket();
        const timeoutMs = 1500;
        const cleanup = () => {
            socket.removeAllListeners();
            socket.destroy();
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => {
            cleanup();
            resolve(true);
        });
        socket.once('timeout', () => {
            cleanup();
            resolve(false);
        });
        socket.once('error', () => {
            cleanup();
            resolve(false);
        });
        socket.connect(port, host);
    });
}
