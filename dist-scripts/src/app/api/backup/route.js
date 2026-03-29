"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const config_1 = require("@/lib/config");
const path_1 = require("path");
const fs_1 = require("fs");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const command_1 = require("@/lib/command");
const BACKUP_DIR = (0, path_1.join)((0, path_1.dirname)(config_1.config.dbPath), 'backups');
const MAX_BACKUPS = 10;
/**
 * GET /api/backup - List existing backups (admin only)
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    (0, config_1.ensureDirExists)(BACKUP_DIR);
    try {
        const files = (0, fs_1.readdirSync)(BACKUP_DIR)
            .filter(f => f.endsWith('.db'))
            .map(f => {
            const stat = (0, fs_1.statSync)((0, path_1.join)(BACKUP_DIR, f));
            return {
                name: f,
                size: stat.size,
                created_at: Math.floor(stat.mtimeMs / 1000),
            };
        })
            .sort((a, b) => b.created_at - a.created_at);
        return server_1.NextResponse.json({ backups: files, dir: BACKUP_DIR });
    }
    catch (_a) {
        return server_1.NextResponse.json({ backups: [], dir: BACKUP_DIR });
    }
}
/**
 * POST /api/backup - Create a new backup (admin only)
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.heavyLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const target = request.nextUrl.searchParams.get('target');
    // Gateway state backup via `openclaw backup create`
    if (target === 'gateway') {
        (0, config_1.ensureDirExists)(BACKUP_DIR);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        try {
            let stdout;
            let stderr;
            try {
                const result = await (0, command_1.runOpenClaw)(['backup', 'create', '--output', BACKUP_DIR], { timeoutMs: 60000 });
                stdout = result.stdout;
                stderr = result.stderr;
            }
            catch (error) {
                // openclaw backup may exit non-zero despite success — check output
                stdout = error.stdout || '';
                stderr = error.stderr || '';
                const combined = `${stdout}\n${stderr}`;
                if (!combined.includes('Created')) {
                    const message = stderr || error.message || 'Unknown error';
                    logger_1.logger.error({ err: error }, 'Gateway backup failed');
                    return server_1.NextResponse.json({ error: `Gateway backup failed: ${message}` }, { status: 500 });
                }
            }
            const output = (stdout || stderr).trim();
            (0, db_1.logAuditEvent)({
                action: 'openclaw.backup',
                actor: auth.user.username,
                actor_id: auth.user.id,
                detail: { output },
                ip_address: ipAddress,
            });
            return server_1.NextResponse.json({ success: true, output });
        }
        catch (error) {
            logger_1.logger.error({ err: error }, 'Gateway backup failed');
            return server_1.NextResponse.json({ error: `Gateway backup failed: ${error.message}` }, { status: 500 });
        }
    }
    // Default: MC SQLite backup
    (0, config_1.ensureDirExists)(BACKUP_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupPath = (0, path_1.join)(BACKUP_DIR, `mc-backup-${timestamp}.db`);
    try {
        const db = (0, db_1.getDatabase)();
        await db.backup(backupPath);
        const stat = (0, fs_1.statSync)(backupPath);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'backup_create',
            actor: auth.user.username,
            actor_id: auth.user.id,
            detail: { path: backupPath, size: stat.size },
            ip_address: ipAddress,
        });
        // Prune old backups beyond MAX_BACKUPS
        pruneOldBackups();
        return server_1.NextResponse.json({
            success: true,
            backup: {
                name: `mc-backup-${timestamp}.db`,
                size: stat.size,
                created_at: Math.floor(stat.mtimeMs / 1000),
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Backup failed');
        return server_1.NextResponse.json({ error: `Backup failed: ${error.message}` }, { status: 500 });
    }
}
/**
 * DELETE /api/backup?name=<filename> - Delete a specific backup (admin only)
 */
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    let body;
    try {
        body = await request.json();
    }
    catch (_a) {
        return server_1.NextResponse.json({ error: 'Request body required' }, { status: 400 });
    }
    const name = body.name;
    if (!name || !name.endsWith('.db') || name.includes('/') || name.includes('..')) {
        return server_1.NextResponse.json({ error: 'Invalid backup name' }, { status: 400 });
    }
    try {
        const fullPath = (0, path_1.join)(BACKUP_DIR, name);
        (0, fs_1.unlinkSync)(fullPath);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({
            action: 'backup_delete',
            actor: auth.user.username,
            actor_id: auth.user.id,
            detail: { name },
            ip_address: ipAddress,
        });
        return server_1.NextResponse.json({ success: true });
    }
    catch (_b) {
        return server_1.NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    }
}
function pruneOldBackups() {
    try {
        const files = (0, fs_1.readdirSync)(BACKUP_DIR)
            .filter(f => f.startsWith('mc-backup-') && f.endsWith('.db'))
            .map(f => ({ name: f, mtime: (0, fs_1.statSync)((0, path_1.join)(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        for (const file of files.slice(MAX_BACKUPS)) {
            (0, fs_1.unlinkSync)((0, path_1.join)(BACKUP_DIR, file.name));
        }
    }
    catch (_a) {
        // Best-effort pruning
    }
}
