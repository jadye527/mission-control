"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const event_bus_1 = require("@/lib/event-bus");
const agent_templates_1 = require("@/lib/agent-templates");
const agent_sync_1 = require("@/lib/agent-sync");
const db_2 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const validation_1 = require("@/lib/validation");
const command_1 = require("@/lib/command");
const config_1 = require("@/lib/config");
const paths_1 = require("@/lib/paths");
const node_path_1 = __importDefault(require("node:path"));
/**
 * GET /api/agents - List all agents with optional filtering
 * Query params: status, role, limit, offset
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Parse query parameters
        const status = searchParams.get('status');
        const role = searchParams.get('role');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
        const offset = parseInt(searchParams.get('offset') || '0');
        // Build dynamic query
        let query = 'SELECT * FROM agents WHERE workspace_id = ?';
        const params = [workspaceId];
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        if (role) {
            query += ' AND role = ?';
            params.push(role);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const stmt = db.prepare(query);
        const agents = stmt.all(...params);
        // Parse JSON config field
        const agentsWithParsedData = agents.map(agent => (Object.assign(Object.assign({}, agent), { config: (0, agent_sync_1.enrichAgentConfigFromWorkspace)(agent.config ? JSON.parse(agent.config) : {}) })));
        // Get task counts for all listed agents in one query (avoids N+1 queries)
        const agentNames = agentsWithParsedData.map(agent => agent.name).filter(Boolean);
        const taskStatsByAgent = new Map();
        if (agentNames.length > 0) {
            const placeholders = agentNames.map(() => '?').join(', ');
            const groupedTaskStats = db.prepare(`
        SELECT
          assigned_to,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'quality_review' THEN 1 ELSE 0 END) as quality_review,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
        FROM tasks
        WHERE workspace_id = ? AND assigned_to IN (${placeholders})
        GROUP BY assigned_to
      `).all(workspaceId, ...agentNames);
            for (const row of groupedTaskStats) {
                taskStatsByAgent.set(row.assigned_to, {
                    total: row.total || 0,
                    assigned: row.assigned || 0,
                    in_progress: row.in_progress || 0,
                    quality_review: row.quality_review || 0,
                    done: row.done || 0,
                });
            }
        }
        const agentsWithStats = agentsWithParsedData.map(agent => {
            const taskStats = taskStatsByAgent.get(agent.name) || {
                total: 0,
                assigned: 0,
                in_progress: 0,
                quality_review: 0,
                done: 0,
            };
            return Object.assign(Object.assign({}, agent), { taskStats: Object.assign(Object.assign({}, taskStats), { completed: taskStats.done }) });
        });
        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM agents WHERE workspace_id = ?';
        const countParams = [workspaceId];
        if (status) {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        if (role) {
            countQuery += ' AND role = ?';
            countParams.push(role);
        }
        const countRow = db.prepare(countQuery).get(...countParams);
        return server_1.NextResponse.json({
            agents: agentsWithStats,
            total: countRow.total,
            page: Math.floor(offset / limit) + 1,
            limit
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents error');
        return server_1.NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
    }
}
/**
 * POST /api/agents - Create a new agent
 */
