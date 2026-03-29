"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const ALLOWED_SECTIONS = ['summary', 'tasks', 'errors', 'activity', 'trends', 'tokens'];
function parseHoursParam(raw) {
    if (raw === null)
        return { value: 24 };
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
        return { error: 'hours must be an integer between 1 and 720' };
    }
    if (parsed < 1 || parsed > 720) {
        return { error: 'hours must be between 1 and 720' };
    }
    return { value: parsed };
}
function parseSectionsParam(raw) {
    if (!raw || raw.trim().length === 0) {
        return { value: new Set(ALLOWED_SECTIONS) };
    }
    const requested = raw
        .split(',')
        .map((section) => section.trim())
        .filter(Boolean);
    if (requested.length === 0) {
        return { error: 'section must include at least one valid value' };
    }
    const invalid = requested.filter((section) => !ALLOWED_SECTIONS.includes(section));
    if (invalid.length > 0) {
        return { error: `Invalid section value(s): ${invalid.join(', ')}` };
    }
    return { value: new Set(requested) };
}
/**
 * GET /api/agents/[id]/diagnostics - Agent Self-Diagnostics API
 *
 * Provides an agent with its own performance metrics, error analysis,
 * and trend data so it can self-optimize.
 *
 * Query params:
 *   hours   - Time window in hours (default: 24, max: 720 = 30 days)
 *   section - Comma-separated sections to include (default: all)
 *             Options: summary, tasks, errors, activity, trends, tokens
 *
 * Response includes:
 *   summary     - High-level KPIs (throughput, error rate, activity count)
 *   tasks       - Task completion breakdown by status and priority
 *   errors      - Error frequency, types, and recent error details
 *   activity    - Activity breakdown by type with hourly timeline
 *   trends      - Multi-period comparison for trend detection
 *   tokens      - Token usage by model with cost estimates
 */
