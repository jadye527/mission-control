"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const paths_1 = require("@/lib/paths");
const agent_workspace_1 = require("@/lib/agent-workspace");
const logger_1 = require("@/lib/logger");
const ALLOWED_FILES = new Set([
    'agent.md',
    'identity.md',
    'soul.md',
    'WORKING.md',
    'MEMORY.md',
    'TOOLS.md',
    'AGENTS.md',
    'MISSION.md',
    'USER.md',
]);
const FILE_ALIASES = {
    'agent.md': ['agent.md', 'AGENT.md', 'MISSION.md', 'USER.md'],
    'identity.md': ['identity.md', 'IDENTITY.md'],
    'soul.md': ['soul.md', 'SOUL.md'],
    'WORKING.md': ['WORKING.md', 'working.md'],
    'MEMORY.md': ['MEMORY.md', 'memory.md'],
    'TOOLS.md': ['TOOLS.md', 'tools.md'],
    'AGENTS.md': ['AGENTS.md', 'agents.md'],
    'MISSION.md': ['MISSION.md', 'mission.md'],
    'USER.md': ['USER.md', 'user.md'],
};
function resolveAgentWorkspacePath(workspace) {
    if ((0, node_path_1.isAbsolute)(workspace))
        return (0, node_path_1.resolve)(workspace);
    if (!config_1.config.openclawStateDir)
        throw new Error('OPENCLAW_STATE_DIR not configured');
    return (0, paths_1.resolveWithin)(config_1.config.openclawStateDir, workspace);
}
function getAgentByIdOrName(db, id, workspaceId) {
    if (isNaN(Number(id))) {
        return db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId);
    }
    return db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId);
}
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { id } = await params;
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const agent = getAgentByIdOrName(db, id, workspaceId);
        if (!agent)
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        const agentConfig = agent.config ? JSON.parse(agent.config) : {};
        const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
        if (candidates.length === 0) {
            return server_1.NextResponse.json({ error: 'Agent workspace is not configured' }, { status: 400 });
        }
        const safeWorkspace = candidates[0];
        const requested = (new URL(request.url).searchParams.get('file') || '').trim();
        const files = requested
            ? [requested]
            : ['agent.md', 'identity.md', 'soul.md', 'WORKING.md', 'MEMORY.md', 'TOOLS.md', 'AGENTS.md', 'MISSION.md', 'USER.md'];
        const payload = {};
        for (const file of files) {
            if (!ALLOWED_FILES.has(file)) {
                return server_1.NextResponse.json({ error: `Unsupported file: ${file}` }, { status: 400 });
            }
            const aliases = FILE_ALIASES[file] || [file];
            const match = (0, agent_workspace_1.readAgentWorkspaceFile)(candidates, aliases);
            payload[file] = { exists: match.exists, content: match.content };
        }
        return server_1.NextResponse.json({
            agent: { id: agent.id, name: agent.name },
            workspace: safeWorkspace,
            files: payload,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/files error');
        return server_1.NextResponse.json({ error: 'Failed to load workspace files' }, { status: 500 });
    }
}
async function PUT(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { id } = await params;
        const body = await request.json();
        const file = String((body === null || body === void 0 ? void 0 : body.file) || '').trim();
        const content = String((body === null || body === void 0 ? void 0 : body.content) || '');
        const MAX_WORKSPACE_FILE_SIZE = 1024 * 1024; // 1 MB
        if (content.length > MAX_WORKSPACE_FILE_SIZE) {
            return server_1.NextResponse.json({ error: `File content too large (max ${MAX_WORKSPACE_FILE_SIZE} bytes)` }, { status: 413 });
        }
        if (!ALLOWED_FILES.has(file)) {
            return server_1.NextResponse.json({ error: `Unsupported file: ${file}` }, { status: 400 });
        }
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const agent = getAgentByIdOrName(db, id, workspaceId);
        if (!agent)
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        const agentConfig = agent.config ? JSON.parse(agent.config) : {};
        const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
        const safeWorkspace = candidates[0];
        if (!safeWorkspace) {
            return server_1.NextResponse.json({ error: 'Agent workspace is not configured' }, { status: 400 });
        }
        const safePath = (0, paths_1.resolveWithin)(safeWorkspace, file);
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(safePath), { recursive: true });
        (0, node_fs_1.writeFileSync)(safePath, content, 'utf-8');
        if (file === 'soul.md') {
            db.prepare('UPDATE agents SET soul_content = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
                .run(content, agent.id, workspaceId);
        }
        if (file === 'WORKING.md') {
            db.prepare('UPDATE agents SET working_memory = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
                .run(content, agent.id, workspaceId);
        }
        db_1.db_helpers.logActivity('agent_workspace_file_updated', 'agent', agent.id, auth.user.username, `${file} updated for ${agent.name}`, { file, size: content.length }, workspaceId);
        return server_1.NextResponse.json({ success: true, file, size: content.length });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/agents/[id]/files error');
        return server_1.NextResponse.json({ error: 'Failed to save workspace file' }, { status: 500 });
    }
}
