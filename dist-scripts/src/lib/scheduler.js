import { getDatabase, logAuditEvent } from './db';
import { syncAgentsFromConfig } from './agent-sync';
import { config, ensureDirExists } from './config';
import { join, dirname } from 'path';
import { readdirSync, statSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { logger } from './logger';
import { runOpenClaw } from './command';
import { processWebhookRetries } from './webhooks';
import { syncClaudeSessions } from './claude-sessions';
import { pruneGatewaySessionsOlderThan } from './sessions';
import { syncSkillsFromDisk } from './skill-sync';
import { syncLocalAgents } from './local-agent-sync';
import { dispatchAssignedTasks, runAegisReviews } from './task-dispatch';
import { spawnRecurringTasks } from './recurring-tasks';
import { runInboxTriage } from './inbox-triage';
const BACKUP_DIR = join(dirname(config.dbPath), 'backups');
const tasks = new Map();
let tickInterval = null;
/** Check if a setting is enabled (reads from settings table, falls back to default) */
function isSettingEnabled(key, defaultValue) {
    try {
        const db = getDatabase();
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row)
            return row.value === 'true';
        return defaultValue;
    }
    catch (_a) {
        return defaultValue;
    }
}
function getSettingNumber(key, defaultValue) {
    try {
        const db = getDatabase();
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row)
            return parseInt(row.value) || defaultValue;
        return defaultValue;
    }
    catch (_a) {
        return defaultValue;
    }
}
/** Run a database backup */
async function runBackup() {
    ensureDirExists(BACKUP_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupPath = join(BACKUP_DIR, `mc-backup-${timestamp}.db`);
    try {
        const db = getDatabase();
        await db.backup(backupPath);
        const stat = statSync(backupPath);
        logAuditEvent({
            action: 'auto_backup',
            actor: 'scheduler',
            detail: { path: backupPath, size: stat.size },
        });
        // Prune old backups
        const maxBackups = getSettingNumber('general.backup_retention_count', 10);
        try {
            const files = readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith('mc-backup-') && f.endsWith('.db'))
                .map(f => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            for (const file of files.slice(maxBackups)) {
                unlinkSync(join(BACKUP_DIR, file.name));
            }
        }
        catch (_a) {
            // Best-effort pruning
        }
        const sizeKB = Math.round(stat.size / 1024);
        return { ok: true, message: `Backup created (${sizeKB}KB)` };
    }
    catch (err) {
        return { ok: false, message: `Backup failed: ${err.message}` };
    }
}
/** Run a scheduled OpenClaw backup (daily no-workspace or weekly full) */
async function runOpenClawBackup() {
    try {
        const schedule = (() => {
            try {
                const db = getDatabase();
                const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('general.openclaw_backup_schedule');
                return (row === null || row === void 0 ? void 0 : row.value) || 'daily';
            }
            catch (_a) {
                return 'daily';
            }
        })();
        const baseDir = join(homedir(), 'openclaw-backups');
        const subdir = schedule === 'weekly' ? 'weekly' : 'daily';
        const outputDir = join(baseDir, subdir);
        try {
            mkdirSync(outputDir, { recursive: true });
        }
        catch ( /* already exists */_a) { /* already exists */ }
        const args = schedule === 'weekly'
            ? ['backup', 'create', '--output', outputDir + '/']
            : ['backup', 'create', '--no-include-workspace', '--output', outputDir + '/'];
        const result = await runOpenClaw(args, { timeoutMs: 120000 });
        const ok = result.code === 0 || result.stdout.includes('Backup archive') || result.stderr.includes('Backup archive');
        const output = (result.stdout || result.stderr || '').trim().split('\n').pop() || '';
        if (ok) {
            // Lifecycle pruning
            const retentionDays = schedule === 'weekly' ? 30 : 14;
            const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
            try {
                readdirSync(outputDir)
                    .filter(f => f.endsWith('.tar.gz'))
                    .filter(f => statSync(join(outputDir, f)).mtimeMs < cutoff)
                    .forEach(f => unlinkSync(join(outputDir, f)));
            }
            catch ( /* best-effort */_b) { /* best-effort */ }
            logAuditEvent({ action: 'openclaw_backup', actor: 'scheduler', detail: { schedule, output } });
            return { ok: true, message: `OpenClaw ${schedule} backup complete: ${output}` };
        }
        return { ok: false, message: `OpenClaw backup failed (exit ${result.code}): ${output}` };
    }
    catch (err) {
        return { ok: false, message: `OpenClaw backup error: ${err.message}` };
    }
}
/** Run data cleanup based on retention settings */
async function runCleanup() {
    try {
        const db = getDatabase();
        const now = Math.floor(Date.now() / 1000);
        const ret = config.retention;
        let totalDeleted = 0;
        const targets = [
            { table: 'activities', column: 'created_at', days: ret.activities },
            { table: 'audit_log', column: 'created_at', days: ret.auditLog },
            { table: 'notifications', column: 'created_at', days: ret.notifications },
            { table: 'pipeline_runs', column: 'created_at', days: ret.pipelineRuns },
        ];
        for (const { table, column, days } of targets) {
            if (days <= 0)
                continue;
            const cutoff = now - days * 86400;
            try {
                const res = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(cutoff);
                totalDeleted += res.changes;
            }
            catch (_a) {
                // Table might not exist
            }
        }
        // Clean token usage file
        if (ret.tokenUsage > 0) {
            try {
                const { readFile, writeFile } = require('fs/promises');
                const raw = await readFile(config.tokensPath, 'utf-8');
                const data = JSON.parse(raw);
                const cutoffMs = Date.now() - ret.tokenUsage * 86400000;
                const kept = data.filter((r) => r.timestamp >= cutoffMs);
                const removed = data.length - kept.length;
                if (removed > 0) {
                    await writeFile(config.tokensPath, JSON.stringify(kept, null, 2));
                    totalDeleted += removed;
                }
            }
            catch (_b) {
                // No token file
            }
        }
        if (ret.gatewaySessions > 0) {
            const sessionCleanup = pruneGatewaySessionsOlderThan(ret.gatewaySessions);
            totalDeleted += sessionCleanup.deleted;
        }
        if (totalDeleted > 0) {
            logAuditEvent({
                action: 'auto_cleanup',
                actor: 'scheduler',
                detail: { total_deleted: totalDeleted },
            });
        }
        return { ok: true, message: `Cleaned ${totalDeleted} stale record${totalDeleted === 1 ? '' : 's'}` };
    }
    catch (err) {
        return { ok: false, message: `Cleanup failed: ${err.message}` };
    }
}
/** Check agent liveness - mark agents offline if not seen recently */
async function runHeartbeatCheck() {
    try {
        const db = getDatabase();
        const now = Math.floor(Date.now() / 1000);
        const timeoutMinutes = getSettingNumber('general.agent_timeout_minutes', 10);
        const threshold = now - timeoutMinutes * 60;
        // Find agents that are not offline but haven't been seen recently
        const staleAgents = db.prepare(`
      SELECT id, name, status, last_seen FROM agents
      WHERE status != 'offline' AND (last_seen IS NULL OR last_seen < ?)
    `).all(threshold);
        if (staleAgents.length === 0) {
            return { ok: true, message: 'All agents healthy' };
        }
        // Mark stale agents as offline
        const markOffline = db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?');
        const logActivity = db.prepare(`
      INSERT INTO activities (type, entity_type, entity_id, actor, description)
      VALUES ('agent_status_change', 'agent', ?, 'heartbeat', ?)
    `);
        const names = [];
        db.transaction(() => {
            for (const agent of staleAgents) {
                markOffline.run('offline', now, agent.id);
                logActivity.run(agent.id, `Agent "${agent.name}" marked offline (no heartbeat for ${timeoutMinutes}m)`);
                names.push(agent.name);
                // Create notification for each stale agent
                try {
                    db.prepare(`
            INSERT INTO notifications (recipient, type, title, message, source_type, source_id)
            VALUES ('system', 'heartbeat', ?, ?, 'agent', ?)
          `).run(`Agent offline: ${agent.name}`, `Agent "${agent.name}" was marked offline after ${timeoutMinutes} minutes without heartbeat`, agent.id);
                }
                catch ( /* notification creation failed */_a) { /* notification creation failed */ }
            }
        })();
        logAuditEvent({
            action: 'heartbeat_check',
            actor: 'scheduler',
            detail: { marked_offline: names },
        });
        return { ok: true, message: `Marked ${staleAgents.length} agent(s) offline: ${names.join(', ')}` };
    }
    catch (err) {
        return { ok: false, message: `Heartbeat check failed: ${err.message}` };
    }
}
const DAILY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000; // Check every minute
/** Initialize the scheduler */
export function initScheduler() {
    if (tickInterval)
        return; // Already running
    // Auto-sync agents from openclaw.json on startup
    syncAgentsFromConfig('startup').catch(err => {
        logger.warn({ err }, 'Agent auto-sync failed');
    });
    // Register tasks
    const now = Date.now();
    // Stagger the initial runs: backup at ~3 AM, cleanup at ~4 AM (relative to process start)
    const msUntilNextBackup = getNextDailyMs(3);
    const msUntilNextCleanup = getNextDailyMs(4);
    tasks.set('auto_backup', {
        name: 'Auto Backup',
        intervalMs: DAILY_MS,
        lastRun: null,
        nextRun: now + msUntilNextBackup,
        enabled: true,
        running: false,
    });
    tasks.set('auto_cleanup', {
        name: 'Auto Cleanup',
        intervalMs: DAILY_MS,
        lastRun: null,
        nextRun: now + msUntilNextCleanup,
        enabled: true,
        running: false,
    });
    tasks.set('agent_heartbeat', {
        name: 'Agent Heartbeat Check',
        intervalMs: FIVE_MINUTES_MS,
        lastRun: null,
        nextRun: now + FIVE_MINUTES_MS,
        enabled: true,
        running: false,
    });
    tasks.set('webhook_retry', {
        name: 'Webhook Retry',
        intervalMs: TICK_MS, // Every 60s, matching scheduler tick resolution
        lastRun: null,
        nextRun: now + TICK_MS,
        enabled: true,
        running: false,
    });
    tasks.set('claude_session_scan', {
        name: 'Claude Session Scan',
        intervalMs: TICK_MS, // Every 60s — lightweight file stat checks
        lastRun: null,
        nextRun: now + 5000, // First scan 5s after startup
        enabled: true,
        running: false,
    });
    tasks.set('skill_sync', {
        name: 'Skill Sync',
        intervalMs: TICK_MS, // Every 60s — lightweight file stat checks
        lastRun: null,
        nextRun: now + 10000, // First scan 10s after startup
        enabled: true,
        running: false,
    });
    tasks.set('local_agent_sync', {
        name: 'Local Agent Sync',
        intervalMs: TICK_MS, // Every 60s — lightweight dir scan
        lastRun: null,
        nextRun: now + 15000, // First scan 15s after startup
        enabled: true,
        running: false,
    });
    tasks.set('gateway_agent_sync', {
        name: 'Gateway Agent Sync',
        intervalMs: TICK_MS, // Every 60s — re-read openclaw.json
        lastRun: null,
        nextRun: now + 20000, // First scan 20s after startup (after local sync)
        enabled: true,
        running: false,
    });
    tasks.set('task_dispatch', {
        name: 'Task Dispatch',
        intervalMs: TICK_MS, // Every 60s — check for assigned tasks to dispatch
        lastRun: null,
        nextRun: now + 10000, // First check 10s after startup
        enabled: true,
        running: false,
    });
    tasks.set('aegis_review', {
        name: 'Aegis Quality Review',
        intervalMs: TICK_MS, // Every 60s — check for tasks awaiting review
        lastRun: null,
        nextRun: now + 30000, // First check 30s after startup (after dispatch)
        enabled: true,
        running: false,
    });
    tasks.set('recurring_task_spawn', {
        name: 'Recurring Task Spawn',
        intervalMs: TICK_MS, // Every 60s — check for recurring tasks due
        lastRun: null,
        nextRun: now + 20000, // First check 20s after startup
        enabled: true,
        running: false,
    });
    tasks.set('inbox_triage', {
        name: 'Inbox Triage',
        intervalMs: 30 * 60 * 1000, // Every 30 minutes
        lastRun: null,
        nextRun: now + 60000, // First check 60s after startup
        enabled: true,
        running: false,
    });
    tasks.set('openclaw_backup', {
        name: 'OpenClaw Backup',
        intervalMs: DAILY_MS,
        lastRun: null,
        nextRun: now + getNextDailyMs(6), // Next 6 AM UTC (matches daily cron)
        enabled: true,
        running: false,
    });
    // Start the tick loop
    tickInterval = setInterval(tick, TICK_MS);
    logger.info('Scheduler initialized - backup at ~3AM, cleanup at ~4AM, heartbeat every 5m, webhook/claude/skill/local-agent/gateway-agent sync every 60s');
}
/** Calculate ms until next occurrence of a given hour (UTC) */
function getNextDailyMs(hour) {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
}
/** Check and run due tasks */
async function tick() {
    const now = Date.now();
    for (const [id, task] of tasks) {
        if (task.running || now < task.nextRun)
            continue;
        // Check if this task is enabled in settings (heartbeat is always enabled)
        const settingKey = id === 'auto_backup' ? 'general.auto_backup'
            : id === 'auto_cleanup' ? 'general.auto_cleanup'
                : id === 'webhook_retry' ? 'webhooks.retry_enabled'
                    : id === 'claude_session_scan' ? 'general.claude_session_scan'
                        : id === 'skill_sync' ? 'general.skill_sync'
                            : id === 'local_agent_sync' ? 'general.local_agent_sync'
                                : id === 'gateway_agent_sync' ? 'general.gateway_agent_sync'
                                    : id === 'task_dispatch' ? 'general.task_dispatch'
                                        : id === 'aegis_review' ? 'general.aegis_review'
                                            : id === 'recurring_task_spawn' ? 'general.recurring_task_spawn'
                                                : id === 'inbox_triage' ? 'general.inbox_triage'
                                                    : id === 'openclaw_backup' ? 'general.openclaw_backup_enabled'
                                                        : 'general.agent_heartbeat';
        const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan' || id === 'skill_sync' || id === 'local_agent_sync' || id === 'gateway_agent_sync' || id === 'task_dispatch' || id === 'aegis_review' || id === 'recurring_task_spawn' || id === 'inbox_triage';
        if (!isSettingEnabled(settingKey, defaultEnabled))
            continue;
        task.running = true;
        try {
            const result = id === 'auto_backup' ? await runBackup()
                : id === 'agent_heartbeat' ? await runHeartbeatCheck()
                    : id === 'webhook_retry' ? await processWebhookRetries()
                        : id === 'claude_session_scan' ? await syncClaudeSessions()
                            : id === 'skill_sync' ? await syncSkillsFromDisk()
                                : id === 'local_agent_sync' ? await syncLocalAgents()
                                    : id === 'gateway_agent_sync' ? await syncAgentsFromConfig('scheduled').then(r => ({ ok: true, message: `Gateway sync: ${r.created} created, ${r.updated} updated, ${r.synced} total` }))
                                        : id === 'task_dispatch' ? await dispatchAssignedTasks()
                                            : id === 'aegis_review' ? await runAegisReviews()
                                                : id === 'recurring_task_spawn' ? await spawnRecurringTasks()
                                                    : id === 'inbox_triage' ? await runInboxTriage()
                                                        : id === 'openclaw_backup' ? await runOpenClawBackup()
                                                            : await runCleanup();
            task.lastResult = Object.assign(Object.assign({}, result), { timestamp: now });
        }
        catch (err) {
            task.lastResult = { ok: false, message: err.message, timestamp: now };
        }
        finally {
            task.running = false;
            task.lastRun = now;
            task.nextRun = now + task.intervalMs;
        }
    }
}
/** Get scheduler status (for API) */
export function getSchedulerStatus() {
    const result = [];
    for (const [id, task] of tasks) {
        const settingKey = id === 'auto_backup' ? 'general.auto_backup'
            : id === 'auto_cleanup' ? 'general.auto_cleanup'
                : id === 'webhook_retry' ? 'webhooks.retry_enabled'
                    : id === 'claude_session_scan' ? 'general.claude_session_scan'
                        : id === 'skill_sync' ? 'general.skill_sync'
                            : id === 'local_agent_sync' ? 'general.local_agent_sync'
                                : id === 'gateway_agent_sync' ? 'general.gateway_agent_sync'
                                    : id === 'task_dispatch' ? 'general.task_dispatch'
                                        : id === 'aegis_review' ? 'general.aegis_review'
                                            : id === 'recurring_task_spawn' ? 'general.recurring_task_spawn'
                                                : id === 'inbox_triage' ? 'general.inbox_triage'
                                                    : id === 'openclaw_backup' ? 'general.openclaw_backup_enabled'
                                                        : 'general.agent_heartbeat';
        const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan' || id === 'skill_sync' || id === 'local_agent_sync' || id === 'gateway_agent_sync' || id === 'task_dispatch' || id === 'aegis_review' || id === 'recurring_task_spawn' || id === 'inbox_triage';
        result.push({
            id,
            name: task.name,
            enabled: isSettingEnabled(settingKey, defaultEnabled),
            lastRun: task.lastRun,
            nextRun: task.nextRun,
            running: task.running,
            lastResult: task.lastResult,
        });
    }
    return result;
}
/** Manually trigger a scheduled task */
export async function triggerTask(taskId) {
    if (taskId === 'auto_backup')
        return runBackup();
    if (taskId === 'auto_cleanup')
        return runCleanup();
    if (taskId === 'agent_heartbeat')
        return runHeartbeatCheck();
    if (taskId === 'webhook_retry')
        return processWebhookRetries();
    if (taskId === 'claude_session_scan')
        return syncClaudeSessions();
    if (taskId === 'skill_sync')
        return syncSkillsFromDisk();
    if (taskId === 'local_agent_sync')
        return syncLocalAgents();
    if (taskId === 'gateway_agent_sync')
        return syncAgentsFromConfig('manual').then(r => ({ ok: true, message: `Gateway sync: ${r.created} created, ${r.updated} updated, ${r.synced} total` }));
    if (taskId === 'task_dispatch')
        return dispatchAssignedTasks();
    if (taskId === 'aegis_review')
        return runAegisReviews();
    if (taskId === 'recurring_task_spawn')
        return spawnRecurringTasks();
    if (taskId === 'inbox_triage')
        return runInboxTriage();
    if (taskId === 'openclaw_backup')
        return runOpenClawBackup();
    return { ok: false, message: `Unknown task: ${taskId}` };
}
/** Stop the scheduler */
export function stopScheduler() {
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
}
