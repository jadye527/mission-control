"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const auth_1 = require("@/lib/auth");
const command_1 = require("@/lib/command");
function isAllowedDirectory(input) {
    const cwd = (0, node_path_1.resolve)(input);
    if (!cwd.startsWith('/'))
        return false;
    if (!(cwd.startsWith('/Users/') || cwd.startsWith('/tmp/') || cwd.startsWith('/var/folders/'))) {
        return false;
    }
    if (!(0, node_fs_1.existsSync)(cwd))
        return false;
    try {
        return (0, node_fs_1.statSync)(cwd).isDirectory();
    }
    catch (_a) {
        return false;
    }
}
/**
 * POST /api/local/terminal
 * Body: { cwd: string }
 * Opens a new local Terminal window at the given working directory.
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const cwd = typeof (body === null || body === void 0 ? void 0 : body.cwd) === 'string' ? body.cwd.trim() : '';
    if (!cwd) {
        return server_1.NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    }
    if (!isAllowedDirectory(cwd)) {
        return server_1.NextResponse.json({ error: 'cwd must be an existing safe local directory' }, { status: 400 });
    }
    try {
        await (0, command_1.runCommand)('open', ['-a', 'Terminal', cwd], { timeoutMs: 10000 });
        return server_1.NextResponse.json({ ok: true, message: `Opened Terminal at ${cwd}` });
    }
    catch (error) {
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to open Terminal' }, { status: 500 });
    }
}
exports.dynamic = 'force-dynamic';