async function POST(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const validated = await (0, validation_1.validateBody)(request, validation_1.createAgentSchema);
        if ('error' in validated)
            return validated.error;
        const body = validated.data;
        const { name, openclaw_id, role, session_key, soul_content, status = 'offline', config = {}, template, gateway_config, write_to_gateway, provision_openclaw_workspace, openclaw_workspace_path } = body;
        const openclawId = (openclaw_id || name || 'agent')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        // Resolve template if specified
        let finalRole = role;
        let finalConfig = Object.assign({}, config);
        if (template) {
            const tpl = (0, agent_templates_1.getTemplate)(template);
            if (tpl) {
                const builtConfig = (0, agent_templates_1.buildAgentConfig)(tpl, (gateway_config || {}));
                finalConfig = Object.assign(Object.assign({}, builtConfig), finalConfig);
                if (!finalRole)
                    finalRole = ((_b = tpl.config.identity) === null || _b === void 0 ? void 0 : _b.theme) || tpl.type;
            }
        }
        else if (gateway_config) {
            finalConfig = Object.assign(Object.assign({}, finalConfig), gateway_config);
        }
        if (!name || !finalRole) {
            return server_1.NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
        }
        // Check if agent name already exists
        const existingAgent = db
            .prepare('SELECT id FROM agents WHERE name = ? AND workspace_id = ?')
            .get(name, workspaceId);
        if (existingAgent) {
            return server_1.NextResponse.json({ error: 'Agent name already exists' }, { status: 409 });
        }
        if (provision_openclaw_workspace) {
            if (!config_1.config.openclawStateDir) {
                return server_1.NextResponse.json({ error: 'OPENCLAW_STATE_DIR is not configured; cannot provision OpenClaw workspace' }, { status: 500 });
            }
            const workspacePath = openclaw_workspace_path
                ? node_path_1.default.resolve(openclaw_workspace_path)
                : (0, paths_1.resolveWithin)(config_1.config.openclawStateDir, node_path_1.default.join('workspaces', openclawId));
            try {
                await (0, command_1.runOpenClaw)(['agents', 'add', openclawId, '--workspace', workspacePath, '--non-interactive'], { timeoutMs: 20000 });
            }
            catch (provisionError) {
                logger_1.logger.error({ err: provisionError, openclawId, workspacePath }, 'OpenClaw workspace provisioning failed');
                return server_1.NextResponse.json({ error: (provisionError === null || provisionError === void 0 ? void 0 : provisionError.message) || 'Failed to provision OpenClaw agent workspace' }, { status: 502 });
            }
        }
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      INSERT INTO agents (
        name, role, session_key, soul_content, status, 
        created_at, updated_at, config, workspace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const dbResult = stmt.run(name, finalRole, session_key, soul_content, status, now, now, JSON.stringify(finalConfig), workspaceId);
        const agentId = dbResult.lastInsertRowid;
        // Log activity
        db_1.db_helpers.logActivity('agent_created', 'agent', agentId, auth.user.username, `Created agent: ${name} (${finalRole})${template ? ` from template: ${template}` : ''}`, {
            name,
            role: finalRole,
            status,
            session_key,
            template: template || null
        }, workspaceId);
        // Fetch the created agent
        const createdAgent = db
            .prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?')
            .get(agentId, workspaceId);
        const parsedAgent = Object.assign(Object.assign({}, createdAgent), { config: JSON.parse(createdAgent.config || '{}'), taskStats: { total: 0, assigned: 0, in_progress: 0, quality_review: 0, done: 0, completed: 0 } });
        // Broadcast to SSE clients
        event_bus_1.eventBus.broadcast('agent.created', parsedAgent);
        // Write to gateway config if requested
        if (write_to_gateway && finalConfig) {
            try {
                await (0, agent_sync_1.writeAgentToConfig)(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: openclawId, name }, (finalConfig.model && { model: finalConfig.model })), (finalConfig.identity && { identity: finalConfig.identity })), (finalConfig.sandbox && { sandbox: finalConfig.sandbox })), (finalConfig.tools && { tools: finalConfig.tools })), (finalConfig.subagents && { subagents: finalConfig.subagents })), (finalConfig.memorySearch && { memorySearch: finalConfig.memorySearch })));
                const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
                (0, db_2.logAuditEvent)({
                    action: 'agent_gateway_create',
                    actor: auth.user.username,
                    actor_id: auth.user.id,
                    target_type: 'agent',
                    target_id: agentId,
                    detail: { name, openclaw_id: openclawId, template: template || null },
                    ip_address: ipAddress,
                });
            }
            catch (gwErr) {
                logger_1.logger.error({ err: gwErr }, 'Gateway write-back failed');
                return server_1.NextResponse.json({
                    agent: parsedAgent,
                    warning: `Agent created in MC but gateway write failed: ${gwErr.message}`
                }, { status: 201 });
            }
        }
        return server_1.NextResponse.json({ agent: parsedAgent }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/agents error');
        return server_1.NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
    }
}
/**
 * PUT /api/agents - Update agent status (bulk operation for status updates)
 */
async function PUT(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        // Handle single agent update or bulk updates
        if (body.name) {
            // Single agent update
            const { name, status, last_activity, config, session_key, soul_content, role } = body;
            const agent = db
                .prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?')
                .get(name, workspaceId);
            if (!agent) {
                return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
            }
            const now = Math.floor(Date.now() / 1000);
            // Build dynamic update query
            const fieldsToUpdate = [];
            const params = [];
            if (status !== undefined) {
                fieldsToUpdate.push('status = ?');
                params.push(status);
                fieldsToUpdate.push('last_seen = ?');
                params.push(now);
            }
            if (last_activity !== undefined) {
                fieldsToUpdate.push('last_activity = ?');
                params.push(last_activity);
            }
            if (config !== undefined) {
                fieldsToUpdate.push('config = ?');
                params.push(JSON.stringify(config));
            }
            if (session_key !== undefined) {
                fieldsToUpdate.push('session_key = ?');
                params.push(session_key);
            }
            if (soul_content !== undefined) {
                fieldsToUpdate.push('soul_content = ?');
                params.push(soul_content);
            }
            if (role !== undefined) {
                fieldsToUpdate.push('role = ?');
                params.push(role);
            }
            fieldsToUpdate.push('updated_at = ?');
            params.push(now);
            params.push(name, workspaceId);
            if (fieldsToUpdate.length === 1) { // Only updated_at
                return server_1.NextResponse.json({ error: 'No fields to update' }, { status: 400 });
            }
            const stmt = db.prepare(`
        UPDATE agents 
        SET ${fieldsToUpdate.join(', ')}
        WHERE name = ? AND workspace_id = ?
      `);
            stmt.run(...params);
            // Log status change if status was updated
            if (status !== undefined && status !== agent.status) {
                db_1.db_helpers.logActivity('agent_status_change', 'agent', agent.id, name, `Agent status changed from ${agent.status} to ${status}`, {
                    oldStatus: agent.status,
                    newStatus: status,
                    last_activity
                }, workspaceId);
            }
            // Broadcast update to SSE clients
            event_bus_1.eventBus.broadcast('agent.updated', Object.assign(Object.assign(Object.assign(Object.assign({ id: agent.id, name }, (status !== undefined && { status })), (last_activity !== undefined && { last_activity })), (role !== undefined && { role })), { updated_at: now }));
            return server_1.NextResponse.json({ success: true });
        }
        else {
            return server_1.NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/agents error');
        return server_1.NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
    }
}
