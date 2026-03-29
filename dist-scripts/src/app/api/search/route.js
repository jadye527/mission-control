"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const rate_limit_1 = require("@/lib/rate-limit");
/**
 * GET /api/search?q=<query>&type=<optional type filter>&limit=<optional>
 * Global search across all MC entities.
 */
async function GET(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.heavyLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const { searchParams } = new URL(request.url);
    const query = (_a = searchParams.get('q')) === null || _a === void 0 ? void 0 : _a.trim();
    const typeFilter = searchParams.get('type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
    if (!query || query.length < 2) {
        return server_1.NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 });
    }
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_b = auth.user.workspace_id) !== null && _b !== void 0 ? _b : 1;
    const likeQ = `%${query}%`;
    const results = [];
    // Search tasks
    if (!typeFilter || typeFilter === 'task') {
        try {
            const tasks = db.prepare(`
        SELECT id, title, description, status, assigned_to, created_at
        FROM tasks WHERE workspace_id = ? AND (title LIKE ? OR description LIKE ? OR assigned_to LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, likeQ, likeQ, likeQ, limit);
            for (const t of tasks) {
                results.push({
                    type: 'task',
                    id: t.id,
                    title: t.title,
                    subtitle: `${t.status} ${t.assigned_to ? `· ${t.assigned_to}` : ''}`,
                    excerpt: truncateMatch(t.description, query),
                    created_at: t.created_at,
                    relevance: t.title.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
                });
            }
        }
        catch ( /* table might not exist */_c) { /* table might not exist */ }
    }
    // Search agents
    if (!typeFilter || typeFilter === 'agent') {
        try {
            const agents = db.prepare(`
        SELECT id, name, role, status, last_activity, created_at
        FROM agents WHERE workspace_id = ? AND (name LIKE ? OR role LIKE ? OR last_activity LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, likeQ, likeQ, likeQ, limit);
            for (const a of agents) {
                results.push({
                    type: 'agent',
                    id: a.id,
                    title: a.name,
                    subtitle: `${a.role} · ${a.status}`,
                    excerpt: a.last_activity,
                    created_at: a.created_at,
                    relevance: a.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
                });
            }
        }
        catch ( /* table might not exist */_d) { /* table might not exist */ }
    }
    // Search activities
    if (!typeFilter || typeFilter === 'activity') {
        try {
            const activities = db.prepare(`
        SELECT id, type, actor, description, created_at
        FROM activities WHERE workspace_id = ? AND (description LIKE ? OR actor LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, likeQ, likeQ, limit);
            for (const a of activities) {
                results.push({
                    type: 'activity',
                    id: a.id,
                    title: a.description,
                    subtitle: `by ${a.actor}`,
                    created_at: a.created_at,
                    relevance: 1,
                });
            }
        }
        catch ( /* table might not exist */_e) { /* table might not exist */ }
    }
    // Search audit log (admin-only — audit_log is instance-global)
    if ((!typeFilter || typeFilter === 'audit') && auth.user.role === 'admin') {
        try {
            const audits = db.prepare(`
        SELECT id, action, actor, detail, created_at
        FROM audit_log WHERE action LIKE ? OR actor LIKE ? OR detail LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(likeQ, likeQ, likeQ, limit);
            for (const a of audits) {
                results.push({
                    type: 'audit',
                    id: a.id,
                    title: a.action,
                    subtitle: `by ${a.actor}`,
                    excerpt: truncateMatch(a.detail, query),
                    created_at: a.created_at,
                    relevance: 1,
                });
            }
        }
        catch ( /* table might not exist */_f) { /* table might not exist */ }
    }
    // Search messages
    if (!typeFilter || typeFilter === 'message') {
        try {
            const messages = db.prepare(`
        SELECT id, from_agent, to_agent, content, conversation_id, created_at
        FROM messages WHERE workspace_id = ? AND (content LIKE ? OR from_agent LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, likeQ, likeQ, limit);
            for (const m of messages) {
                results.push({
                    type: 'message',
                    id: m.id,
                    title: `${m.from_agent} → ${m.to_agent || 'all'}`,
                    subtitle: m.conversation_id,
                    excerpt: truncateMatch(m.content, query),
                    created_at: m.created_at,
                    relevance: 1,
                });
            }
        }
        catch ( /* table might not exist */_g) { /* table might not exist */ }
    }
    // Search webhooks
    if (!typeFilter || typeFilter === 'webhook') {
        try {
            const webhooks = db.prepare(`
        SELECT id, name, url, events, created_at
        FROM webhooks WHERE workspace_id = ? AND (name LIKE ? OR url LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, likeQ, likeQ, limit);
            for (const w of webhooks) {
                results.push({
                    type: 'webhook',
                    id: w.id,
                    title: w.name,
                    subtitle: w.url,
                    created_at: w.created_at,
                    relevance: w.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
                });
            }
        }
        catch ( /* table might not exist */_h) { /* table might not exist */ }
    }
    // Search pipelines
    if (!typeFilter || typeFilter === 'pipeline') {
        try {
            const pipelines = db.prepare(`
        SELECT id, name, description, created_at
        FROM workflow_pipelines WHERE workspace_id = ? AND (name LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, likeQ, likeQ, limit);
            for (const p of pipelines) {
                results.push({
                    type: 'pipeline',
                    id: p.id,
                    title: p.name,
                    excerpt: truncateMatch(p.description, query),
                    created_at: p.created_at,
                    relevance: p.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
                });
            }
        }
        catch ( /* table might not exist */_j) { /* table might not exist */ }
    }
    // Sort by relevance then recency
    results.sort((a, b) => b.relevance - a.relevance || b.created_at - a.created_at);
    return server_1.NextResponse.json({
        query,
        count: results.length,
        results: results.slice(0, limit),
    });
}
function truncateMatch(text, query, maxLen = 120) {
    if (!text)
        return undefined;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1)
        return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 80);
    const excerpt = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
    return excerpt;
}
