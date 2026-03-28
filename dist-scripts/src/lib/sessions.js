import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
function getGatewaySessionStoreFiles() {
    const openclawStateDir = config.openclawStateDir;
    if (!openclawStateDir)
        return [];
    const agentsDir = path.join(openclawStateDir, 'agents');
    if (!fs.existsSync(agentsDir))
        return [];
    let agentDirs;
    try {
        agentDirs = fs.readdirSync(agentsDir);
    }
    catch (_a) {
        return [];
    }
    const files = [];
    for (const agentName of agentDirs) {
        const sessionsFile = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
        try {
            if (fs.statSync(sessionsFile).isFile())
                files.push(sessionsFile);
        }
        catch (_b) {
            // Skip missing or unreadable session stores.
        }
    }
    return files;
}
let _sessionCache = null;
const SESSION_CACHE_TTL_MS = 30000;
/** Invalidate the session cache (e.g. after pruning). */
export function invalidateSessionCache() {
    _sessionCache = null;
}
/**
 * Read all sessions from OpenClaw agent session stores on disk.
 *
 * OpenClaw stores sessions per-agent at:
 *   {OPENCLAW_STATE_DIR}/agents/{agentName}/sessions/sessions.json
 *
 * Each file is a JSON object keyed by session key (e.g. "agent:<agent>:main")
 * with session metadata as values.
 */
export function getAllGatewaySessions(activeWithinMs = 60 * 60 * 1000, force = false) {
    var _a, _b;
    const now = Date.now();
    let raw;
    if (!force && _sessionCache && (now - _sessionCache.ts) < SESSION_CACHE_TTL_MS) {
        raw = _sessionCache.data;
    }
    else {
        const sessions = [];
        for (const sessionsFile of getGatewaySessionStoreFiles()) {
            const agentName = path.basename(path.dirname(path.dirname(sessionsFile)));
            try {
                const fileContent = fs.readFileSync(sessionsFile, 'utf-8');
                const data = JSON.parse(fileContent);
                for (const [key, entry] of Object.entries(data)) {
                    const s = entry;
                    const updatedAt = s.updatedAt || 0;
                    sessions.push({
                        key,
                        agent: agentName,
                        sessionId: s.sessionId || '',
                        updatedAt,
                        chatType: s.chatType || 'unknown',
                        channel: ((_a = s.deliveryContext) === null || _a === void 0 ? void 0 : _a.channel) || s.lastChannel || s.channel || '',
                        model: typeof s.model === 'object' && ((_b = s.model) === null || _b === void 0 ? void 0 : _b.primary) ? String(s.model.primary) : String(s.model || ''),
                        totalTokens: s.totalTokens || 0,
                        inputTokens: s.inputTokens || 0,
                        outputTokens: s.outputTokens || 0,
                        contextTokens: s.contextTokens || 0,
                    });
                }
            }
            catch (_c) {
                // Skip agents without valid session files
            }
        }
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        _sessionCache = { data: sessions, ts: Date.now() };
        raw = sessions;
    }
    // Compute `active` at read time so it's always fresh regardless of cache age
    return raw.map(s => (Object.assign(Object.assign({}, s), { active: (now - s.updatedAt) < activeWithinMs })));
}
export function countStaleGatewaySessions(retentionDays) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0)
        return 0;
    const cutoff = Date.now() - retentionDays * 86400000;
    let stale = 0;
    for (const sessionsFile of getGatewaySessionStoreFiles()) {
        try {
            const raw = fs.readFileSync(sessionsFile, 'utf-8');
            const data = JSON.parse(raw);
            for (const entry of Object.values(data)) {
                const updatedAt = Number((entry === null || entry === void 0 ? void 0 : entry.updatedAt) || 0);
                if (updatedAt > 0 && updatedAt < cutoff)
                    stale += 1;
            }
        }
        catch (_a) {
            // Ignore malformed session stores.
        }
    }
    return stale;
}
export function pruneGatewaySessionsOlderThan(retentionDays) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0)
        return { deleted: 0, filesTouched: 0 };
    const cutoff = Date.now() - retentionDays * 86400000;
    let deleted = 0;
    let filesTouched = 0;
    for (const sessionsFile of getGatewaySessionStoreFiles()) {
        try {
            const raw = fs.readFileSync(sessionsFile, 'utf-8');
            const data = JSON.parse(raw);
            const nextEntries = {};
            let fileDeleted = 0;
            for (const [key, entry] of Object.entries(data)) {
                const updatedAt = Number((entry === null || entry === void 0 ? void 0 : entry.updatedAt) || 0);
                if (updatedAt > 0 && updatedAt < cutoff) {
                    fileDeleted += 1;
                    continue;
                }
                nextEntries[key] = entry;
            }
            if (fileDeleted > 0) {
                const tempPath = `${sessionsFile}.tmp`;
                fs.writeFileSync(tempPath, `${JSON.stringify(nextEntries, null, 2)}\n`, 'utf-8');
                fs.renameSync(tempPath, sessionsFile);
                deleted += fileDeleted;
                filesTouched += 1;
            }
        }
        catch (_a) {
            // Ignore malformed/unwritable session stores.
        }
    }
    if (filesTouched > 0)
        invalidateSessionCache();
    return { deleted, filesTouched };
}
/**
 * Derive agent active/idle/offline status from their sessions.
 * Returns a map of agentName -> { status, lastActivity, channel }
 */
export function getAgentLiveStatuses() {
    const sessions = getAllGatewaySessions();
    const now = Date.now();
    const statuses = new Map();
    for (const session of sessions) {
        const existing = statuses.get(session.agent);
        // Keep the most recent session per agent
        if (!existing || session.updatedAt > existing.lastActivity) {
            const age = now - session.updatedAt;
            let status;
            if (age < 5 * 60 * 1000) {
                status = 'active'; // Active within 5 minutes
            }
            else if (age < 60 * 60 * 1000) {
                status = 'idle'; // Active within 1 hour
            }
            else {
                status = 'offline';
            }
            statuses.set(session.agent, {
                status,
                lastActivity: session.updatedAt,
                channel: session.channel,
            });
        }
    }
    return statuses;
}
