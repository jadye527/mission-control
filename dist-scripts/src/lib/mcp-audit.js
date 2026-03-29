"use strict";
/**
 * MCP Audit — logs and analyzes MCP tool calls per agent.
 *
 * Tracks every tool invocation with success/failure, duration, and error detail.
 * Provides aggregated stats for efficiency dashboards.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logMcpCall = logMcpCall;
exports.getMcpCallStats = getMcpCallStats;
const db_1 = require("@/lib/db");
function logMcpCall(input) {
    var _a, _b, _c, _d, _e, _f;
    const db = (0, db_1.getDatabase)();
    const result = db.prepare(`
    INSERT INTO mcp_call_log (agent_name, mcp_server, tool_name, success, duration_ms, error, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run((_a = input.agentName) !== null && _a !== void 0 ? _a : null, (_b = input.mcpServer) !== null && _b !== void 0 ? _b : null, (_c = input.toolName) !== null && _c !== void 0 ? _c : null, input.success !== false ? 1 : 0, (_d = input.durationMs) !== null && _d !== void 0 ? _d : null, (_e = input.error) !== null && _e !== void 0 ? _e : null, (_f = input.workspaceId) !== null && _f !== void 0 ? _f : 1);
    return result.lastInsertRowid;
}
function getMcpCallStats(agentName, hours = 24, workspaceId = 1) {
    var _a, _b, _c, _d;
    const db = (0, db_1.getDatabase)();
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since);
    const breakdown = db.prepare(`
    SELECT
      tool_name,
      mcp_server,
      COUNT(*) as calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
    GROUP BY tool_name, mcp_server
    ORDER BY calls DESC
  `).all(agentName, workspaceId, since);
    const total = (_a = totals === null || totals === void 0 ? void 0 : totals.total) !== null && _a !== void 0 ? _a : 0;
    const successCount = (_b = totals === null || totals === void 0 ? void 0 : totals.successes) !== null && _b !== void 0 ? _b : 0;
    const failureCount = (_c = totals === null || totals === void 0 ? void 0 : totals.failures) !== null && _c !== void 0 ? _c : 0;
    return {
        totalCalls: total,
        successCount,
        failureCount,
        successRate: total > 0 ? Math.round((successCount / total) * 10000) / 100 : 100,
        avgDurationMs: Math.round((_d = totals === null || totals === void 0 ? void 0 : totals.avg_duration) !== null && _d !== void 0 ? _d : 0),
        toolBreakdown: breakdown.map((row) => {
            var _a, _b, _c;
            return ({
                toolName: (_a = row.tool_name) !== null && _a !== void 0 ? _a : 'unknown',
                mcpServer: (_b = row.mcp_server) !== null && _b !== void 0 ? _b : 'unknown',
                calls: row.calls,
                successes: row.successes,
                failures: row.failures,
                avgDurationMs: Math.round((_c = row.avg_duration) !== null && _c !== void 0 ? _c : 0),
            });
        }),
    };
}
