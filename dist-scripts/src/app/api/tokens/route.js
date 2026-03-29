"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const sessions_1 = require("@/lib/sessions");
const logger_1 = require("@/lib/logger");
const db_1 = require("@/lib/db");
const token_pricing_1 = require("@/lib/token-pricing");
const provider_subscriptions_1 = require("@/lib/provider-subscriptions");
const task_costs_1 = require("@/lib/task-costs");
const DATA_PATH = config_1.config.tokensPath;
function extractAgentName(sessionId) {
    const trimmed = sessionId.trim();
    if (!trimmed)
        return 'unknown';
    const [agent] = trimmed.split(':');
    return (agent === null || agent === void 0 ? void 0 : agent.trim()) || 'unknown';
}
function loadTokenDataFromDb(workspaceId, providerSubscriptions) {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare(`
      SELECT id, model, session_id, input_tokens, output_tokens, task_id, workspace_id, created_at
      FROM token_usage
      WHERE workspace_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 10000
    `).all(workspaceId);
        return rows.map((row) => {
            var _a, _b;
            const totalTokens = row.input_tokens + row.output_tokens;
            return {
                id: `db-${row.id}`,
                model: row.model,
                sessionId: row.session_id,
                agentName: extractAgentName(row.session_id),
                timestamp: row.created_at * 1000,
                inputTokens: row.input_tokens,
                outputTokens: row.output_tokens,
                totalTokens,
                cost: (0, token_pricing_1.calculateTokenCost)(row.model, row.input_tokens, row.output_tokens, { providerSubscriptions }),
                operation: 'heartbeat',
                taskId: (_a = row.task_id) !== null && _a !== void 0 ? _a : null,
                workspaceId: (_b = row.workspace_id) !== null && _b !== void 0 ? _b : workspaceId,
            };
        });
    }
    catch (error) {
        logger_1.logger.warn({ err: error }, 'Failed to load token usage from database');
        return [];
    }
}
function normalizeTokenRecord(record, providerSubscriptions) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!record.model || !record.sessionId)
        return null;
    const inputTokens = Number((_a = record.inputTokens) !== null && _a !== void 0 ? _a : 0);
    const outputTokens = Number((_b = record.outputTokens) !== null && _b !== void 0 ? _b : 0);
    const totalTokens = Number((_c = record.totalTokens) !== null && _c !== void 0 ? _c : inputTokens + outputTokens);
    const model = String(record.model);
    return {
        id: String((_d = record.id) !== null && _d !== void 0 ? _d : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`),
        model,
        sessionId: String(record.sessionId),
        agentName: String((_e = record.agentName) !== null && _e !== void 0 ? _e : extractAgentName(String(record.sessionId))),
        timestamp: Number((_f = record.timestamp) !== null && _f !== void 0 ? _f : Date.now()),
        inputTokens,
        outputTokens,
        totalTokens,
        cost: Number((_g = record.cost) !== null && _g !== void 0 ? _g : (0, token_pricing_1.calculateTokenCost)(model, inputTokens, outputTokens, { providerSubscriptions })),
        operation: String((_h = record.operation) !== null && _h !== void 0 ? _h : 'chat_completion'),
        taskId: record.taskId != null && Number.isFinite(Number(record.taskId)) ? Number(record.taskId) : null,
        workspaceId: record.workspaceId != null && Number.isFinite(Number(record.workspaceId)) ? Number(record.workspaceId) : 1,
        duration: record.duration,
    };
}
function dedupeTokenRecords(records) {
    var _a, _b, _c;
    const seen = new Set();
    const deduped = [];
    for (const record of records) {
        const key = [
            record.sessionId,
            record.model,
            record.timestamp,
            record.inputTokens,
            record.outputTokens,
            record.totalTokens,
            record.operation,
            (_a = record.taskId) !== null && _a !== void 0 ? _a : '',
            (_b = record.workspaceId) !== null && _b !== void 0 ? _b : 1,
            (_c = record.duration) !== null && _c !== void 0 ? _c : '',
        ].join('|');
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(record);
    }
    return deduped;
}
async function loadTokenDataFromFile(workspaceId, providerSubscriptions) {
    try {
        (0, config_1.ensureDirExists)((0, path_1.dirname)(DATA_PATH));
        await (0, promises_1.access)(DATA_PATH);
        const data = await (0, promises_1.readFile)(DATA_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .map((record) => normalizeTokenRecord(record, providerSubscriptions))
            .filter((record) => record !== null)
            .filter((record) => {
            if (record.workspaceId === workspaceId)
                return true;
            // Backward compatibility for pre-workspace records
            return workspaceId === 1 && (!record.workspaceId || record.workspaceId === 1);
        });
    }
    catch (_a) {
        return [];
    }
}
/**
 * Load token data from all sources: DB, file, and gateway session stores.
 * All sources are merged and deduplicated so session-derived data is always included.
 */
async function loadTokenData(workspaceId) {
    const providerSubscriptions = (0, provider_subscriptions_1.getProviderSubscriptionFlags)();
    const dbRecords = loadTokenDataFromDb(workspaceId, providerSubscriptions);
    const fileRecords = await loadTokenDataFromFile(workspaceId, providerSubscriptions);
    const sessionRecords = deriveFromSessions(workspaceId, providerSubscriptions);
    return dedupeTokenRecords([...dbRecords, ...fileRecords, ...sessionRecords])
        .sort((a, b) => b.timestamp - a.timestamp);
}
/**
 * Derive token usage records from OpenClaw session stores.
 * Each session has totalTokens, inputTokens, outputTokens, model, etc.
 */
function deriveFromSessions(workspaceId, providerSubscriptions) {
    const sessions = (0, sessions_1.getAllGatewaySessions)(Infinity); // Get ALL sessions regardless of age
    const records = [];
    for (const session of sessions) {
        const inputTokens = session.inputTokens || 0;
        const outputTokens = session.outputTokens || 0;
        const totalTokens = inputTokens + outputTokens;
        if (totalTokens <= 0 && !session.model)
            continue; // Skip empty sessions
        const cost = (0, token_pricing_1.calculateTokenCost)(session.model || '', inputTokens, outputTokens, { providerSubscriptions });
        records.push({
            id: `session-${session.agent}-${session.key}`,
            model: session.model || 'unknown',
            sessionId: `${session.agent}:${session.chatType}`,
            agentName: session.agent || 'unknown',
            timestamp: session.updatedAt,
            inputTokens,
            outputTokens,
            totalTokens,
            cost,
            operation: session.chatType || 'chat',
            taskId: null,
            workspaceId,
        });
    }
    records.sort((a, b) => b.timestamp - a.timestamp);
    return records;
}
async function saveTokenData(data) {
    (0, config_1.ensureDirExists)((0, path_1.dirname)(DATA_PATH));
    await (0, promises_1.writeFile)(DATA_PATH, JSON.stringify(data, null, 2));
}
function calculateStats(records) {
    if (records.length === 0) {
        return {
            totalTokens: 0,
            totalCost: 0,
            requestCount: 0,
            avgTokensPerRequest: 0,
            avgCostPerRequest: 0,
        };
    }
    const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    const requestCount = records.length;
    return {
        totalTokens,
        totalCost,
        requestCount,
        avgTokensPerRequest: Math.round(totalTokens / requestCount),
        avgCostPerRequest: totalCost / requestCount,
    };
}
function filterByTimeframe(records, timeframe) {
    const now = Date.now();
    let cutoffTime;
    switch (timeframe) {
        case 'hour':
            cutoffTime = now - 60 * 60 * 1000;
            break;
        case 'day':
            cutoffTime = now - 24 * 60 * 60 * 1000;
            break;
        case 'week':
            cutoffTime = now - 7 * 24 * 60 * 60 * 1000;
            break;
        case 'month':
            cutoffTime = now - 30 * 24 * 60 * 60 * 1000;
            break;
        case 'all':
        default:
            return records;
    }
    return records.filter(record => record.timestamp >= cutoffTime);
}
function loadTaskMetadataById(workspaceId, taskIds) {
    if (taskIds.length === 0)
        return {};
    const db = (0, db_1.getDatabase)();
    const placeholders = taskIds.map(() => '?').join(', ');
    const rows = db.prepare(`
    SELECT
      t.id,
      t.title,
      t.status,
      t.priority,
      t.assigned_to,
      t.project_id,
      p.name as project_name,
      p.slug as project_slug,
      p.ticket_prefix as project_prefix,
      t.project_ticket_no
    FROM tasks t
    LEFT JOIN projects p
      ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.workspace_id = ?
      AND t.id IN (${placeholders})
  `).all(workspaceId, ...taskIds);
    const out = {};
    for (const row of rows) {
        out[row.id] = row;
    }
    return out;
}
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams } = new URL(request.url);
        const action = (searchParams.get('action') || 'list').trim().toLowerCase();
        const timeframe = searchParams.get('timeframe') || 'all';
        const format = searchParams.get('format') || 'json';
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const tokenData = await loadTokenData(workspaceId);
        const filteredData = filterByTimeframe(tokenData, timeframe);
        if (action === 'list') {
            return server_1.NextResponse.json({
                usage: filteredData.slice(0, 100),
                total: filteredData.length,
                timeframe,
            });
        }
        if (action === 'stats') {
            const overallStats = calculateStats(filteredData);
            const modelGroups = filteredData.reduce((acc, record) => {
                if (!acc[record.model])
                    acc[record.model] = [];
                acc[record.model].push(record);
                return acc;
            }, {});
            const modelStats = {};
            for (const [model, records] of Object.entries(modelGroups)) {
                modelStats[model] = calculateStats(records);
            }
            const sessionGroups = filteredData.reduce((acc, record) => {
                if (!acc[record.sessionId])
                    acc[record.sessionId] = [];
                acc[record.sessionId].push(record);
                return acc;
            }, {});
            const sessionStats = {};
            for (const [sessionId, records] of Object.entries(sessionGroups)) {
                sessionStats[sessionId] = calculateStats(records);
            }
            // Agent aggregation: extract agent name from sessionId (format: "agentName:chatType")
            const agentGroups = filteredData.reduce((acc, record) => {
                const agent = record.agentName || extractAgentName(record.sessionId);
                if (!acc[agent])
                    acc[agent] = [];
                acc[agent].push(record);
                return acc;
            }, {});
            const agentStats = {};
            for (const [agent, records] of Object.entries(agentGroups)) {
                agentStats[agent] = calculateStats(records);
            }
            return server_1.NextResponse.json({
                summary: overallStats,
                models: modelStats,
                sessions: sessionStats,
                agents: agentStats,
                timeframe,
                recordCount: filteredData.length,
            });
        }
        if (action === 'agent-costs') {
            const agentGroups = filteredData.reduce((acc, record) => {
                const agent = record.agentName || extractAgentName(record.sessionId);
                if (!acc[agent])
                    acc[agent] = [];
                acc[agent].push(record);
                return acc;
            }, {});
            const agents = {};
            for (const [agent, records] of Object.entries(agentGroups)) {
                const stats = calculateStats(records);
                // Per-agent model breakdown
                const modelGroups = records.reduce((acc, r) => {
                    if (!acc[r.model])
                        acc[r.model] = [];
                    acc[r.model].push(r);
                    return acc;
                }, {});
                const models = {};
                for (const [model, mrs] of Object.entries(modelGroups)) {
                    models[model] = calculateStats(mrs);
                }
                // Unique sessions
                const sessions = [...new Set(records.map(r => r.sessionId))];
                // Daily timeline
                const dailyMap = records.reduce((acc, r) => {
                    const date = new Date(r.timestamp).toISOString().split('T')[0];
                    if (!acc[date])
                        acc[date] = { cost: 0, tokens: 0 };
                    acc[date].cost += r.cost;
                    acc[date].tokens += r.totalTokens;
                    return acc;
                }, {});
                const timeline = Object.entries(dailyMap)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, data]) => (Object.assign({ date }, data)));
                agents[agent] = { stats, models, sessions, timeline };
            }
            return server_1.NextResponse.json({
                agents,
                timeframe,
                recordCount: filteredData.length,
            });
        }
        if (action === 'task-costs' || action === 'task_costs' || action === 'taskcosts') {
            const attributedTaskIds = [...new Set(filteredData
                    .map((record) => record.taskId)
                    .filter((taskId) => Number.isFinite(taskId) && Number(taskId) > 0)
                    .map((taskId) => Number(taskId)))];
            const taskMetadataById = loadTaskMetadataById(workspaceId, attributedTaskIds);
            const report = (0, task_costs_1.buildTaskCostReport)(filteredData.map((record) => {
                var _a;
                return ({
                    model: record.model,
                    agentName: record.agentName || extractAgentName(record.sessionId),
                    timestamp: record.timestamp,
                    totalTokens: record.totalTokens,
                    cost: record.cost,
                    taskId: (_a = record.taskId) !== null && _a !== void 0 ? _a : null,
                });
            }), taskMetadataById);
            return server_1.NextResponse.json(Object.assign(Object.assign({}, report), { timeframe, recordCount: filteredData.length, attributedRecordCount: filteredData.filter((record) => Number.isFinite(record.taskId)).length }));
        }
        if (action === 'export') {
            const overallStats = calculateStats(filteredData);
            const modelStats = {};
            const sessionStats = {};
            const modelGroups = filteredData.reduce((acc, record) => {
                if (!acc[record.model])
                    acc[record.model] = [];
                acc[record.model].push(record);
                return acc;
            }, {});
            for (const [model, records] of Object.entries(modelGroups)) {
                modelStats[model] = calculateStats(records);
            }
            const sessionGroups = filteredData.reduce((acc, record) => {
                if (!acc[record.sessionId])
                    acc[record.sessionId] = [];
                acc[record.sessionId].push(record);
                return acc;
            }, {});
            for (const [sessionId, records] of Object.entries(sessionGroups)) {
                sessionStats[sessionId] = calculateStats(records);
            }
            const exportData = {
                usage: filteredData,
                summary: overallStats,
                models: modelStats,
                sessions: sessionStats,
            };
            if (format === 'csv') {
                const headers = ['timestamp', 'agentName', 'model', 'sessionId', 'operation', 'inputTokens', 'outputTokens', 'totalTokens', 'cost', 'duration'];
                const csvRows = [headers.join(',')];
                filteredData.forEach(record => {
                    csvRows.push([
                        new Date(record.timestamp).toISOString(),
                        record.agentName,
                        record.model,
                        record.sessionId,
                        record.operation,
                        record.inputTokens,
                        record.outputTokens,
                        record.totalTokens,
                        record.cost.toFixed(4),
                        record.duration || 0,
                    ].join(','));
                });
                return new server_1.NextResponse(csvRows.join('\n'), {
                    headers: {
                        'Content-Type': 'text/csv',
                        'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`,
                    },
                });
            }
            return server_1.NextResponse.json(exportData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.json`,
                },
            });
        }
        if (action === 'trends') {
            const now = Date.now();
            const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
            const recentData = filteredData.filter(r => r.timestamp >= twentyFourHoursAgo);
            const hourlyTrends = {};
            recentData.forEach(record => {
                const hour = new Date(record.timestamp).toISOString().slice(0, 13) + ':00:00.000Z';
                if (!hourlyTrends[hour]) {
                    hourlyTrends[hour] = { tokens: 0, cost: 0, requests: 0 };
                }
                hourlyTrends[hour].tokens += record.totalTokens;
                hourlyTrends[hour].cost += record.cost;
                hourlyTrends[hour].requests += 1;
            });
            const trends = Object.entries(hourlyTrends)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([timestamp, data]) => (Object.assign({ timestamp }, data)));
            return server_1.NextResponse.json({ trends, timeframe });
        }
        return server_1.NextResponse.json({ error: 'Invalid action', action }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Tokens API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const { model, sessionId, inputTokens, outputTokens, operation = 'chat_completion', duration, taskId } = body;
        if (!model || !sessionId || typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
            return server_1.NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const totalTokens = inputTokens + outputTokens;
        const providerSubscriptions = (0, provider_subscriptions_1.getProviderSubscriptionFlags)();
        const cost = (0, token_pricing_1.calculateTokenCost)(model, inputTokens, outputTokens, { providerSubscriptions });
        const parsedTaskId = taskId != null && Number.isFinite(Number(taskId)) && Number(taskId) > 0
            ? Number(taskId)
            : null;
        let validatedTaskId = null;
        if (parsedTaskId) {
            const db = (0, db_1.getDatabase)();
            const taskRow = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(parsedTaskId, workspaceId);
            if (taskRow === null || taskRow === void 0 ? void 0 : taskRow.id)
                validatedTaskId = taskRow.id;
        }
        const record = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            model,
            sessionId,
            agentName: extractAgentName(sessionId),
            timestamp: Date.now(),
            inputTokens,
            outputTokens,
            totalTokens,
            cost,
            operation,
            taskId: validatedTaskId,
            workspaceId,
            duration,
        };
        // Persist only manually posted usage records in the JSON file.
        const existingData = await loadTokenDataFromFile(workspaceId, providerSubscriptions);
        existingData.unshift(record);
        if (existingData.length > 10000) {
            existingData.splice(10000);
        }
        await saveTokenData(existingData);
        return server_1.NextResponse.json({ success: true, record });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Error saving token usage');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
