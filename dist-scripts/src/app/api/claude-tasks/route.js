"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const claude_tasks_1 = require("@/lib/claude-tasks");
/**
 * GET /api/claude-tasks — Returns Claude Code teams and tasks
 * Read-only bridge: MC reads from ~/.claude/tasks/ and ~/.claude/teams/
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const force = request.nextUrl.searchParams.get('force') === 'true';
    const result = (0, claude_tasks_1.getClaudeCodeTasks)(force);
    return server_1.NextResponse.json(result);
}
