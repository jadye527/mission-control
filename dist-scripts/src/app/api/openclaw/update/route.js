"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const command_1 = require("@/lib/command");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
async function POST(request) {
    var _a, _b, _c, _d, _e, _f;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth) {
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    let installedBefore = null;
    try {
        const vResult = await (0, command_1.runOpenClaw)(['--version'], { timeoutMs: 3000 });
        const match = vResult.stdout.match(/(\d+\.\d+\.\d+)/);
        if (match)
            installedBefore = match[1];
    }
    catch (_g) {
        return server_1.NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 });
    }
    try {
        const result = await (0, command_1.runOpenClaw)(['update', '--channel', 'stable'], {
            timeoutMs: 5 * 60 * 1000,
        });
        // Read new version after update
        let installedAfter = null;
        try {
            const vResult = await (0, command_1.runOpenClaw)(['--version'], { timeoutMs: 3000 });
            const match = vResult.stdout.match(/(\d+\.\d+\.\d+)/);
            if (match)
                installedAfter = match[1];
        }
        catch ( /* keep null */_h) { /* keep null */ }
        // Audit log
        try {
            const db = (0, db_1.getDatabase)();
            db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('openclaw.update', auth.user.username, JSON.stringify({ previousVersion: installedBefore, newVersion: installedAfter }));
        }
        catch ( /* non-critical */_j) { /* non-critical */ }
        return server_1.NextResponse.json({
            success: true,
            previousVersion: installedBefore,
            newVersion: installedAfter,
            output: result.stdout,
        });
    }
    catch (err) {
        const detail = ((_c = (_b = (_a = err === null || err === void 0 ? void 0 : err.stderr) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.trim()) ||
            ((_f = (_e = (_d = err === null || err === void 0 ? void 0 : err.stdout) === null || _d === void 0 ? void 0 : _d.toString) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.trim()) ||
            (err === null || err === void 0 ? void 0 : err.message) ||
            'Unknown error during OpenClaw update';
        logger_1.logger.error({ err }, 'OpenClaw update failed');
        return server_1.NextResponse.json({ error: 'OpenClaw update failed', detail }, { status: 500 });
    }
}