async function GET(request, { params }) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const agentId = resolvedParams.id;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Resolve agent by ID or name
        let agent;
        if (/^\d+$/.test(agentId)) {
            agent = db.prepare('SELECT id, name, role, status, last_seen, created_at FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        else {
            agent = db.prepare('SELECT id, name, role, status, last_seen, created_at FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        const { searchParams } = new URL(request.url);
        const requesterAgentName = ((_b = auth.user.agent_name) === null || _b === void 0 ? void 0 : _b.trim()) || '';
        const privileged = searchParams.get('privileged') === '1';
        const isSelfRequest = (requesterAgentName || auth.user.username) === agent.name;
        // Self-only by default. Cross-agent access requires explicit privileged override.
        if (!isSelfRequest && !(privileged && auth.user.role === 'admin')) {
            return server_1.NextResponse.json({ error: 'Diagnostics are self-scoped. Use privileged=1 with admin role for cross-agent access.' }, { status: 403 });
        }
        const parsedHours = parseHoursParam(searchParams.get('hours'));
        if (parsedHours.error) {
            return server_1.NextResponse.json({ error: parsedHours.error }, { status: 400 });
        }
        const parsedSections = parseSectionsParam(searchParams.get('section'));
        if (parsedSections.error) {
            return server_1.NextResponse.json({ error: parsedSections.error }, { status: 400 });
        }
        const hours = parsedHours.value;
        const sections = parsedSections.value;
        const now = Math.floor(Date.now() / 1000);
        const since = now - hours * 3600;
        const result = {
            agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status },
            timeframe: { hours, since, until: now },
        };
        if (sections.has('summary')) {
            result.summary = buildSummary(db, agent.name, workspaceId, since);
        }
        if (sections.has('tasks')) {
            result.tasks = buildTaskMetrics(db, agent.name, workspaceId, since);
        }
        if (sections.has('errors')) {
            result.errors = buildErrorAnalysis(db, agent.name, workspaceId, since);
        }
        if (sections.has('activity')) {
            result.activity = buildActivityBreakdown(db, agent.name, workspaceId, since);
        }
        if (sections.has('trends')) {
            result.trends = buildTrends(db, agent.name, workspaceId, hours);
        }
        if (sections.has('tokens')) {
            result.tokens = buildTokenMetrics(db, agent.name, workspaceId, since);
        }
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/diagnostics error');
        return server_1.NextResponse.json({ error: 'Failed to fetch diagnostics' }, { status: 500 });
    }
}
/** High-level KPIs */
function buildSummary(db, agentName, workspaceId, since) {
    const tasksDone = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status = 'done' AND updated_at >= ?`).get(agentName, workspaceId, since).c;
    const tasksTotal = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND workspace_id = ?`).get(agentName, workspaceId).c;
    const activityCount = db.prepare(`SELECT COUNT(*) as c FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ?`).get(agentName, workspaceId, since).c;
    const errorCount = db.prepare(`SELECT COUNT(*) as c FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? AND type LIKE '%error%'`).get(agentName, workspaceId, since).c;
    const errorRate = activityCount > 0 ? Math.round((errorCount / activityCount) * 10000) / 100 : 0;
    return {
        tasks_completed: tasksDone,
        tasks_total: tasksTotal,
        activity_count: activityCount,
        error_count: errorCount,
        error_rate_percent: errorRate,
    };
}
/** Task completion breakdown */
function buildTaskMetrics(db, agentName, workspaceId, since) {
    const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM tasks WHERE assigned_to = ? AND workspace_id = ? GROUP BY status`).all(agentName, workspaceId);
    const byPriority = db.prepare(`SELECT priority, COUNT(*) as count FROM tasks WHERE assigned_to = ? AND workspace_id = ? GROUP BY priority`).all(agentName, workspaceId);
    const recentCompleted = db.prepare(`SELECT id, title, priority, updated_at FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status = 'done' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 10`).all(agentName, workspaceId, since);
    // Estimate throughput: tasks completed per day in the window
    const windowDays = Math.max((Math.floor(Date.now() / 1000) - since) / 86400, 1);
    const completedInWindow = recentCompleted.length;
    const throughputPerDay = Math.round((completedInWindow / windowDays) * 100) / 100;
    return {
        by_status: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
        by_priority: Object.fromEntries(byPriority.map(r => [r.priority, r.count])),
        recent_completed: recentCompleted,
        throughput_per_day: throughputPerDay,
    };
}
/** Error frequency and analysis */
function buildErrorAnalysis(db, agentName, workspaceId, since) {
    const errorActivities = db.prepare(`SELECT type, COUNT(*) as count FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? AND (type LIKE '%error%' OR type LIKE '%fail%') GROUP BY type ORDER BY count DESC`).all(agentName, workspaceId, since);
    const recentErrors = db.prepare(`SELECT id, type, description, data, created_at FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? AND (type LIKE '%error%' OR type LIKE '%fail%') ORDER BY created_at DESC LIMIT 20`).all(agentName, workspaceId, since);
    return {
        by_type: errorActivities,
        total: errorActivities.reduce((sum, e) => sum + e.count, 0),
        recent: recentErrors.map(e => (Object.assign(Object.assign({}, e), { data: e.data ? JSON.parse(e.data) : null }))),
    };
}
/** Activity breakdown with hourly timeline */
function buildActivityBreakdown(db, agentName, workspaceId, since) {
    const byType = db.prepare(`SELECT type, COUNT(*) as count FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? GROUP BY type ORDER BY count DESC`).all(agentName, workspaceId, since);
    const timeline = db.prepare(`SELECT (created_at / 3600) * 3600 as hour_bucket, COUNT(*) as count FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? GROUP BY hour_bucket ORDER BY hour_bucket ASC`).all(agentName, workspaceId, since);
    return {
        by_type: byType,
        timeline: timeline.map(t => ({
            timestamp: t.hour_bucket,
            hour: new Date(t.hour_bucket * 1000).toISOString(),
            count: t.count,
        })),
    };
}
/** Multi-period trend comparison for anomaly/trend detection */
function buildTrends(db, agentName, workspaceId, hours) {
    const now = Math.floor(Date.now() / 1000);
    // Compare current period vs previous period of same length
    const currentSince = now - hours * 3600;
    const previousSince = currentSince - hours * 3600;
    const periodMetrics = (since, until) => {
        const activities = db.prepare(`SELECT COUNT(*) as c FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? AND created_at < ?`).get(agentName, workspaceId, since, until).c;
        const errors = db.prepare(`SELECT COUNT(*) as c FROM activities WHERE actor = ? AND workspace_id = ? AND created_at >= ? AND created_at < ? AND (type LIKE '%error%' OR type LIKE '%fail%')`).get(agentName, workspaceId, since, until).c;
        const tasksCompleted = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status = 'done' AND updated_at >= ? AND updated_at < ?`).get(agentName, workspaceId, since, until).c;
        return { activities, errors, tasks_completed: tasksCompleted };
    };
    const current = periodMetrics(currentSince, now);
    const previous = periodMetrics(previousSince, currentSince);
    const pctChange = (cur, prev) => {
        if (prev === 0)
            return cur > 0 ? 100 : 0;
        return Math.round(((cur - prev) / prev) * 10000) / 100;
    };
    return {
        current_period: Object.assign({ since: currentSince, until: now }, current),
        previous_period: Object.assign({ since: previousSince, until: currentSince }, previous),
        change: {
            activities_pct: pctChange(current.activities, previous.activities),
            errors_pct: pctChange(current.errors, previous.errors),
            tasks_completed_pct: pctChange(current.tasks_completed, previous.tasks_completed),
        },
        alerts: buildTrendAlerts(current, previous),
    };
}
/** Generate automatic alerts from trend data */
function buildTrendAlerts(current, previous) {
    const alerts = [];
    // Error rate spike
    if (current.errors > 0 && previous.errors > 0) {
        const errorIncrease = (current.errors - previous.errors) / previous.errors;
        if (errorIncrease > 0.5) {
            alerts.push({ level: 'warning', message: `Error count increased ${Math.round(errorIncrease * 100)}% vs previous period` });
        }
    }
    else if (current.errors > 3 && previous.errors === 0) {
        alerts.push({ level: 'warning', message: `New error pattern: ${current.errors} errors (none in previous period)` });
    }
    // Throughput drop
    if (previous.tasks_completed > 0 && current.tasks_completed === 0) {
        alerts.push({ level: 'info', message: 'No tasks completed in current period (possible stall)' });
    }
    else if (previous.tasks_completed > 2 && current.tasks_completed < previous.tasks_completed * 0.5) {
        alerts.push({ level: 'info', message: `Task throughput dropped ${Math.round((1 - current.tasks_completed / previous.tasks_completed) * 100)}%` });
    }
    // Activity drop (possible offline)
    if (previous.activities > 5 && current.activities < previous.activities * 0.25) {
        alerts.push({ level: 'warning', message: `Activity dropped ${Math.round((1 - current.activities / previous.activities) * 100)}% — agent may be stalled` });
    }
    return alerts;
}
/** Token usage by model */
function buildTokenMetrics(db, agentName, workspaceId, since) {
    try {
        // session_id on token_usage may store agent name or session key
        const byModel = db.prepare(`SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as request_count FROM token_usage WHERE session_id = ? AND workspace_id = ? AND created_at >= ? GROUP BY model ORDER BY (input_tokens + output_tokens) DESC`).all(agentName, workspaceId, since);
        const total = byModel.reduce((acc, r) => ({
            input_tokens: acc.input_tokens + r.input_tokens,
            output_tokens: acc.output_tokens + r.output_tokens,
            requests: acc.requests + r.request_count,
        }), { input_tokens: 0, output_tokens: 0, requests: 0 });
        return {
            by_model: byModel,
            total,
        };
    }
    catch (_a) {
        // token_usage table may not exist
        return { by_model: [], total: { input_tokens: 0, output_tokens: 0, requests: 0 } };
    }
}
