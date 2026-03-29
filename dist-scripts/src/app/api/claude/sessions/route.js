"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const claude_sessions_1 = require("@/lib/claude-sessions");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/claude/sessions — List discovered local Claude Code sessions
 *
 * Query params:
 *   active=1       — only active sessions
 *   project=slug   — filter by project slug
 *   limit=50       — max results (default 50, max 200)
 *   offset=0       — pagination offset
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const active = searchParams.get('active');
        const project = searchParams.get('project');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
        const offset = parseInt(searchParams.get('offset') || '0');
        let query = 'SELECT * FROM claude_sessions WHERE 1=1';
        const params = [];
        if (active === '1') {
            query += ' AND is_active = 1';
        }
        if (project) {
            query += ' AND project_slug = ?';
            params.push(project);
        }
        query += ' ORDER BY last_message_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const sessions = db.prepare(query).all(...params);
        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM claude_sessions WHERE 1=1';
        const countParams = [];
        if (active === '1') {
            countQuery += ' AND is_active = 1';
        }
        if (project) {
            countQuery += ' AND project_slug = ?';
            countParams.push(project);
        }
        const { total } = db.prepare(countQuery).get(...countParams);
        // Aggregate stats
        const stats = db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_sessions,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(estimated_cost) as total_estimated_cost,
        COUNT(DISTINCT project_slug) as unique_projects
      FROM claude_sessions
    `).get();
        return server_1.NextResponse.json({
            sessions,
            total,
            stats: {
                total_sessions: stats.total_sessions || 0,
                active_sessions: stats.active_sessions || 0,
                total_input_tokens: stats.total_input_tokens || 0,
                total_output_tokens: stats.total_output_tokens || 0,
                total_estimated_cost: Math.round((stats.total_estimated_cost || 0) * 100) / 100,
                unique_projects: stats.unique_projects || 0,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/claude/sessions error');
        return server_1.NextResponse.json({ error: 'Failed to fetch Claude sessions' }, { status: 500 });
    }
}
/**
 * POST /api/claude/sessions — Trigger a manual scan of local Claude sessions
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const result = await (0, claude_sessions_1.syncClaudeSessions)();
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/claude/sessions error');
        return server_1.NextResponse.json({ error: 'Failed to scan Claude sessions' }, { status: 500 });
    }
}
