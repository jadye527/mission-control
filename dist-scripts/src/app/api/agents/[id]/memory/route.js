"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const config_1 = require("@/lib/config");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const paths_1 = require("@/lib/paths");
const agent_workspace_1 = require("@/lib/agent-workspace");
function resolveAgentWorkspacePath(workspace) {
    if ((0, node_path_1.isAbsolute)(workspace))
        return (0, node_path_1.resolve)(workspace);
    if (!config_1.config.openclawStateDir)
        throw new Error('OPENCLAW_STATE_DIR not configured');
    return (0, paths_1.resolveWithin)(config_1.config.openclawStateDir, workspace);
}
/**
 * GET /api/agents/[id]/memory - Get agent's working memory
 *
 * Working memory is stored in the agents.working_memory DB column.
 * This endpoint is per-agent scratchpad memory (not the global Memory Browser filesystem view).
 */
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Get agent by ID or name
        let agent;
        if (isNaN(Number(agentId))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        // Check if agent has a working_memory column, if not create it
        const columns = db.prepare("PRAGMA table_info(agents)").all();
        const hasWorkingMemory = columns.some((col) => col.name === 'working_memory');
        if (!hasWorkingMemory) {
            // Add working_memory column to agents table
            db.exec("ALTER TABLE agents ADD COLUMN working_memory TEXT DEFAULT ''");
        }
        // Prefer workspace WORKING.md, fall back to DB working_memory
        let workingMemory = '';
        let source = 'none';
        try {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
            const match = (0, agent_workspace_1.readAgentWorkspaceFile)(candidates, ['WORKING.md', 'working.md', 'MEMORY.md', 'memory.md']);
            if (match.exists) {
                workingMemory = match.content;
                source = 'workspace';
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, agent: agent.name }, 'Failed to read WORKING.md from workspace');
        }
        // Get working memory content
        const memoryStmt = db.prepare(`SELECT working_memory FROM agents WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ? AND workspace_id = ?`);
        const result = memoryStmt.get(agentId, workspaceId);
        if (!workingMemory) {
            workingMemory = (result === null || result === void 0 ? void 0 : result.working_memory) || '';
            source = workingMemory ? 'database' : 'none';
        }
        return server_1.NextResponse.json({
            agent: {
                id: agent.id,
                name: agent.name,
                role: agent.role
            },
            working_memory: workingMemory,
            source,
            updated_at: agent.updated_at,
            size: workingMemory.length
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/memory error');
        return server_1.NextResponse.json({ error: 'Failed to fetch working memory' }, { status: 500 });
    }
}
/**
 * PUT /api/agents/[id]/memory - Update agent's working memory
 */
async function PUT(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { working_memory, append } = body;
        // Get agent by ID or name
        let agent;
        if (isNaN(Number(agentId))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        // Check if agent has a working_memory column, if not create it
        const columns = db.prepare("PRAGMA table_info(agents)").all();
        const hasWorkingMemory = columns.some((col) => col.name === 'working_memory');
        if (!hasWorkingMemory) {
            db.exec("ALTER TABLE agents ADD COLUMN working_memory TEXT DEFAULT ''");
        }
        let newContent = working_memory || '';
        // Handle append mode
        if (append) {
            const currentStmt = db.prepare(`SELECT working_memory FROM agents WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ? AND workspace_id = ?`);
            const current = currentStmt.get(agentId, workspaceId);
            const currentContent = (current === null || current === void 0 ? void 0 : current.working_memory) || '';
            // Add timestamp and append
            const timestamp = new Date().toISOString();
            newContent = currentContent + (currentContent ? '\n\n' : '') +
                `## ${timestamp}\n${working_memory}`;
        }
        const now = Math.floor(Date.now() / 1000);
        // Best effort: sync workspace WORKING.md if agent workspace is configured
        let savedToWorkspace = false;
        try {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
            const safeWorkspace = candidates[0];
            if (safeWorkspace) {
                const safeWorkingPath = (0, paths_1.resolveWithin)(safeWorkspace, 'WORKING.md');
                (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(safeWorkingPath), { recursive: true });
                (0, node_fs_1.writeFileSync)(safeWorkingPath, newContent, 'utf-8');
                savedToWorkspace = true;
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, agent: agent.name }, 'Failed to write WORKING.md to workspace');
        }
        // Update working memory
        const updateStmt = db.prepare(`
      UPDATE agents 
      SET working_memory = ?, updated_at = ?
      WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ? AND workspace_id = ?
    `);
        updateStmt.run(newContent, now, agentId, workspaceId);
        // Log activity
        db_1.db_helpers.logActivity('agent_memory_updated', 'agent', agent.id, agent.name, `Working memory ${append ? 'appended' : 'updated'} for agent ${agent.name}`, {
            content_length: newContent.length,
            append_mode: append || false,
            timestamp: now,
            saved_to_workspace: savedToWorkspace
        }, workspaceId);
        return server_1.NextResponse.json({
            success: true,
            message: `Working memory ${append ? 'appended' : 'updated'} for ${agent.name}`,
            working_memory: newContent,
            saved_to_workspace: savedToWorkspace,
            updated_at: now,
            size: newContent.length
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/agents/[id]/memory error');
        return server_1.NextResponse.json({ error: 'Failed to update working memory' }, { status: 500 });
    }
}
/**
 * DELETE /api/agents/[id]/memory - Clear agent's working memory
 */
async function DELETE(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Get agent by ID or name
        let agent;
        if (isNaN(Number(agentId))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        const now = Math.floor(Date.now() / 1000);
        // Best effort: clear workspace WORKING.md if agent workspace is configured
        try {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
            const safeWorkspace = candidates[0];
            if (safeWorkspace) {
                const safeWorkingPath = (0, paths_1.resolveWithin)(safeWorkspace, 'WORKING.md');
                (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(safeWorkingPath), { recursive: true });
                (0, node_fs_1.writeFileSync)(safeWorkingPath, '', 'utf-8');
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, agent: agent.name }, 'Failed to clear WORKING.md in workspace');
        }
        // Clear working memory
        const updateStmt = db.prepare(`
      UPDATE agents 
      SET working_memory = '', updated_at = ?
      WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ? AND workspace_id = ?
    `);
        updateStmt.run(now, agentId, workspaceId);
        // Log activity
        db_1.db_helpers.logActivity('agent_memory_cleared', 'agent', agent.id, agent.name, `Working memory cleared for agent ${agent.name}`, { timestamp: now }, workspaceId);
        return server_1.NextResponse.json({
            success: true,
            message: `Working memory cleared for ${agent.name}`,
            working_memory: '',
            updated_at: now
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/agents/[id]/memory error');
        return server_1.NextResponse.json({ error: 'Failed to clear working memory' }, { status: 500 });
    }
}
