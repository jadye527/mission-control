"use strict";
/**
 * Agent Evals — four-layer evaluation engine for agent performance.
 *
 * Layer 1 (Output): Task completion and correctness scoring
 * Layer 2 (Trace): Convergence analysis and reasoning coherence
 * Layer 3 (Component): Tool reliability from MCP call logs
 * Layer 4 (Drift): Rolling baseline comparison with threshold detection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evalTaskCompletion = evalTaskCompletion;
exports.evalCorrectnessScore = evalCorrectnessScore;
exports.runOutputEvals = runOutputEvals;
exports.convergenceScore = convergenceScore;
exports.evalReasoningCoherence = evalReasoningCoherence;
exports.evalToolReliability = evalToolReliability;
exports.checkDrift = checkDrift;
exports.runDriftCheck = runDriftCheck;
exports.getDriftTimeline = getDriftTimeline;
const db_1 = require("@/lib/db");
// ---------------------------------------------------------------------------
// Layer 1: Output Evals
// ---------------------------------------------------------------------------
function evalTaskCompletion(agentName, hours = 168, workspaceId = 1) {
    var _a, _b;
    const db = (0, db_1.getDatabase)();
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successful
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since);
    const total = (_a = row === null || row === void 0 ? void 0 : row.total) !== null && _a !== void 0 ? _a : 0;
    const completed = (_b = row === null || row === void 0 ? void 0 : row.completed) !== null && _b !== void 0 ? _b : 0;
    const score = total > 0 ? completed / total : 1.0;
    return {
        layer: 'output',
        score: Math.round(score * 100) / 100,
        passed: score >= 0.7,
        detail: `${completed}/${total} tasks completed (${(score * 100).toFixed(0)}%)`,
    };
}
function evalCorrectnessScore(agentName, hours = 168, workspaceId = 1) {
    var _a, _b;
    const db = (0, db_1.getDatabase)();
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successful,
      AVG(CASE WHEN feedback_rating IS NOT NULL THEN feedback_rating ELSE NULL END) as avg_rating
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND status = 'done' AND created_at > ?
  `).get(agentName, workspaceId, since);
    const total = (_a = row === null || row === void 0 ? void 0 : row.total) !== null && _a !== void 0 ? _a : 0;
    const successful = (_b = row === null || row === void 0 ? void 0 : row.successful) !== null && _b !== void 0 ? _b : 0;
    const successRate = total > 0 ? successful / total : 1.0;
    const avgRating = row === null || row === void 0 ? void 0 : row.avg_rating;
    // Blend success rate with feedback rating if available (normalized to 0-1 assuming 1-5 scale)
    const score = avgRating != null
        ? (successRate * 0.6 + ((avgRating - 1) / 4) * 0.4)
        : successRate;
    return {
        layer: 'output',
        score: Math.round(score * 100) / 100,
        passed: score >= 0.6,
        detail: `Correctness: ${(score * 100).toFixed(0)}% (${successful}/${total} successful${avgRating != null ? `, avg rating ${avgRating.toFixed(1)}` : ''})`,
    };
}
function runOutputEvals(agentName, hours = 168, workspaceId = 1) {
    return [
        evalTaskCompletion(agentName, hours, workspaceId),
        evalCorrectnessScore(agentName, hours, workspaceId),
    ];
}
// ---------------------------------------------------------------------------
// Layer 2: Trace Evals
// ---------------------------------------------------------------------------
function convergenceScore(totalToolCalls, uniqueTools) {
    if (uniqueTools === 0)
        return { score: 1.0, looping: false };
    const ratio = totalToolCalls / uniqueTools;
    // ratio > 3.0 indicates looping behavior
    return {
        score: Math.round(Math.min(1.0, 3.0 / ratio) * 100) / 100,
        looping: ratio > 3.0,
    };
}
function evalReasoningCoherence(agentName, hours = 24, workspaceId = 1) {
    var _a, _b;
    const db = (0, db_1.getDatabase)();
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const row = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COUNT(DISTINCT tool_name) as unique_tools
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since);
    const total = (_a = row === null || row === void 0 ? void 0 : row.total_calls) !== null && _a !== void 0 ? _a : 0;
    const unique = (_b = row === null || row === void 0 ? void 0 : row.unique_tools) !== null && _b !== void 0 ? _b : 0;
    const { score, looping } = convergenceScore(total, unique);
    return {
        layer: 'trace',
        score,
        passed: !looping,
        detail: `Convergence: ${total} calls across ${unique} unique tools (ratio ${unique > 0 ? (total / unique).toFixed(1) : 'N/A'})${looping ? ' — LOOPING DETECTED' : ''}`,
    };
}
// ---------------------------------------------------------------------------
// Layer 3: Component Evals
// ---------------------------------------------------------------------------
function evalToolReliability(agentName, hours = 24, workspaceId = 1) {
    var _a, _b;
    const db = (0, db_1.getDatabase)();
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since);
    const total = (_a = row === null || row === void 0 ? void 0 : row.total) !== null && _a !== void 0 ? _a : 0;
    const successes = (_b = row === null || row === void 0 ? void 0 : row.successes) !== null && _b !== void 0 ? _b : 0;
    const score = total > 0 ? successes / total : 1.0;
    return {
        layer: 'component',
        score: Math.round(score * 100) / 100,
        passed: score >= 0.8,
        detail: `Tool reliability: ${successes}/${total} successful (${(score * 100).toFixed(0)}%)`,
    };
}
// ---------------------------------------------------------------------------
// Layer 4: Drift Detection
// ---------------------------------------------------------------------------
const DRIFT_THRESHOLD = 0.10;
function checkDrift(current, baseline, threshold = DRIFT_THRESHOLD) {
    const delta = baseline !== 0
        ? Math.abs(current - baseline) / Math.abs(baseline)
        : current !== 0 ? 1.0 : 0.0;
    return {
        metric: '',
        current,
        baseline,
        delta: Math.round(delta * 10000) / 10000,
        drifted: delta > threshold,
        threshold,
    };
}
function runDriftCheck(agentName, workspaceId = 1) {
    var _a, _b, _c, _d, _e, _f;
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    const oneWeek = 7 * 86400;
    const fourWeeks = 4 * 7 * 86400;
    // Current window: last 7 days
    const currentStart = now - oneWeek;
    // Baseline window: 4 weeks ending 1 week ago
    const baselineStart = now - fourWeeks;
    const baselineEnd = currentStart;
    // Metric: avg tokens per session
    const currentTokens = db.prepare(`
    SELECT AVG(input_tokens + output_tokens) as avg_tokens
    FROM token_usage
    WHERE agent_name = ? AND created_at > ?
  `).get(agentName, currentStart);
    const baselineTokens = db.prepare(`
    SELECT AVG(input_tokens + output_tokens) as avg_tokens
    FROM token_usage
    WHERE agent_name = ? AND created_at > ? AND created_at <= ?
  `).get(agentName, baselineStart, baselineEnd);
    const tokenDrift = checkDrift((_a = currentTokens === null || currentTokens === void 0 ? void 0 : currentTokens.avg_tokens) !== null && _a !== void 0 ? _a : 0, (_b = baselineTokens === null || baselineTokens === void 0 ? void 0 : baselineTokens.avg_tokens) !== null && _b !== void 0 ? _b : 0);
    tokenDrift.metric = 'avg_tokens_per_session';
    // Metric: tool success rate
    const currentTools = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, currentStart);
    const baselineTools = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
  `).get(agentName, workspaceId, baselineStart, baselineEnd);
    const currentSuccessRate = ((_c = currentTools === null || currentTools === void 0 ? void 0 : currentTools.total) !== null && _c !== void 0 ? _c : 0) > 0
        ? (currentTools.successes / currentTools.total)
        : 1.0;
    const baselineSuccessRate = ((_d = baselineTools === null || baselineTools === void 0 ? void 0 : baselineTools.total) !== null && _d !== void 0 ? _d : 0) > 0
        ? (baselineTools.successes / baselineTools.total)
        : 1.0;
    const toolDrift = checkDrift(currentSuccessRate, baselineSuccessRate);
    toolDrift.metric = 'tool_success_rate';
    // Metric: task completion rate
    const currentTasks = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, currentStart);
    const baselineTasks = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
  `).get(agentName, workspaceId, baselineStart, baselineEnd);
    const currentCompletionRate = ((_e = currentTasks === null || currentTasks === void 0 ? void 0 : currentTasks.total) !== null && _e !== void 0 ? _e : 0) > 0
        ? (currentTasks.completed / currentTasks.total)
        : 1.0;
    const baselineCompletionRate = ((_f = baselineTasks === null || baselineTasks === void 0 ? void 0 : baselineTasks.total) !== null && _f !== void 0 ? _f : 0) > 0
        ? (baselineTasks.completed / baselineTasks.total)
        : 1.0;
    const taskDrift = checkDrift(currentCompletionRate, baselineCompletionRate);
    taskDrift.metric = 'task_completion_rate';
    return [tokenDrift, toolDrift, taskDrift];
}
function getDriftTimeline(agentName, weeks = 8, workspaceId = 1) {
    var _a, _b, _c;
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    const timeline = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const weekStart = now - (i + 1) * 7 * 86400;
        const weekEnd = now - i * 7 * 86400;
        const tokens = db.prepare(`
      SELECT AVG(input_tokens + output_tokens) as avg_tokens
      FROM token_usage
      WHERE agent_name = ? AND created_at > ? AND created_at <= ?
    `).get(agentName, weekStart, weekEnd);
        const tools = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
      FROM mcp_call_log
      WHERE agent_name = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
    `).get(agentName, workspaceId, weekStart, weekEnd);
        const tasks = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
      FROM tasks
      WHERE assigned_to = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
    `).get(agentName, workspaceId, weekStart, weekEnd);
        timeline.push({
            weekStart,
            avgTokens: Math.round((_a = tokens === null || tokens === void 0 ? void 0 : tokens.avg_tokens) !== null && _a !== void 0 ? _a : 0),
            successRate: ((_b = tools === null || tools === void 0 ? void 0 : tools.total) !== null && _b !== void 0 ? _b : 0) > 0 ? Math.round((tools.successes / tools.total) * 10000) / 100 : 100,
            completionRate: ((_c = tasks === null || tasks === void 0 ? void 0 : tasks.total) !== null && _c !== void 0 ? _c : 0) > 0 ? Math.round((tasks.completed / tasks.total) * 10000) / 100 : 100,
        });
    }
    return timeline;
}
