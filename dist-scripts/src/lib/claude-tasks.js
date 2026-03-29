"use strict";
/**
 * Claude Code Task & Team Scanner
 *
 * Read-only bridge that discovers Claude Code's:
 * - Team tasks from ~/.claude/tasks/<team>/<N>.json
 * - Team configs from ~/.claude/teams/<name>/config.json
 *
 * Follows the same throttled-scan pattern as claude-sessions.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanClaudeCodeTasks = scanClaudeCodeTasks;
exports.getClaudeCodeTasks = getClaudeCodeTasks;
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("./config");
const logger_1 = require("./logger");
function safeParse(filePath) {
    try {
        return JSON.parse((0, fs_1.readFileSync)(filePath, 'utf-8'));
    }
    catch (_a) {
        return null;
    }
}
function scanTeams(claudeHome) {
    const teamsDir = (0, path_1.join)(claudeHome, 'teams');
    let teamDirs;
    try {
        teamDirs = (0, fs_1.readdirSync)(teamsDir);
    }
    catch (_a) {
        return [];
    }
    const teams = [];
    for (const teamName of teamDirs) {
        const configPath = (0, path_1.join)(teamsDir, teamName, 'config.json');
        try {
            if (!(0, fs_1.statSync)(configPath).isFile())
                continue;
        }
        catch (_b) {
            continue;
        }
        const data = safeParse(configPath);
        if (!(data === null || data === void 0 ? void 0 : data.name))
            continue;
        teams.push({
            name: data.name,
            description: data.description || '',
            createdAt: data.createdAt || 0,
            leadAgentId: data.leadAgentId || '',
            members: Array.isArray(data.members)
                ? data.members.map((m) => ({
                    agentId: m.agentId || '',
                    name: m.name || '',
                    agentType: m.agentType || '',
                    model: m.model || '',
                }))
                : [],
        });
    }
    return teams;
}
function scanTasks(claudeHome) {
    const tasksDir = (0, path_1.join)(claudeHome, 'tasks');
    let teamDirs;
    try {
        teamDirs = (0, fs_1.readdirSync)(tasksDir);
    }
    catch (_a) {
        return [];
    }
    const tasks = [];
    for (const teamName of teamDirs) {
        const teamDir = (0, path_1.join)(tasksDir, teamName);
        try {
            if (!(0, fs_1.statSync)(teamDir).isDirectory())
                continue;
        }
        catch (_b) {
            continue;
        }
        // Skip .lock files, only read JSON task files
        let files;
        try {
            files = (0, fs_1.readdirSync)(teamDir).filter(f => f.endsWith('.json'));
        }
        catch (_c) {
            continue;
        }
        for (const file of files) {
            const data = safeParse((0, path_1.join)(teamDir, file));
            if (!(data === null || data === void 0 ? void 0 : data.id))
                continue;
            tasks.push({
                id: `${teamName}/${data.id}`,
                teamName,
                subject: data.subject || data.title || `Task ${data.id}`,
                description: data.description || '',
                status: data.status || 'unknown',
                owner: data.owner || '',
                blocks: Array.isArray(data.blocks) ? data.blocks : [],
                blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy : [],
                activeForm: data.activeForm,
            });
        }
    }
    return tasks;
}
function scanClaudeCodeTasks() {
    const claudeHome = config_1.config.claudeHome;
    if (!claudeHome)
        return { teams: [], tasks: [] };
    return {
        teams: scanTeams(claudeHome),
        tasks: scanTasks(claudeHome),
    };
}
// Throttle full disk scans
let lastScanAt = 0;
let cachedResult = { teams: [], tasks: [] };
const SCAN_THROTTLE_MS = 30000;
function getClaudeCodeTasks(force = false) {
    const now = Date.now();
    if (!force && lastScanAt > 0 && (now - lastScanAt) < SCAN_THROTTLE_MS) {
        return cachedResult;
    }
    try {
        cachedResult = scanClaudeCodeTasks();
        lastScanAt = now;
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Claude Code task scan failed');
    }
    return cachedResult;
}
