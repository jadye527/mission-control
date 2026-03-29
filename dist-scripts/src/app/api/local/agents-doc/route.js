"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const auth_1 = require("@/lib/auth");
async function findFirstReadable(paths) {
    for (const p of paths) {
        try {
            await (0, promises_1.access)(p, node_fs_1.constants.R_OK);
            return p;
        }
        catch (_a) {
            // Try next candidate
        }
    }
    return null;
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const cwd = process.cwd();
    const home = (0, node_os_1.homedir)();
    const candidates = [
        (0, node_path_1.join)(cwd, 'AGENTS.md'),
        (0, node_path_1.join)(cwd, 'agents.md'),
        (0, node_path_1.join)(home, '.codex', 'AGENTS.md'),
        (0, node_path_1.join)(home, '.agents', 'AGENTS.md'),
        (0, node_path_1.join)(home, '.config', 'codex', 'AGENTS.md'),
    ];
    const found = await findFirstReadable(candidates);
    if (!found) {
        return server_1.NextResponse.json({
            found: false,
            path: null,
            content: null,
            candidates,
        });
    }
    const content = await (0, promises_1.readFile)(found, 'utf8');
    return server_1.NextResponse.json({
        found: true,
        path: found,
        content,
        candidates,
    });
}
exports.dynamic = 'force-dynamic';
