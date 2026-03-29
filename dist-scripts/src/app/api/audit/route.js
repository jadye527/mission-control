"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
function safeParseJson(str) {
    try {
        return JSON.parse(str);
    }
    catch (_a) {
        return str;
    }
}
/**
 * GET /api/audit - Query audit log (admin only)
 * Query params: action, actor, limit, offset, since, until
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const actor = searchParams.get('actor');
    const limit = Math.min(parseInt(searchParams.get('limit') || '1000'), 10000);
    const offset = parseInt(searchParams.get('offset') || '0');
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const conditions = [];
    const params = [];
    if (action) {
        conditions.push('action = ?');
        params.push(action);
    }
    if (actor) {
        conditions.push('actor = ?');
        params.push(actor);
    }
    if (since) {
        conditions.push('created_at >= ?');
        params.push(parseInt(since));
    }
    if (until) {
        conditions.push('created_at <= ?');
        params.push(parseInt(until));
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const db = (0, db_1.getDatabase)();
    const total = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params).count;
    const rows = db.prepare(`
    SELECT * FROM audit_log ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
    return server_1.NextResponse.json({
        events: rows.map((row) => (Object.assign(Object.assign({}, row), { detail: row.detail ? safeParseJson(row.detail) : null }))),
        total,
        limit,
        offset,
    });
}
