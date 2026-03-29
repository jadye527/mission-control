"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const command_1 = require("@/lib/command");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
async function POST(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json().catch(() => ({}));
        const customMessage = typeof (body === null || body === void 0 ? void 0 : body.message) === 'string' ? body.message.trim() : '';
        const db = (0, db_1.getDatabase)();
        const agent = isNaN(Number(agentId))
            ? db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId)
            : db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        if (!agent.session_key) {
            return server_1.NextResponse.json({ error: 'Agent has no session key configured' }, { status: 400 });
        }
        const message = customMessage ||
            `Wake up check-in for ${agent.name}. Please review assigned tasks and notifications.`;
        const { stdout, stderr } = await (0, command_1.runOpenClaw)(['gateway', 'sessions_send', '--session', agent.session_key, '--message', message], { timeoutMs: 10000 });
        if (stderr && stderr.includes('error')) {
            return server_1.NextResponse.json({ error: stderr.trim() || 'Failed to wake agent' }, { status: 500 });
        }
        db_1.db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId);
        return server_1.NextResponse.json({
            success: true,
            session_key: agent.session_key,
            stdout: stdout.trim()
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/agents/[id]/wake error');
        return server_1.NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 });
    }
}
