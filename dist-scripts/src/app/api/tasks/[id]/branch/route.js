"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const event_bus_1 = require("@/lib/event-bus");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const github_1 = require("@/lib/github");
function slugify(title, maxLen) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, maxLen)
        .replace(/-$/, '');
}
/**
 * GET /api/tasks/[id]/branch - Get branch and PR status for a task
 */
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const taskId = parseInt(resolvedParams.id);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        if (isNaN(taskId)) {
            return server_1.NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
        }
        const task = db.prepare(`
      SELECT t.*, p.github_repo, p.github_default_branch, p.ticket_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        const result = {
            branch: task.github_branch || null,
            pr_number: task.github_pr_number || null,
            pr_state: task.github_pr_state || null,
            repo: task.github_repo || null,
        };
        // If task has a branch but no PR info, check GitHub (fire-and-forget)
        if (task.github_branch && !task.github_pr_number && task.github_repo) {
            const repo = task.github_repo;
            const branch = task.github_branch;
            (0, github_1.fetchPullRequests)(repo, { head: branch, state: 'all' })
                .then((prs) => {
                if (prs.length > 0) {
                    const pr = prs[0];
                    db.prepare(`
              UPDATE tasks SET github_pr_number = ?, github_pr_state = ?, updated_at = ?
              WHERE id = ? AND workspace_id = ?
            `).run(pr.number, pr.state, Math.floor(Date.now() / 1000), taskId, workspaceId);
                }
            })
                .catch((err) => {
                logger_1.logger.warn({ err }, 'Failed to check PRs for task branch');
            });
        }
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/tasks/[id]/branch error');
        return server_1.NextResponse.json({ error: 'Failed to fetch branch info' }, { status: 500 });
    }
}
/**
 * POST /api/tasks/[id]/branch - Create a branch or PR for a task
 *
 * Body: {} to create a branch
 * Body: { action: 'create-pr', base?, title?, body? } to create a PR
 */
async function POST(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const db = (0, db_1.getDatabase)();
        const resolvedParams = await params;
        const taskId = parseInt(resolvedParams.id);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        if (isNaN(taskId)) {
            return server_1.NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
        }
        const task = db.prepare(`
      SELECT t.*, p.github_repo, p.github_default_branch, p.ticket_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        if (!task.github_repo) {
            return server_1.NextResponse.json({ error: 'Task project does not have a GitHub repo configured' }, { status: 400 });
        }
        const repo = task.github_repo;
        const defaultBranch = task.github_default_branch || 'main';
        let body = {};
        try {
            body = await request.json();
        }
        catch (_b) {
            // empty body is fine for branch creation
        }
        // --- Create PR ---
        if (body.action === 'create-pr') {
            if (!task.github_branch) {
                return server_1.NextResponse.json({ error: 'Task does not have a branch yet. Create a branch first.' }, { status: 400 });
            }
            const prTitle = body.title || `${task.ticket_prefix ? task.ticket_prefix + ': ' : ''}${task.title}`;
            const prBody = body.body || `Resolves task #${taskId}`;
            const prBase = body.base || defaultBranch;
            const pr = await (0, github_1.createPullRequest)(repo, {
                title: prTitle,
                head: task.github_branch,
                base: prBase,
                body: prBody,
            });
            const now = Math.floor(Date.now() / 1000);
            db.prepare(`
        UPDATE tasks SET github_pr_number = ?, github_pr_state = 'open', updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(pr.number, now, taskId, workspaceId);
            db_1.db_helpers.logActivity('task_updated', 'task', taskId, auth.user.username, `Created PR #${pr.number} for task`, { pr_number: pr.number, pr_url: pr.html_url }, workspaceId);
            event_bus_1.eventBus.broadcast('task.updated', {
                id: taskId,
                github_pr_number: pr.number,
                github_pr_state: 'open',
            });
            return server_1.NextResponse.json({
                pr_number: pr.number,
                pr_url: pr.html_url,
                branch: task.github_branch,
            });
        }
        // --- Create Branch ---
        // Idempotent: if branch already exists, return it
        if (task.github_branch) {
            return server_1.NextResponse.json({
                branch: task.github_branch,
                url: `https://github.com/${repo}/tree/${task.github_branch}`,
            });
        }
        // Build branch name: feat/{prefix}-{issue_or_id}-{slug}
        const prefix = task.ticket_prefix
            ? task.ticket_prefix.toLowerCase()
            : 'task';
        const identifier = task.github_issue_number || taskId;
        const basePrefix = `feat/${prefix}-${identifier}-`;
        const maxSlugLen = 60 - basePrefix.length;
        const slug = slugify(task.title || 'untitled', Math.max(maxSlugLen, 1));
        const branchName = `${basePrefix}${slug}`.slice(0, 60);
        // Get base branch SHA
        const { sha } = await (0, github_1.getRef)(repo, `heads/${defaultBranch}`);
        // Create the branch
        await (0, github_1.createRef)(repo, `refs/heads/${branchName}`, sha);
        const now = Math.floor(Date.now() / 1000);
        db.prepare(`
      UPDATE tasks SET github_branch = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run(branchName, now, taskId, workspaceId);
        db_1.db_helpers.logActivity('task_updated', 'task', taskId, auth.user.username, `Created branch ${branchName} for task`, { branch: branchName, repo }, workspaceId);
        event_bus_1.eventBus.broadcast('task.updated', {
            id: taskId,
            github_branch: branchName,
        });
        return server_1.NextResponse.json({
            branch: branchName,
            url: `https://github.com/${repo}/tree/${branchName}`,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/tasks/[id]/branch error');
        const message = error instanceof Error ? error.message : 'Failed to create branch';
        return server_1.NextResponse.json({ error: message }, { status: 500 });
    }
}
