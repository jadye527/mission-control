"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const ALLOWED_SECTIONS = new Set(['identity', 'audit', 'mutations', 'cost']);
/**
 * GET /api/agents/[id]/attribution - Agent-Level Identity & Attribution
 *
 * Returns a comprehensive audit trail and cost attribution report for
 * a specific agent. Enables per-agent observability, debugging, and
 * cost analysis in multi-agent environments.
 *
 * Query params:
 *   hours   - Time window (default: 24, max: 720)
 *   section - Comma-separated: audit,cost,mutations,identity (default: all)
 *
 * Response:
 *   identity   - Agent profile, status, and session info
 *   audit      - Full audit trail of agent actions
 *   mutations  - Task/memory/soul changes attributed to this agent
 *   cost       - Token usage and cost breakdown per model
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
        // Resolve agent
        let agent;
        if (/^\d+$/.test(agentId)) {
            agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
        }
        else {
            agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
        }
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
        const { searchParams } = new URL(request.url);
        const privileged = searchParams.get('privileged') === '1';
        const isSelfByHeader = auth.user.agent_name === agent.name;
        const isSelfByUsername = auth.user.username === agent.name;
        const isSelf = isSelfByHeader || isSelfByUsername;
        const isPrivileged = auth.user.role === 'admin' && privileged;
        if (!isSelf && !isPrivileged) {
            return server_1.NextResponse.json({ error: 'Forbidden: attribution is self-scope by default. Admin can use ?privileged=1 override.' }, { status: 403 });
        }
        const hoursRaw = searchParams.get('hours');
        const hours = parseHours(hoursRaw);
        if (!hours) {
            return server_1.NextResponse.json({ error: 'Invalid hours. Expected integer 1..720.' }, { status: 400 });
        }
        const sections = parseSections(searchParams.get('section'));
        if ('error' in sections) {
            return server_1.NextResponse.json({ error: sections.error }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        const since = now - hours * 3600;
        const result = {
            agent_name: agent.name,
            timeframe: { hours, since, until: now },
            access_scope: isSelf ? 'self' : 'privileged',
        };
        if (sections.sections.has('identity')) {
            result.identity = buildIdentity(db, agent, workspaceId);
        }
        if (sections.sections.has('audit')) {
            result.audit = buildAuditTrail(db, agent.name, workspaceId, since);
        }
        if (sections.sections.has('mutations')) {
            result.mutations = buildMutations(db, agent.name, workspaceId, since);
        }
        if (sections.sections.has('cost')) {
            result.cost = buildCostAttribution(db, agent.name, workspaceId, since);
        }
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/attribution error');
        return server_1.NextResponse.json({ error: 'Failed to fetch attribution data' }, { status: 500 });
    }
}
/** Agent identity and profile info */
function buildIdentity(db, agent, workspaceId) {
    const config = safeParseJson(agent.config, {});
    // Count total tasks ever assigned
    const taskStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) as active
    FROM tasks WHERE assigned_to = ? AND workspace_id = ?
  `).get(agent.name, workspaceId);
    // Count comments authored
    const commentCount = db.prepare(`SELECT COUNT(*) as c FROM comments WHERE author = ? AND workspace_id = ?`).get(agent.name, workspaceId).c;
    return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        last_seen: agent.last_seen,
        last_activity: agent.last_activity,
        created_at: agent.created_at,
        session_key: agent.session_key ? '***' : null, // Masked for security
        has_soul: !!agent.soul_content,
        config_keys: Object.keys(config),
        lifetime_stats: {
            tasks_total: (taskStats === null || taskStats === void 0 ? void 0 : taskStats.total) || 0,
            tasks_completed: (taskStats === null || taskStats === void 0 ? void 0 : taskStats.completed) || 0,
            tasks_active: (taskStats === null || taskStats === void 0 ? void 0 : taskStats.active) || 0,
            comments_authored: commentCount,
        },
    };
}
/** Audit trail — all activities attributed to this agent */
function buildAuditTrail(db, agentName, workspaceId, since) {
    // Activities where this agent is the actor
    const activities = db.prepare(`
    SELECT id, type, entity_type, entity_id, description, data, created_at
    FROM activities
    WHERE actor = ? AND workspace_id = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(agentName, workspaceId, since);
    // Audit log entries (system-wide, may reference agent)
    let auditEntries = [];
    try {
        auditEntries = db.prepare(`
      SELECT id, action, actor, detail, created_at
      FROM audit_log
      WHERE (actor = ? OR detail LIKE ?) AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(agentName, `%${agentName}%`, since);
    }
    catch (_a) {
        // audit_log table may not exist
    }
    // Group activities by type for summary
    const byType = {};
    for (const a of activities) {
        byType[a.type] = (byType[a.type] || 0) + 1;
    }
    return {
        total_activities: activities.length,
        by_type: byType,
        activities: activities.map(a => (Object.assign(Object.assign({}, a), { data: safeParseJson(a.data, null) }))),
        audit_log_entries: auditEntries.map(e => (Object.assign(Object.assign({}, e), { detail: safeParseJson(e.detail, null) }))),
    };
}
/** Mutations — task changes, comments, status transitions */
function buildMutations(db, agentName, workspaceId, since) {
    // Task mutations (created, updated, status changes)
    const taskMutations = db.prepare(`
    SELECT id, type, entity_type, entity_id, description, data, created_at
    FROM activities
    WHERE actor = ? AND workspace_id = ? AND created_at >= ?
      AND entity_type = 'task'
      AND type IN ('task_created', 'task_updated', 'task_status_change', 'task_assigned')
    ORDER BY created_at DESC
    LIMIT 100
  `).all(agentName, workspaceId, since);
    // Comments authored
    const comments = db.prepare(`
    SELECT c.id, c.task_id, c.content, c.created_at, c.mentions, t.title as task_title
    FROM comments c
    LEFT JOIN tasks t ON c.task_id = t.id AND t.workspace_id = ?
    WHERE c.author = ? AND c.workspace_id = ? AND c.created_at >= ?
    ORDER BY c.created_at DESC
    LIMIT 50
  `).all(workspaceId, agentName, workspaceId, since);
    // Agent status changes (by heartbeat or others)
    const statusChanges = db.prepare(`
    SELECT id, type, description, data, created_at
    FROM activities
    WHERE entity_type = 'agent' AND workspace_id = ?
      AND created_at >= ?
      AND (actor = ? OR description LIKE ?)
    ORDER BY created_at DESC
    LIMIT 50
  `).all(workspaceId, since, agentName, `%${agentName}%`);
    return {
        task_mutations: taskMutations.map(m => (Object.assign(Object.assign({}, m), { data: safeParseJson(m.data, null) }))),
        comments: comments.map(c => {
            var _a;
            return (Object.assign(Object.assign({}, c), { mentions: safeParseJson(c.mentions, []), content_preview: ((_a = c.content) === null || _a === void 0 ? void 0 : _a.substring(0, 200)) || '' }));
        }),
        status_changes: statusChanges.map(s => (Object.assign(Object.assign({}, s), { data: safeParseJson(s.data, null) }))),
        summary: {
            task_mutations_count: taskMutations.length,
            comments_count: comments.length,
            status_changes_count: statusChanges.length,
        },
    };
}
/** Cost attribution — token usage per model */
function buildCostAttribution(db, agentName, workspaceId, since) {
    try {
        const byModel = db.prepare(`
      SELECT model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM token_usage
      WHERE session_id = ? AND workspace_id = ? AND created_at >= ?
      GROUP BY model
      ORDER BY (input_tokens + output_tokens) DESC
    `).all(agentName, workspaceId, since);
        // Also check session IDs that contain the agent name (e.g. "agentname:cli")
        const byModelAlt = db.prepare(`
      SELECT model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM token_usage
      WHERE session_id LIKE ? AND session_id != ? AND workspace_id = ? AND created_at >= ?
      GROUP BY model
      ORDER BY (input_tokens + output_tokens) DESC
    `).all(`${agentName}:%`, agentName, workspaceId, since);
        // Merge results
        const merged = new Map();
        for (const row of [...byModel, ...byModelAlt]) {
            const existing = merged.get(row.model);
            if (existing) {
                existing.request_count += row.request_count;
                existing.input_tokens += row.input_tokens;
                existing.output_tokens += row.output_tokens;
            }
            else {
                merged.set(row.model, Object.assign({}, row));
            }
        }
        const models = Array.from(merged.values());
        const total = models.reduce((acc, r) => ({
            input_tokens: acc.input_tokens + r.input_tokens,
            output_tokens: acc.output_tokens + r.output_tokens,
            requests: acc.requests + r.request_count,
        }), { input_tokens: 0, output_tokens: 0, requests: 0 });
        // Daily breakdown for trend
        const daily = db.prepare(`
      SELECT (created_at / 86400) * 86400 as day_bucket,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        COUNT(*) as requests
      FROM token_usage
      WHERE (session_id = ? OR session_id LIKE ?) AND workspace_id = ? AND created_at >= ?
      GROUP BY day_bucket
      ORDER BY day_bucket ASC
    `).all(agentName, `${agentName}:%`, workspaceId, since);
        return {
            by_model: models,
            total,
            daily_trend: daily.map(d => (Object.assign({ date: new Date(d.day_bucket * 1000).toISOString().split('T')[0] }, d))),
        };
    }
    catch (_a) {
        return { by_model: [], total: { input_tokens: 0, output_tokens: 0, requests: 0 }, daily_trend: [] };
    }
}
function parseHours(hoursRaw) {
    if (!hoursRaw || hoursRaw.trim() === '')
        return 24;
    if (!/^\d+$/.test(hoursRaw))
        return null;
    const hours = Number(hoursRaw);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720)
        return null;
    return hours;
}
function parseSections(sectionRaw) {
    const value = (sectionRaw || 'identity,audit,mutations,cost').trim();
    const parsed = value
        .split(',')
        .map((section) => section.trim())
        .filter(Boolean);
    if (parsed.length === 0) {
        return { error: 'Invalid section. Expected one or more of identity,audit,mutations,cost.' };
    }
    const invalid = parsed.filter((section) => !ALLOWED_SECTIONS.has(section));
    if (invalid.length > 0) {
        return { error: `Invalid section value(s): ${invalid.join(', ')}` };
    }
    return { sections: new Set(parsed) };
}
function safeParseJson(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch (_a) {
        return fallback;
    }
}
