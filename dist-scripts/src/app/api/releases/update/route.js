"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const version_1 = require("@/lib/version");
const UPDATE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const EXEC_OPTS = {
    timeout: UPDATE_TIMEOUT,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf-8',
};
function git(args, cwd) {
    return (0, child_process_1.execFileSync)('git', args, Object.assign(Object.assign({}, EXEC_OPTS), { cwd })).trim();
}
function pnpm(args, cwd) {
    return (0, child_process_1.execFileSync)('pnpm', args, Object.assign(Object.assign({}, EXEC_OPTS), { cwd })).trim();
}
async function POST(request) {
    var _a, _b, _c, _d, _e, _f, _g;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if (auth.error) {
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const user = auth.user;
    const cwd = process.cwd();
    const steps = [];
    try {
        // Parse target version from request body
        const body = await request.json().catch(() => ({}));
        const targetVersion = body.targetVersion;
        if (!targetVersion) {
            return server_1.NextResponse.json({ error: 'Missing targetVersion in request body' }, { status: 400 });
        }
        // Normalize to tag format (e.g. "1.2.0" -> "v1.2.0")
        const tag = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;
        // 1. Check for uncommitted changes
        const status = git(['status', '--porcelain'], cwd);
        if (status) {
            return server_1.NextResponse.json({
                error: 'Working tree has uncommitted changes. Please commit or stash them before updating.',
                dirty: true,
                files: status.split('\n').slice(0, 20),
            }, { status: 409 });
        }
        // 2. Fetch tags and release code from origin
        const fetchOut = git(['fetch', 'origin', '--tags', '--force'], cwd);
        steps.push({ step: 'git fetch', output: fetchOut || 'OK' });
        // 3. Verify the tag exists
        try {
            git(['rev-parse', '--verify', `refs/tags/${tag}`], cwd);
        }
        catch (_h) {
            return server_1.NextResponse.json({ error: `Release tag ${tag} not found in remote` }, { status: 404 });
        }
        // 4. Checkout the release tag
        const checkoutOut = git(['checkout', tag], cwd);
        steps.push({ step: `git checkout ${tag}`, output: checkoutOut });
        // 5. Install dependencies
        const installOut = pnpm(['install', '--frozen-lockfile'], cwd);
        steps.push({ step: 'pnpm install', output: installOut });
        // 6. Build
        const buildOut = pnpm(['build'], cwd);
        steps.push({ step: 'pnpm build', output: buildOut });
        // 7. Read new version from package.json
        const newPkg = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(cwd, 'package.json'), 'utf-8'));
        const newVersion = (_a = newPkg.version) !== null && _a !== void 0 ? _a : targetVersion;
        // 8. Log to audit_log
        try {
            const db = (0, db_1.getDatabase)();
            db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('system.update', user.username, JSON.stringify({
                previousVersion: version_1.APP_VERSION,
                newVersion,
                tag,
            }));
        }
        catch (_j) {
            // Non-critical -- don't fail the update if audit logging fails
        }
        return server_1.NextResponse.json({
            success: true,
            previousVersion: version_1.APP_VERSION,
            newVersion,
            tag,
            steps,
            restartRequired: true,
        });
    }
    catch (err) {
        const message = ((_d = (_c = (_b = err === null || err === void 0 ? void 0 : err.stderr) === null || _b === void 0 ? void 0 : _b.toString) === null || _c === void 0 ? void 0 : _c.call(_b)) === null || _d === void 0 ? void 0 : _d.trim()) ||
            ((_g = (_f = (_e = err === null || err === void 0 ? void 0 : err.stdout) === null || _e === void 0 ? void 0 : _e.toString) === null || _f === void 0 ? void 0 : _f.call(_e)) === null || _g === void 0 ? void 0 : _g.trim()) ||
            (err === null || err === void 0 ? void 0 : err.message) ||
            'Unknown error during update';
        return server_1.NextResponse.json({
            error: 'Update failed',
            detail: message,
            steps,
        }, { status: 500 });
    }
}
