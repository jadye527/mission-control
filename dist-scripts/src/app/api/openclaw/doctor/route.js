"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const command_1 = require("@/lib/command");
const config_1 = require("@/lib/config");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const openclaw_doctor_fix_1 = require("@/lib/openclaw-doctor-fix");
const openclaw_doctor_1 = require("@/lib/openclaw-doctor");
function getCommandDetail(error) {
    const err = error;
    return {
        detail: [err === null || err === void 0 ? void 0 : err.stdout, err === null || err === void 0 ? void 0 : err.stderr, err === null || err === void 0 ? void 0 : err.message].filter(Boolean).join('\n').trim(),
        code: typeof (err === null || err === void 0 ? void 0 : err.code) === 'number' ? err.code : null,
    };
}
function isMissingOpenClaw(detail) {
    return /enoent|not installed|not reachable|command not found/i.test(detail);
}
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth) {
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    try {
        const result = await (0, command_1.runOpenClaw)(['doctor'], { timeoutMs: 15000 });
        return server_1.NextResponse.json((0, openclaw_doctor_1.parseOpenClawDoctorOutput)(`${result.stdout}\n${result.stderr}`, (_a = result.code) !== null && _a !== void 0 ? _a : 0, {
            stateDir: config_1.config.openclawStateDir,
        }), {
            headers: { 'Cache-Control': 'no-store' },
        });
    }
    catch (error) {
        const { detail, code } = getCommandDetail(error);
        if (isMissingOpenClaw(detail)) {
            return server_1.NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 });
        }
        return server_1.NextResponse.json((0, openclaw_doctor_1.parseOpenClawDoctorOutput)(detail, code !== null && code !== void 0 ? code : 1, {
            stateDir: config_1.config.openclawStateDir,
        }), {
            headers: { 'Cache-Control': 'no-store' },
        });
    }
}
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth) {
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    try {
        const progress = [];
        const fixResult = await (0, command_1.runOpenClaw)(['doctor', '--fix'], { timeoutMs: 120000 });
        progress.push({ step: 'doctor', detail: 'Applied OpenClaw doctor config fixes.' });
        try {
            await (0, command_1.runOpenClaw)(['sessions', 'cleanup', '--all-agents', '--enforce', '--fix-missing'], { timeoutMs: 120000 });
            progress.push({ step: 'sessions', detail: 'Pruned missing transcript entries from session stores.' });
        }
        catch (error) {
            const { detail } = getCommandDetail(error);
            progress.push({ step: 'sessions', detail: detail || 'Session cleanup skipped.' });
        }
        const orphanFix = (0, openclaw_doctor_fix_1.archiveOrphanTranscriptsForStateDir)(config_1.config.openclawStateDir);
        progress.push({
            step: 'orphans',
            detail: orphanFix.archivedOrphans > 0
                ? `Archived ${orphanFix.archivedOrphans} orphan transcript file(s) across ${orphanFix.storesScanned} session store(s).`
                : `No orphan transcript files found across ${orphanFix.storesScanned} session store(s).`,
        });
        const postFix = await (0, command_1.runOpenClaw)(['doctor'], { timeoutMs: 15000 });
        const status = (0, openclaw_doctor_1.parseOpenClawDoctorOutput)(`${postFix.stdout}\n${postFix.stderr}`, (_a = postFix.code) !== null && _a !== void 0 ? _a : 0, {
            stateDir: config_1.config.openclawStateDir,
        });
        try {
            const db = (0, db_1.getDatabase)();
            db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('openclaw.doctor.fix', auth.user.username, JSON.stringify({ level: status.level, healthy: status.healthy, issues: status.issues }));
        }
        catch (_b) {
            // Non-critical.
        }
        return server_1.NextResponse.json({
            success: true,
            output: `${fixResult.stdout}\n${fixResult.stderr}`.trim(),
            progress,
            status,
        });
    }
    catch (error) {
        const { detail, code } = getCommandDetail(error);
        if (isMissingOpenClaw(detail)) {
            return server_1.NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 });
        }
        logger_1.logger.error({ err: error }, 'OpenClaw doctor fix failed');
        return server_1.NextResponse.json({
            error: 'OpenClaw doctor fix failed',
            detail,
            status: (0, openclaw_doctor_1.parseOpenClawDoctorOutput)(detail, code !== null && code !== void 0 ? code : 1, {
                stateDir: config_1.config.openclawStateDir,
            }),
        }, { status: 500 });
    }
}
