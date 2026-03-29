"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanCodexSessions = scanCodexSessions;
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("./config");
const logger_1 = require("./logger");
const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000;
const DEFAULT_FILE_SCAN_LIMIT = 120;
const FUTURE_TOLERANCE_MS = 60 * 1000;
function asObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
function asString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function deriveSessionId(filePath) {
    const name = (0, path_1.basename)(filePath, '.jsonl');
    const match = name.match(/([0-9a-f]{8,}-[0-9a-f-]{8,})$/i);
    return (match === null || match === void 0 ? void 0 : match[1]) || name;
}
function listRecentCodexSessionFiles(limit) {
    const root = (0, path_1.join)(config_1.config.homeDir, '.codex', 'sessions');
    const files = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        if (!dir)
            continue;
        let entries;
        try {
            entries = (0, fs_1.readdirSync)(dir);
        }
        catch (_a) {
            continue;
        }
        for (const entry of entries) {
            const fullPath = (0, path_1.join)(dir, entry);
            let stat;
            try {
                stat = (0, fs_1.statSync)(fullPath);
            }
            catch (_b) {
                continue;
            }
            if (stat.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!stat.isFile() || !fullPath.endsWith('.jsonl'))
                continue;
            files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
        }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files.slice(0, Math.max(1, limit));
}
function clampTimestamp(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return 0;
    const now = Date.now();
    // Guard against timezone/clock skew in session logs.
    if (ms > now + FUTURE_TOLERANCE_MS)
        return now;
    return ms;
}
function parseCodexSessionFile(filePath, fileMtimeMs) {
    let content;
    try {
        content = (0, fs_1.readFileSync)(filePath, 'utf-8');
    }
    catch (_a) {
        return null;
    }
    const lines = content.split('\n').filter(Boolean);
    if (lines.length === 0)
        return null;
    let sessionId = deriveSessionId(filePath);
    let projectPath = null;
    let model = null;
    let userMessages = 0;
    let assistantMessages = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let firstMessageAt = null;
    let lastMessageAt = null;
    for (const line of lines) {
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch (_b) {
            continue;
        }
        const entry = asObject(parsed);
        if (!entry)
            continue;
        const timestamp = asString(entry.timestamp);
        if (timestamp) {
            if (!firstMessageAt)
                firstMessageAt = timestamp;
            lastMessageAt = timestamp;
        }
        const entryType = asString(entry.type);
        const payload = asObject(entry.payload);
        if (entryType === 'session_meta' && payload) {
            const metaId = asString(payload.id);
            if (metaId)
                sessionId = metaId;
            const cwd = asString(payload.cwd);
            if (cwd)
                projectPath = cwd;
            const metaModel = asString(payload.model);
            if (metaModel)
                model = metaModel;
            const startedAt = asString(payload.timestamp);
            if (startedAt && !firstMessageAt)
                firstMessageAt = startedAt;
            continue;
        }
        if (entryType === 'response_item' && payload) {
            const payloadType = asString(payload.type);
            const role = asString(payload.role);
            if (payloadType === 'message' && role === 'user')
                userMessages++;
            if (payloadType === 'message' && role === 'assistant')
                assistantMessages++;
            continue;
        }
        if (entryType === 'event_msg' && payload) {
            const msgType = asString(payload.type);
            if (msgType !== 'token_count')
                continue;
            const info = asObject(payload.info);
            const totals = info ? asObject(info.total_token_usage) : null;
            if (totals) {
                const inTokens = asNumber(totals.input_tokens) || 0;
                const cached = asNumber(totals.cached_input_tokens) || 0;
                const outTokens = asNumber(totals.output_tokens) || 0;
                const allTokens = asNumber(totals.total_tokens) || (inTokens + cached + outTokens);
                inputTokens = Math.max(inputTokens, inTokens + cached);
                outputTokens = Math.max(outputTokens, outTokens);
                totalTokens = Math.max(totalTokens, allTokens);
            }
            const limits = asObject(payload.rate_limits);
            const limitName = limits ? asString(limits.limit_name) : null;
            if (!model && limitName)
                model = limitName;
        }
    }
    if (!lastMessageAt && !firstMessageAt)
        return null;
    const projectSlug = projectPath
        ? (0, path_1.basename)(projectPath)
        : 'codex-local';
    const parsedFirstMs = firstMessageAt ? clampTimestamp(new Date(firstMessageAt).getTime()) : 0;
    const parsedLastMs = lastMessageAt ? clampTimestamp(new Date(lastMessageAt).getTime()) : 0;
    const mtimeMs = clampTimestamp(fileMtimeMs);
    const effectiveLastMs = Math.max(parsedLastMs, mtimeMs);
    const effectiveFirstMs = parsedFirstMs || mtimeMs;
    const isActive = effectiveLastMs > 0 && (Date.now() - effectiveLastMs) < ACTIVE_THRESHOLD_MS;
    return {
        sessionId,
        projectSlug,
        projectPath,
        model,
        userMessages,
        assistantMessages,
        inputTokens,
        outputTokens,
        totalTokens,
        firstMessageAt: effectiveFirstMs ? new Date(effectiveFirstMs).toISOString() : null,
        lastMessageAt: effectiveLastMs ? new Date(effectiveLastMs).toISOString() : null,
        isActive,
    };
}
function scanCodexSessions(limit = DEFAULT_FILE_SCAN_LIMIT) {
    try {
        const files = listRecentCodexSessionFiles(limit);
        const sessions = [];
        for (const file of files) {
            const parsed = parseCodexSessionFile(file.path, file.mtimeMs);
            if (parsed)
                sessions.push(parsed);
        }
        sessions.sort((a, b) => {
            const aTs = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bTs = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            return bTs - aTs;
        });
        return sessions;
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to scan Codex sessions');
        return [];
    }
}
