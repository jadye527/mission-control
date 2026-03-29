"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const config_1 = require("@/lib/config");
const rate_limit_1 = require("@/lib/rate-limit");
const sessions_1 = require("@/lib/sessions");
/**
 * GET /api/cleanup - Show retention policy and what would be cleaned
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    const now = Math.floor(Date.now() / 1000);
    const ret = config_1.config.retention;
    const preview = [];
    for (const { table, column, days, label, scoped } of getRetentionTargets()) {
        if (days <= 0) {
            preview.push({ table: label, retention_days: 0, stale_count: 0, note: 'Retention disabled (keep forever)' });
            continue;
        }
        const cutoff = now - days * 86400;
        try {
            const wsClause = scoped ? ' AND workspace_id = ?' : '';
            const params = scoped ? [cutoff, workspaceId] : [cutoff];
            const row = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} < ?${wsClause}`).get(...params);
            preview.push({
                table: label,
                retention_days: days,
                cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
                stale_count: row.c,
            });
        }
        catch (_b) {
            preview.push({ table: label, retention_days: days, stale_count: 0, note: 'Table not found' });
        }
    }
    // Token usage file stats
    try {
        const { readFile } = require('fs/promises');
        const data = JSON.parse(await readFile(config_1.config.tokensPath, 'utf-8'));
        const cutoffMs = Date.now() - ret.tokenUsage * 86400000;
        const stale = data.filter((r) => r.timestamp < cutoffMs).length;
        preview.push({
            table: 'Token Usage (file)',
            retention_days: ret.tokenUsage,
            cutoff_date: new Date(cutoffMs).toISOString().split('T')[0],
            stale_count: stale,
        });
    }
    catch (_c) {
        preview.push({ table: 'Token Usage (file)', retention_days: ret.tokenUsage, stale_count: 0, note: 'No token data file' });
    }
    if (ret.gatewaySessions > 0) {
        preview.push({
            table: 'Gateway Session Store',
            retention_days: ret.gatewaySessions,
            stale_count: (0, sessions_1.countStaleGatewaySessions)(ret.gatewaySessions),
            note: 'Stored under ~/.openclaw/agents/*/sessions/sessions.json',
        });
    }
    else {
        preview.push({ table: 'Gateway Session Store', retention_days: 0, stale_count: 0, note: 'Retention disabled (keep forever)' });
    }
    return server_1.NextResponse.json({ retention: config_1.config.retention, preview });
}
/**
 * POST /api/cleanup - Run cleanup (admin only)
 * Body: { dry_run?: boolean }
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.heavyLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    const now = Math.floor(Date.now() / 1000);
    const results = [];
    let totalDeleted = 0;
    for (const { table, column, days, label, scoped } of getRetentionTargets()) {
        if (days <= 0)
            continue;
        const cutoff = now - days * 86400;
        const wsClause = scoped ? ' AND workspace_id = ?' : '';
        const params = scoped ? [cutoff, workspaceId] : [cutoff];
        try {
            if (dryRun) {
                const row = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} < ?${wsClause}`).get(...params);
                results.push({
                    table: label,
                    deleted: row.c,
                    cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
                    retention_days: days,
                });
                totalDeleted += row.c;
            }
            else {
                const res = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?${wsClause}`).run(...params);
                results.push({
                    table: label,
                    deleted: res.changes,
                    cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
                    retention_days: days,
                });
                totalDeleted += res.changes;
            }
        }
        catch (_b) {
            results.push({ table: label, deleted: 0, cutoff_date: '', retention_days: days });
        }
    }
    // Clean token usage file
    const ret = config_1.config.retention;
    if (ret.tokenUsage > 0) {
        try {
            const { readFile, writeFile } = require('fs/promises');
            const raw = await readFile(config_1.config.tokensPath, 'utf-8');
            const data = JSON.parse(raw);
            const cutoffMs = Date.now() - ret.tokenUsage * 86400000;
            const kept = data.filter((r) => r.timestamp >= cutoffMs);
            const removed = data.length - kept.length;
            if (!dryRun && removed > 0) {
                await writeFile(config_1.config.tokensPath, JSON.stringify(kept, null, 2));
            }
            results.push({
                table: 'Token Usage (file)',
                deleted: removed,
                cutoff_date: new Date(cutoffMs).toISOString().split('T')[0],
                retention_days: ret.tokenUsage,
            });
            totalDeleted += removed;
        }
        catch (_c) {
            // No token file or parse error
        }
    }
    if (ret.gatewaySessions > 0) {
        const sessionPrune = dryRun
            ? { deleted: (0, sessions_1.countStaleGatewaySessions)(ret.gatewaySessions), filesTouched: 0 }
            : (0, sessions_1.pruneGatewaySessionsOlderThan)(ret.gatewaySessions);
        results.push({
            table: 'Gateway Session Store',
            deleted: sessionPrune.deleted,
            cutoff_date: new Date(Date.now() - ret.gatewaySessions * 86400000).toISOString().split('T')[0],
            retention_days: ret.gatewaySessions,
        });
        totalDeleted += sessionPrune.deleted;
    }
    if (!dryRun && totalDeleted > 0) {
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'data_cleanup',
            actor: auth.user.username,
            actor_id: auth.user.id,
            detail: { total_deleted: totalDeleted, results },
            ip_address: ipAddress,
        });
    }
    return server_1.NextResponse.json({
        dry_run: dryRun,
        total_deleted: totalDeleted,
        results,
    });
}
function getRetentionTargets() {
    const ret = config_1.config.retention;
    return [
        { table: 'activities', column: 'created_at', days: ret.activities, label: 'Activities', scoped: true },
        { table: 'audit_log', column: 'created_at', days: ret.auditLog, label: 'Audit Log', scoped: false }, // instance-global, admin-only
        { table: 'notifications', column: 'created_at', days: ret.notifications, label: 'Notifications', scoped: true },
        { table: 'pipeline_runs', column: 'created_at', days: ret.pipelineRuns, label: 'Pipeline Runs', scoped: true },
    ];
}
