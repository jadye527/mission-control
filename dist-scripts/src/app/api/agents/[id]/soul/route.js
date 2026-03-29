"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.PATCH = PATCH;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("@/lib/config");
const paths_1 = require("@/lib/paths");
const agent_workspace_1 = require("@/lib/agent-workspace");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
function resolveAgentWorkspacePath(workspace) {
    if ((0, path_1.isAbsolute)(workspace))
        return (0, path_1.resolve)(workspace);
    if (!config_1.config.openclawStateDir)
        throw new Error('OPENCLAW_STATE_DIR not configured');
    return (0, paths_1.resolveWithin)(config_1.config.openclawStateDir, workspace);
}
/**
 * GET /api/agents/[id]/soul - Get agent's SOUL content
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
        // Try reading soul.md from workspace first, fall back to DB
        let soulContent = '';
        let source = 'none';
        try {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
            const match = (0, agent_workspace_1.readAgentWorkspaceFile)(candidates, ['soul.md', 'SOUL.md']);
            if (match.exists) {
                soulContent = match.content;
                source = 'workspace';
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, agent: agent.name }, 'Failed to read soul.md from workspace');
        }
        // Fall back to database value
        if (!soulContent && agent.soul_content) {
            soulContent = agent.soul_content;
            source = 'database';
        }
        const templatesPath = config_1.config.soulTemplatesDir;
        let availableTemplates = [];
        try {
            if (templatesPath && (0, fs_1.existsSync)(templatesPath)) {
                const files = (0, fs_1.readdirSync)(templatesPath);
                availableTemplates = files
                    .filter(file => file.endsWith('.md'))
                    .map(file => file.replace('.md', ''));
            }
        }
        catch (error) {
            logger_1.logger.warn({ err: error }, 'Could not read soul templates directory');
        }
        return server_1.NextResponse.json({
            agent: {
                id: agent.id,
                name: agent.name,
                role: agent.role
            },
            soul_content: soulContent,
            source,
            available_templates: availableTemplates,
            updated_at: agent.updated_at
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/soul error');
        return server_1.NextResponse.json({ error: 'Failed to fetch SOUL content' }, { status: 500 });
    }
}
/**
 * PUT /api/agents/[id]/soul - Update agent's SOUL content
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
        const { soul_content, template_name } = body;
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
        let newSoulContent = soul_content;
        // If template_name is provided, load from template
        if (template_name) {
            if (!config_1.config.soulTemplatesDir) {
                return server_1.NextResponse.json({ error: 'Templates directory not configured' }, { status: 500 });
            }
            let templatePath;
            try {
                templatePath = (0, paths_1.resolveWithin)(config_1.config.soulTemplatesDir, `${template_name}.md`);
            }
            catch (pathError) {
                return server_1.NextResponse.json({ error: 'Invalid template name' }, { status: 400 });
            }
            try {
                if ((0, fs_1.existsSync)(templatePath)) {
                    const templateContent = (0, fs_1.readFileSync)(templatePath, 'utf8');
                    // Replace placeholders with agent info
                    newSoulContent = templateContent
                        .replace(/{{AGENT_NAME}}/g, agent.name)
                        .replace(/{{AGENT_ROLE}}/g, agent.role)
                        .replace(/{{TIMESTAMP}}/g, new Date().toISOString());
                }
                else {
                    return server_1.NextResponse.json({ error: 'Template not found' }, { status: 404 });
                }
            }
            catch (error) {
                logger_1.logger.error({ err: error }, 'Error loading soul template');
                return server_1.NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
            }
        }
        const now = Math.floor(Date.now() / 1000);
        // Write to workspace file if available
        let savedToWorkspace = false;
        try {
            const agentConfig = agent.config ? JSON.parse(agent.config) : {};
            const candidates = (0, agent_workspace_1.getAgentWorkspaceCandidates)(agentConfig, agent.name);
            const safeWorkspace = candidates[0];
            if (safeWorkspace) {
                const safeSoulPath = (0, paths_1.resolveWithin)(safeWorkspace, 'soul.md');
                (0, fs_1.mkdirSync)((0, path_1.dirname)(safeSoulPath), { recursive: true });
                (0, fs_1.writeFileSync)(safeSoulPath, newSoulContent || '', 'utf-8');
                savedToWorkspace = true;
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, agent: agent.name }, 'Failed to write soul.md to workspace, saving to DB only');
        }
        // Update SOUL content in DB
        const updateStmt = db.prepare(`
      UPDATE agents
      SET soul_content = ?, updated_at = ?
      WHERE ${isNaN(Number(agentId)) ? 'name' : 'id'} = ? AND workspace_id = ?
    `);
        updateStmt.run(newSoulContent, now, agentId, workspaceId);
        // Log activity
        db_1.db_helpers.logActivity('agent_soul_updated', 'agent', agent.id, auth.user.username, `SOUL content updated for agent ${agent.name}${template_name ? ` using template: ${template_name}` : ''}${savedToWorkspace ? ' (synced to workspace)' : ''}`, {
            template_used: template_name || null,
            content_length: newSoulContent ? newSoulContent.length : 0,
            previous_content_length: agent.soul_content ? agent.soul_content.length : 0,
            saved_to_workspace: savedToWorkspace
        }, workspaceId);
        return server_1.NextResponse.json({
            success: true,
            message: `SOUL content updated for ${agent.name}`,
            soul_content: newSoulContent,
            saved_to_workspace: savedToWorkspace,
            updated_at: now
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/agents/[id]/soul error');
        return server_1.NextResponse.json({ error: 'Failed to update SOUL content' }, { status: 500 });
    }
}
/**
 * GET /api/agents/[id]/soul/templates - Get available SOUL templates
 * Also handles loading specific template content
 */
async function PATCH(request, { params }) {
    try {
        const { searchParams } = new URL(request.url);
        const templateName = searchParams.get('template');
        const templatesPath = config_1.config.soulTemplatesDir;
        if (!templatesPath || !(0, fs_1.existsSync)(templatesPath)) {
            return server_1.NextResponse.json({
                templates: [],
                message: 'Templates directory not found'
            });
        }
        if (templateName) {
            // Get specific template content
            let templatePath;
            try {
                templatePath = (0, paths_1.resolveWithin)(templatesPath, `${templateName}.md`);
            }
            catch (pathError) {
                return server_1.NextResponse.json({ error: 'Invalid template name' }, { status: 400 });
            }
            if (!(0, fs_1.existsSync)(templatePath)) {
                return server_1.NextResponse.json({ error: 'Template not found' }, { status: 404 });
            }
            const templateContent = (0, fs_1.readFileSync)(templatePath, 'utf8');
            return server_1.NextResponse.json({
                template_name: templateName,
                content: templateContent
            });
        }
        // List all available templates
        const files = (0, fs_1.readdirSync)(templatesPath);
        const templates = files
            .filter(file => file.endsWith('.md'))
            .map(file => {
            const name = file.replace('.md', '');
            const templatePath = (0, path_1.join)(templatesPath, file);
            const content = (0, fs_1.readFileSync)(templatePath, 'utf8');
            // Extract first line as description
            const firstLine = content.split('\n')[0];
            const description = firstLine.startsWith('#')
                ? firstLine.replace(/^#+\s*/, '')
                : `${name} template`;
            return {
                name,
                description,
                size: content.length
            };
        });
        return server_1.NextResponse.json({ templates });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PATCH /api/agents/[id]/soul error');
        return server_1.NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }
}
