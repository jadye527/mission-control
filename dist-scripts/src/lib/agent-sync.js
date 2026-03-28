/**
 * Agent Config Sync
 *
 * Reads agents from openclaw.json and upserts them into the MC database.
 * Used by both the /api/agents/sync endpoint and the startup scheduler.
 */
import { config } from './config';
import { getDatabase, logAuditEvent } from './db';
import { eventBus } from './event-bus';
import { isAbsolute, resolve } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { resolveWithin } from './paths';
import { logger } from './logger';
import { parseJsonRelaxed } from './json-relaxed';
function parseIdentityFromFile(content) {
    if (!content.trim())
        return {};
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
    let name;
    let theme;
    let emoji;
    for (const line of lines) {
        if (!name && line.startsWith('#')) {
            name = line.replace(/^#+\s*/, '').trim();
            continue;
        }
        if (!theme) {
            const themeMatch = line.match(/^theme\s*:\s*(.+)$/i);
            if (themeMatch === null || themeMatch === void 0 ? void 0 : themeMatch[1]) {
                theme = themeMatch[1].trim();
                continue;
            }
        }
        if (!emoji) {
            const emojiMatch = line.match(/^emoji\s*:\s*(.+)$/i);
            if (emojiMatch === null || emojiMatch === void 0 ? void 0 : emojiMatch[1]) {
                emoji = emojiMatch[1].trim();
            }
        }
    }
    return Object.assign(Object.assign(Object.assign(Object.assign({}, (name ? { name } : {})), (theme ? { theme } : {})), (emoji ? { emoji } : {})), { content: lines.slice(0, 8).join('\n') });
}
function parseToolsFromFile(content) {
    if (!content.trim())
        return {};
    const parsedTools = new Set();
    for (const line of content.split('\n')) {
        const cleaned = line.trim();
        if (!cleaned || cleaned.startsWith('#'))
            continue;
        const listMatch = cleaned.match(/^[-*]\s+`?([^`]+?)`?\s*$/);
        if (listMatch === null || listMatch === void 0 ? void 0 : listMatch[1]) {
            parsedTools.add(listMatch[1].trim());
            continue;
        }
        const inlineMatch = cleaned.match(/^`([^`]+)`$/);
        if (inlineMatch === null || inlineMatch === void 0 ? void 0 : inlineMatch[1]) {
            parsedTools.add(inlineMatch[1].trim());
        }
    }
    const allow = [...parsedTools].filter(Boolean);
    return Object.assign(Object.assign({}, (allow.length > 0 ? { allow } : {})), { raw: content.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 24).join('\n') });
}
function getConfigPath() {
    return config.openclawConfigPath || null;
}
function resolveAgentWorkspacePath(workspace) {
    if (isAbsolute(workspace))
        return resolve(workspace);
    if (!config.openclawStateDir) {
        throw new Error('OPENCLAW_STATE_DIR not configured');
    }
    return resolveWithin(config.openclawStateDir, workspace);
}
const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024; // 1 MB
/** Safely read a file from an agent's workspace directory */
function readWorkspaceFile(workspace, filename) {
    if (!workspace)
        return null;
    try {
        const safeWorkspace = resolveAgentWorkspacePath(workspace);
        const safePath = resolveWithin(safeWorkspace, filename);
        if (existsSync(safePath)) {
            const size = statSync(safePath).size;
            if (size > MAX_WORKSPACE_FILE_BYTES) {
                logger.warn({ workspace, filename, size }, `Workspace file exceeds ${MAX_WORKSPACE_FILE_BYTES} byte limit, skipping`);
                return null;
            }
            return readFileSync(safePath, 'utf-8');
        }
    }
    catch (err) {
        logger.warn({ err, workspace, filename }, 'Failed to read workspace file');
    }
    return null;
}
export function enrichAgentConfigFromWorkspace(configData) {
    if (!configData || typeof configData !== 'object')
        return configData;
    const workspace = typeof configData.workspace === 'string' ? configData.workspace : undefined;
    if (!workspace)
        return configData;
    const identityFile = readWorkspaceFile(workspace, 'identity.md');
    const toolsFile = readWorkspaceFile(workspace, 'TOOLS.md');
    const mergedIdentity = Object.assign(Object.assign({}, parseIdentityFromFile(identityFile || '')), ((configData.identity && typeof configData.identity === 'object') ? configData.identity : {}));
    const mergedTools = Object.assign(Object.assign({}, parseToolsFromFile(toolsFile || '')), ((configData.tools && typeof configData.tools === 'object') ? configData.tools : {}));
    return Object.assign(Object.assign({}, configData), { identity: Object.keys(mergedIdentity).length > 0 ? mergedIdentity : configData.identity, tools: Object.keys(mergedTools).length > 0 ? mergedTools : configData.tools });
}
/** Read and parse openclaw.json agents list */
async function readOpenClawAgents() {
    var _a;
    const configPath = getConfigPath();
    if (!configPath)
        throw new Error('OPENCLAW_CONFIG_PATH not configured');
    const { readFile } = require('fs/promises');
    const raw = await readFile(configPath, 'utf-8');
    const parsed = parseJsonRelaxed(raw);
    return ((_a = parsed === null || parsed === void 0 ? void 0 : parsed.agents) === null || _a === void 0 ? void 0 : _a.list) || [];
}
/** Extract MC-friendly fields from an OpenClaw agent config */
function mapAgentToMC(agent) {
    var _a, _b;
    const name = ((_a = agent.identity) === null || _a === void 0 ? void 0 : _a.name) || agent.name || agent.id;
    const role = ((_b = agent.identity) === null || _b === void 0 ? void 0 : _b.theme) || 'agent';
    // Store the full config minus systemPrompt/soul (which can be large)
    const configData = enrichAgentConfigFromWorkspace({
        openclawId: agent.id,
        model: agent.model,
        identity: agent.identity,
        sandbox: agent.sandbox,
        tools: agent.tools,
        subagents: agent.subagents,
        memorySearch: agent.memorySearch,
        workspace: agent.workspace,
        agentDir: agent.agentDir,
        isDefault: agent.default || false,
    });
    // Read soul.md from the agent's workspace if available
    const soul_content = readWorkspaceFile(agent.workspace, 'soul.md');
    return { name, role, config: configData, soul_content };
}
/** Sync agents from openclaw.json into the MC database */
export async function syncAgentsFromConfig(actor = 'system') {
    let agents;
    try {
        agents = await readOpenClawAgents();
    }
    catch (err) {
        return { synced: 0, created: 0, updated: 0, agents: [], error: err.message };
    }
    if (agents.length === 0) {
        return { synced: 0, created: 0, updated: 0, agents: [] };
    }
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    let created = 0;
    let updated = 0;
    const results = [];
    const findByName = db.prepare('SELECT id, name, role, config, soul_content FROM agents WHERE name = ?');
    const insertAgent = db.prepare(`
    INSERT INTO agents (name, role, soul_content, status, created_at, updated_at, config)
    VALUES (?, ?, ?, 'offline', ?, ?, ?)
  `);
    const updateAgent = db.prepare(`
    UPDATE agents SET role = ?, config = ?, soul_content = ?, updated_at = ? WHERE name = ?
  `);
    db.transaction(() => {
        var _a;
        for (const agent of agents) {
            const mapped = mapAgentToMC(agent);
            const configJson = JSON.stringify(mapped.config);
            const existing = findByName.get(mapped.name);
            if (existing) {
                // Check if config or soul_content actually changed
                const existingConfig = existing.config || '{}';
                const existingSoul = existing.soul_content || null;
                const configChanged = existingConfig !== configJson || existing.role !== mapped.role;
                const soulChanged = mapped.soul_content !== null && mapped.soul_content !== existingSoul;
                if (configChanged || soulChanged) {
                    // Only overwrite soul_content if we read a new value from workspace
                    const soulToWrite = (_a = mapped.soul_content) !== null && _a !== void 0 ? _a : existingSoul;
                    updateAgent.run(mapped.role, configJson, soulToWrite, now, mapped.name);
                    results.push({ id: agent.id, name: mapped.name, action: 'updated' });
                    updated++;
                }
                else {
                    results.push({ id: agent.id, name: mapped.name, action: 'unchanged' });
                }
            }
            else {
                insertAgent.run(mapped.name, mapped.role, mapped.soul_content, now, now, configJson);
                results.push({ id: agent.id, name: mapped.name, action: 'created' });
                created++;
            }
        }
    })();
    const synced = agents.length;
    // Log audit event
    if (created > 0 || updated > 0) {
        logAuditEvent({
            action: 'agent_config_sync',
            actor,
            detail: { synced, created, updated, agents: results.filter(a => a.action !== 'unchanged').map(a => a.name) },
        });
        // Broadcast sync event
        eventBus.broadcast('agent.created', { type: 'sync', synced, created, updated });
    }
    logger.info({ synced, created, updated }, 'Agent sync complete');
    return { synced, created, updated, agents: results };
}
/** Preview the diff between openclaw.json and MC database without writing */
export async function previewSyncDiff() {
    let agents;
    try {
        agents = await readOpenClawAgents();
    }
    catch (_a) {
        return { inConfig: 0, inMC: 0, newAgents: [], updatedAgents: [], onlyInMC: [] };
    }
    const db = getDatabase();
    const allMCAgents = db.prepare('SELECT name, role, config FROM agents').all();
    const mcNames = new Set(allMCAgents.map(a => a.name));
    const newAgents = [];
    const updatedAgents = [];
    const configNames = new Set();
    for (const agent of agents) {
        const mapped = mapAgentToMC(agent);
        configNames.add(mapped.name);
        const existing = allMCAgents.find(a => a.name === mapped.name);
        if (!existing) {
            newAgents.push(mapped.name);
        }
        else {
            const configJson = JSON.stringify(mapped.config);
            if (existing.config !== configJson || existing.role !== mapped.role) {
                updatedAgents.push(mapped.name);
            }
        }
    }
    const onlyInMC = allMCAgents
        .map(a => a.name)
        .filter(name => !configNames.has(name));
    return {
        inConfig: agents.length,
        inMC: allMCAgents.length,
        newAgents,
        updatedAgents,
        onlyInMC,
    };
}
/** Write an agent config back to openclaw.json agents.list */
export async function writeAgentToConfig(agentConfig) {
    const configPath = getConfigPath();
    if (!configPath)
        throw new Error('OPENCLAW_CONFIG_PATH not configured');
    const { readFile, writeFile } = require('fs/promises');
    const raw = await readFile(configPath, 'utf-8');
    const parsed = parseJsonRelaxed(raw);
    if (!parsed.agents)
        parsed.agents = {};
    if (!parsed.agents.list)
        parsed.agents.list = [];
    const normalizedAgentConfig = normalizeAgentConfigForOpenClaw(agentConfig);
    // Find existing by id
    const idx = parsed.agents.list.findIndex((a) => a.id === normalizedAgentConfig.id);
    if (idx >= 0) {
        // Deep merge: preserve fields not in update
        parsed.agents.list[idx] = normalizeAgentConfigForOpenClaw(deepMerge(parsed.agents.list[idx], normalizedAgentConfig));
    }
    else {
        parsed.agents.list.push(normalizedAgentConfig);
    }
    await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n');
}
export async function removeAgentFromConfig(match) {
    var _a;
    const configPath = getConfigPath();
    if (!configPath)
        throw new Error('OPENCLAW_CONFIG_PATH not configured');
    const id = String(match.id || '').trim();
    const name = String(match.name || '').trim();
    if (!id && !name) {
        return { removed: false };
    }
    const { readFile, writeFile } = require('fs/promises');
    const raw = await readFile(configPath, 'utf-8');
    const parsed = parseJsonRelaxed(raw);
    const existingList = Array.isArray((_a = parsed === null || parsed === void 0 ? void 0 : parsed.agents) === null || _a === void 0 ? void 0 : _a.list) ? parsed.agents.list : [];
    const nextList = existingList.filter((agent) => {
        var _a;
        const agentId = String((agent === null || agent === void 0 ? void 0 : agent.id) || '').trim();
        const agentName = String((agent === null || agent === void 0 ? void 0 : agent.name) || '').trim();
        const identityName = String(((_a = agent === null || agent === void 0 ? void 0 : agent.identity) === null || _a === void 0 ? void 0 : _a.name) || '').trim();
        if (id && agentId === id)
            return false;
        if (name && (agentName === name || identityName === name))
            return false;
        return true;
    });
    if (nextList.length === existingList.length) {
        return { removed: false };
    }
    if (!parsed.agents)
        parsed.agents = {};
    parsed.agents.list = nextList;
    await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n');
    return { removed: true };
}
/** Deep merge two objects (target <- source), preserving target fields not in source */
function deepMerge(target, source) {
    const result = Object.assign({}, target);
    for (const key of Object.keys(source)) {
        if (source[key] &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            target[key] &&
            typeof target[key] === 'object' &&
            !Array.isArray(target[key])) {
            result[key] = deepMerge(target[key], source[key]);
        }
        else {
            result[key] = source[key];
        }
    }
    return result;
}
function normalizeModelConfig(model) {
    if (!model || typeof model !== 'object' || Array.isArray(model))
        return model;
    const current = Object.assign({}, model);
    let primary = current.primary;
    while (primary && typeof primary === 'object' && !Array.isArray(primary)) {
        const nestedPrimary = primary.primary;
        if (typeof nestedPrimary !== 'string')
            break;
        primary = nestedPrimary;
    }
    const normalizedFallbacks = Array.isArray(current.fallbacks)
        ? [...new Set(current.fallbacks.map((value) => String(value || '').trim()).filter(Boolean))]
        : current.fallbacks;
    return Object.assign(Object.assign(Object.assign({}, current), (typeof primary === 'string' ? { primary } : {})), (Array.isArray(normalizedFallbacks) ? { fallbacks: normalizedFallbacks } : {}));
}
function normalizeAgentConfigForOpenClaw(agentConfig) {
    if (!agentConfig || typeof agentConfig !== 'object')
        return agentConfig;
    if (!('model' in agentConfig))
        return agentConfig;
    return Object.assign(Object.assign({}, agentConfig), { model: normalizeModelConfig(agentConfig.model) });
}
