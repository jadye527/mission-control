"use strict";
/**
 * Hermes Agent Session Scanner — reads ~/.hermes/state.db (SQLite)
 * to discover hermes-agent sessions and map them to MC's unified session format.
 *
 * Opens the database read-only to avoid locking conflicts with a running agent.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHermesInstalled = isHermesInstalled;
exports.isHermesGatewayRunning = isHermesGatewayRunning;
exports.scanHermesSessions = scanHermesSessions;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — hermes sessions are shorter-lived
const DEFAULT_SESSION_LIMIT = 100;
function getHermesDbPath() {
    return (0, node_path_1.join)(config_1.config.homeDir, '.hermes', 'state.db');
}
function getHermesPidPath() {
    return (0, node_path_1.join)(config_1.config.homeDir, '.hermes', 'gateway.pid');
}
let hermesBinaryCache = null;
function hasHermesCliBinary() {
    const now = Date.now();
    if (hermesBinaryCache && now - hermesBinaryCache.checkedAt < 30000) {
        return hermesBinaryCache.installed;
    }
    const candidates = [process.env.HERMES_BIN, 'hermes-agent', 'hermes'].filter((v) => Boolean(v && v.trim()));
    const installed = candidates.some((bin) => {
        try {
            const res = (0, node_child_process_1.spawnSync)(bin, ['--version'], { stdio: 'ignore', timeout: 1200 });
            return res.status === 0;
        }
        catch (_a) {
            return false;
        }
    });
    hermesBinaryCache = { checkedAt: now, installed };
    return installed;
}
function isHermesInstalled() {
    // Strict detection: show Hermes UI only when Hermes CLI is actually installed on this system.
    return hasHermesCliBinary();
}
function isHermesGatewayRunning() {
    const pidPath = getHermesPidPath();
    if (!(0, node_fs_1.existsSync)(pidPath))
        return false;
    try {
        const pidStr = (0, node_fs_1.readFileSync)(pidPath, 'utf8').trim();
        const pid = parseInt(pidStr, 10);
        if (!Number.isFinite(pid) || pid <= 0)
            return false;
        // Check if process exists (signal 0 doesn't kill, just checks)
        process.kill(pid, 0);
        return true;
    }
    catch (_a) {
        return false;
    }
}
function epochSecondsToISO(epoch) {
    if (!epoch || !Number.isFinite(epoch) || epoch <= 0)
        return null;
    // Hermes stores timestamps as epoch seconds
    return new Date(epoch * 1000).toISOString();
}
function scanHermesSessions(limit = DEFAULT_SESSION_LIMIT) {
    const dbPath = getHermesDbPath();
    if (!(0, node_fs_1.existsSync)(dbPath))
        return [];
    let db = null;
    try {
        db = new better_sqlite3_1.default(dbPath, { readonly: true, fileMustExist: true });
        // Verify the sessions table exists
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
        if (!(tableCheck === null || tableCheck === void 0 ? void 0 : tableCheck.name))
            return [];
        const rows = db.prepare(`
      SELECT id, source, user_id, model, started_at, ended_at,
             message_count, tool_call_count, input_tokens, output_tokens, title
      FROM sessions
      ORDER BY COALESCE(ended_at, started_at) DESC
      LIMIT ?
    `).all(limit);
        const now = Date.now();
        const gatewayRunning = isHermesGatewayRunning();
        return rows.map((row) => {
            const firstMessageAt = epochSecondsToISO(row.started_at);
            let lastMessageAt = epochSecondsToISO(row.ended_at);
            // If session has no end time, try to get latest message timestamp
            if (!lastMessageAt && row.started_at) {
                try {
                    const latestMsg = db.prepare('SELECT MAX(timestamp) as ts FROM messages WHERE session_id = ?').get(row.id);
                    if (latestMsg === null || latestMsg === void 0 ? void 0 : latestMsg.ts) {
                        lastMessageAt = epochSecondsToISO(latestMsg.ts);
                    }
                }
                catch (_a) {
                    // messages table may not exist or have different schema
                }
            }
            if (!lastMessageAt)
                lastMessageAt = firstMessageAt;
            const lastMs = lastMessageAt ? new Date(lastMessageAt).getTime() : 0;
            const isActive = row.ended_at === null
                && lastMs > 0
                && (now - lastMs) < ACTIVE_THRESHOLD_MS
                && gatewayRunning;
            return {
                sessionId: row.id,
                source: row.source || 'cli',
                model: row.model || null,
                title: row.title || null,
                messageCount: row.message_count || 0,
                toolCallCount: row.tool_call_count || 0,
                inputTokens: row.input_tokens || 0,
                outputTokens: row.output_tokens || 0,
                firstMessageAt,
                lastMessageAt,
                isActive,
            };
        });
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to scan Hermes sessions');
        return [];
    }
    finally {
        try {
            db === null || db === void 0 ? void 0 : db.close();
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
}
