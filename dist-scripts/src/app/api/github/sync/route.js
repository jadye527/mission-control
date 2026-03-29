"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const github_sync_engine_1 = require("@/lib/github-sync-engine");
const github_sync_poller_1 = require("@/lib/github-sync-poller");
/**
 * GET /api/github/sync — sync status for all GitHub-linked projects.
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const syncs = db.prepare(`
      SELECT
        gs.project_id,
        p.name as project_name,
        p.github_repo,
        MAX(gs.last_synced_at) as last_synced_at,
        SUM(gs.changes_pushed) as total_pushed,
        SUM(gs.changes_pulled) as total_pulled,
        COUNT(*) as sync_count
      FROM github_syncs gs
      LEFT JOIN projects p ON p.id = gs.project_id AND p.workspace_id = gs.workspace_id
      WHERE gs.workspace_id = ? AND gs.project_id IS NOT NULL
      GROUP BY gs.project_id
      ORDER BY last_synced_at DESC
    `).all(workspaceId);
        const poller = (0, github_sync_poller_1.getSyncPollerStatus)();
        return server_1.NextResponse.json({ syncs, poller });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/github/sync error');
        return server_1.NextResponse.json({ error: 'Failed to fetch sync status' }, { status: 500 });
    }
}
/**
 * POST /api/github/sync — trigger sync manually.
 * Body: { action: 'trigger', project_id: number } or { action: 'trigger-all' }
 */
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json();
        const { action, project_id } = body;
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        if (action === 'trigger' && typeof project_id === 'number') {
            const project = db.prepare(`
        SELECT id, github_repo, github_sync_enabled, github_default_branch
        FROM projects
        WHERE id = ? AND workspace_id = ? AND status = 'active'
      `).get(project_id, workspaceId);
            if (!project) {
                return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
            }
            if (!project.github_repo || !project.github_sync_enabled) {
                return server_1.NextResponse.json({ error: 'GitHub sync not enabled for this project' }, { status: 400 });
            }
            const result = await (0, github_sync_engine_1.pullFromGitHub)(project, workspaceId);
            return server_1.NextResponse.json(Object.assign({ ok: true }, result));
        }
        if (action === 'trigger-all') {
            const projects = db.prepare(`
        SELECT id, github_repo, github_sync_enabled, github_default_branch
        FROM projects
        WHERE github_sync_enabled = 1 AND github_repo IS NOT NULL AND workspace_id = ? AND status = 'active'
      `).all(workspaceId);
            let totalPulled = 0;
            let totalPushed = 0;
            for (const project of projects) {
                try {
                    const result = await (0, github_sync_engine_1.pullFromGitHub)(project, workspaceId);
                    totalPulled += result.pulled;
                    totalPushed += result.pushed;
                }
                catch (err) {
                    logger_1.logger.error({ err, projectId: project.id }, 'Trigger-all: project sync failed');
                }
            }
            return server_1.NextResponse.json({
                ok: true,
                projects_synced: projects.length,
                pulled: totalPulled,
                pushed: totalPushed,
            });
        }
        return server_1.NextResponse.json({ error: 'Unknown action. Use trigger or trigger-all' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/github/sync error');
        return server_1.NextResponse.json({ error: 'Sync trigger failed' }, { status: 500 });
    }
}
