"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const agent_sync_1 = require("@/lib/agent-sync");
const event_bus_1 = require("@/lib/event-bus");
const logger_1 = require("@/lib/logger");
const command_1 = require("@/lib/command");
/**
 * GET /api/agents/[id] - Get a single agent by ID or name
 */
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        let agent;
        if (isNaN(Number(id))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        const parsed = Object.assign(Object.assign({}, agent), { config: (0, agent_sync_1.enrichAgentConfigFromWorkspace)(agent.config ? JSON.parse(agent.config) : {}) });
        return server_1.NextResponse.json({ agent: parsed });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
    }
}
/**
 * PUT /api/agents/[id] - Update agent config with unified MC + gateway save
 *
 * Body: {
 *   role?: string
 *   gateway_config?: object   - OpenClaw agent config fields to update
 *   write_to_gateway?: boolean - Defaults to true when gateway_config exists
 * }
 */
async function PUT(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const { role, gateway_config, write_to_gateway } = body;
        let agent;
        if (isNaN(Number(id))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        const now = Math.floor(Date.now() / 1000);
        const existingConfig = agent.config ? JSON.parse(agent.config) : {};
        // Merge gateway_config into existing config
        let newConfig = existingConfig;
        if (gateway_config && typeof gateway_config === 'object') {
            newConfig = Object.assign(Object.assign({}, existingConfig), gateway_config);
        }
        const shouldWriteToGateway = Boolean(gateway_config &&
            (write_to_gateway === undefined || write_to_gateway === null || write_to_gateway === true));
        const openclawId = existingConfig.openclawId || agent.name.toLowerCase().replace(/\s+/g, '-');
        const getWriteBackPayload = (source) => {
            const writeBack = { id: openclawId };
            if (source.model)
                writeBack.model = source.model;
            if (source.identity)
                writeBack.identity = source.identity;
            if (source.sandbox)
                writeBack.sandbox = source.sandbox;
            if (source.tools)
                writeBack.tools = source.tools;
            if (source.subagents)
                writeBack.subagents = source.subagents;
            if (source.memorySearch)
                writeBack.memorySearch = source.memorySearch;
            return writeBack;
        };
        // Unified save: DB first (transactional, easy to revert), then gateway file.
        // If gateway write fails after DB succeeds, revert DB to keep consistency.
        try {
            const fields = ['updated_at = ?'];
            const values = [now];
            if (role !== undefined) {
                fields.push('role = ?');
                values.push(role);
            }
            if (gateway_config) {
                fields.push('config = ?');
                values.push(JSON.stringify(newConfig));
            }
            values.push(agent.id, workspaceId);
            db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values);
        }
        catch (err) {
            return server_1.NextResponse.json({ error: `Save failed: ${err.message}` }, { status: 500 });
        }
        if (shouldWriteToGateway) {
            try {
                await (0, agent_sync_1.writeAgentToConfig)(getWriteBackPayload(gateway_config));
            }
            catch (err) {
                // Gateway write failed — revert DB to previous state
                try {
                    const revertFields = ['updated_at = ?'];
                    const revertValues = [agent.updated_at];
                    revertFields.push('role = ?');
                    revertValues.push(agent.role);
                    revertFields.push('config = ?');
                    revertValues.push(agent.config || '{}');
                    revertValues.push(agent.id, workspaceId);
                    db.prepare(`UPDATE agents SET ${revertFields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...revertValues);
                }
                catch (revertErr) {
                    logger_1.logger.error({ err: revertErr, agent: agent.name }, 'Failed to revert DB after gateway write failure');
                }
                return server_1.NextResponse.json({ error: `Save failed: unable to update gateway config: ${err.message}` }, { status: 502 });
            }
        }
        if (shouldWriteToGateway) {
            const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
            (0, db_1.logAuditEvent)({
                action: 'agent_config_writeback',
                actor: auth.user.username,
                actor_id: auth.user.id,
                target_type: 'agent',
                target_id: agent.id,
                detail: { agent_name: agent.name, openclaw_id: openclawId, fields: Object.keys(gateway_config || {}) },
                ip_address: ipAddress,
            });
        }
        // Log activity
        db_1.db_helpers.logActivity('agent_config_updated', 'agent', agent.id, auth.user.username, `Config updated for agent ${agent.name}${shouldWriteToGateway ? ' (+ gateway)' : ''}`, { fields: Object.keys(gateway_config || {}), write_to_gateway: shouldWriteToGateway }, workspaceId);
        // Broadcast update
        event_bus_1.eventBus.broadcast('agent.updated', {
            id: agent.id,
            name: agent.name,
            config: newConfig,
            updated_at: now,
        });
        const enrichedConfig = (0, agent_sync_1.enrichAgentConfigFromWorkspace)(newConfig);
        return server_1.NextResponse.json({
            success: true,
            agent: Object.assign(Object.assign({}, agent), { config: enrichedConfig, role: role || agent.role, updated_at: now }),
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/agents/[id] error');
        return server_1.NextResponse.json({ error: error.message || 'Failed to update agent' }, { status: 500 });
    }
}
/**
 * DELETE /api/agents/[id] - Delete an agent
 */
async function DELETE(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        let removeWorkspace = false;
        try {
            const body = await request.json();
            removeWorkspace = Boolean(body === null || body === void 0 ? void 0 : body.remove_workspace);
        }
        catch (_b) {
            // Optional body
        }
        let agent;
        if (isNaN(Number(id))) {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        if (removeWorkspace) {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const openclawId = String((agentConfig === null || agentConfig === void 0 ? void 0 : agentConfig.openclawId) || agent.name || '')
                .toLowerCase()
                .replace(/[^a-z0-9._-]+/g, '-')
                .replace(/^-+|-+$/g, '') || agent.name;
            try {
                await (0, command_1.runOpenClaw)(['agents', 'delete', openclawId, '--force'], { timeoutMs: 30000 });
            }
            catch (err) {
                logger_1.logger.error({ err, openclawId, agent: agent.name }, 'Failed to remove OpenClaw agent/workspace');
                return server_1.NextResponse.json({ error: `Failed to remove OpenClaw workspace for ${agent.name}: ${(err === null || err === void 0 ? void 0 : err.message) || 'unknown error'}` }, { status: 502 });
            }
        }
        let configCleanupWarning = null;
        try {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const openclawId = String((agentConfig === null || agentConfig === void 0 ? void 0 : agentConfig.openclawId) || agent.name || '')
                .toLowerCase()
                .replace(/[^a-z0-9._-]+/g, '-')
                .replace(/^-+|-+$/g, '') || agent.name;
            await (0, agent_sync_1.removeAgentFromConfig)({ id: openclawId, name: agent.name });
        }
        catch (err) {
            configCleanupWarning = `OpenClaw config cleanup skipped for ${agent.name}: ${(err === null || err === void 0 ? void 0 : err.message) || 'unknown error'}`;
            logger_1.logger.warn({ err, agent: agent.name }, 'Failed to remove OpenClaw agent config entry');
        }
        db.prepare('DELETE FROM agents WHERE id = ? AND workspace_id = ?').run(agent.id, workspaceId);
        db_1.db_helpers.logActivity('agent_deleted', 'agent', agent.id, auth.user.username, `Deleted agent: ${agent.name}`, { name: agent.name, role: agent.role, remove_workspace: removeWorkspace }, workspaceId);
        event_bus_1.eventBus.broadcast('agent.deleted', { id: agent.id, name: agent.name });
        return server_1.NextResponse.json(Object.assign({ success: true, deleted: agent.name, remove_workspace: removeWorkspace }, (configCleanupWarning ? { warning: configCleanupWarning } : {})));
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/agents/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
    }
}
