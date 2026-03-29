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
const validation_1 = require("@/lib/validation");
const github_1 = require("@/lib/github");
const github_sync_engine_1 = require("@/lib/github-sync-engine");
/**
 * GET /api/github?action=issues&repo=owner/repo&state=open&labels=bug
 * Fetch issues from GitHub for preview before import.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');
        if (action === 'stats') {
            return await handleGitHubStats();
        }
        if (action !== 'issues') {
            return server_1.NextResponse.json({ error: 'Unknown action. Use ?action=issues or ?action=stats' }, { status: 400 });
        }
        const repo = searchParams.get('repo') || process.env.GITHUB_DEFAULT_REPO;
        if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
            return server_1.NextResponse.json({ error: 'repo query parameter required (owner/repo format)' }, { status: 400 });
        }
        const token = await (0, github_1.getGitHubToken)();
        if (!token) {
            return server_1.NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 400 });
        }
        const state = searchParams.get('state') || 'open';
        const labels = searchParams.get('labels') || undefined;
        const issues = await (0, github_1.fetchIssues)(repo, { state, labels, per_page: 50 });
        return server_1.NextResponse.json({ issues, total: issues.length, repo });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/github error');
        return server_1.NextResponse.json({ error: error.message || 'Failed to fetch issues' }, { status: 500 });
    }
}
/**
 * POST /api/github — Action dispatcher for sync, comment, close, status.
 */
async function POST(request) {
    var _a, _b, _c, _d, _e, _f;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const validated = await (0, validation_1.validateBody)(request, validation_1.githubSyncSchema);
    if ('error' in validated)
        return validated.error;
    const body = validated.data;
    const { action } = body;
    try {
        switch (action) {
            case 'sync':
                return await handleSync(body, auth.user.username, (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1);
            case 'comment':
                return await handleComment(body, auth.user.username, (_b = auth.user.workspace_id) !== null && _b !== void 0 ? _b : 1);
            case 'close':
                return await handleClose(body, auth.user.username, (_c = auth.user.workspace_id) !== null && _c !== void 0 ? _c : 1);
            case 'status':
                return handleStatus((_d = auth.user.workspace_id) !== null && _d !== void 0 ? _d : 1);
            case 'init-labels':
                return await handleInitLabels(body, (_e = auth.user.workspace_id) !== null && _e !== void 0 ? _e : 1);
            case 'sync-project':
                return await handleSyncProject(body, auth.user.username, (_f = auth.user.workspace_id) !== null && _f !== void 0 ? _f : 1);
            default:
                return server_1.NextResponse.json({ error: 'Unknown action' }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, `POST /api/github action=${action} error`);
        return server_1.NextResponse.json({ error: error.message || 'GitHub action failed' }, { status: 500 });
    }
}
// ── Sync: import GitHub issues as MC tasks ──────────────────────
async function handleSync(body, actor, workspaceId) {
    const repo = body.repo || process.env.GITHUB_DEFAULT_REPO;
    if (!repo) {
        return server_1.NextResponse.json({ error: 'repo is required' }, { status: 400 });
    }
    const token = await (0, github_1.getGitHubToken)();
    if (!token) {
        return server_1.NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 400 });
    }
    const issues = await (0, github_1.fetchIssues)(repo, {
        state: body.state || 'open',
        labels: body.labels,
        per_page: 100,
    });
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const createdTasks = [];
    for (const issue of issues) {
        try {
            // Check for duplicate: existing task with same github_repo + github_issue_number
            const existing = db.prepare(`
        SELECT id FROM tasks
        WHERE json_extract(metadata, '$.github_repo') = ?
          AND json_extract(metadata, '$.github_issue_number') = ?
          AND workspace_id = ?
      `).get(repo, issue.number, workspaceId);
            if (existing) {
                skipped++;
                continue;
            }
            // Map priority from labels
            const priority = mapPriority(issue.labels.map(l => l.name));
            const tags = issue.labels.map(l => l.name);
            const status = issue.state === 'closed' ? 'done' : 'inbox';
            const metadata = {
                github_repo: repo,
                github_issue_number: issue.number,
                github_issue_url: issue.html_url,
                github_synced_at: new Date().toISOString(),
                github_state: issue.state,
            };
            const stmt = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, assigned_to, created_by,
          created_at, updated_at, tags, metadata, workspace_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const dbResult = stmt.run(issue.title, issue.body || '', status, priority, body.assignAgent || null, actor, now, now, JSON.stringify(tags), JSON.stringify(metadata), workspaceId);
            const taskId = dbResult.lastInsertRowid;
            db_1.db_helpers.logActivity('task_created', 'task', taskId, actor, `Imported from GitHub: ${repo}#${issue.number}`, { github_issue: issue.number, github_repo: repo }, workspaceId);
            const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId);
            const parsedTask = Object.assign(Object.assign({}, createdTask), { tags: JSON.parse(createdTask.tags || '[]'), metadata: JSON.parse(createdTask.metadata || '{}') });
            event_bus_1.eventBus.broadcast('task.created', parsedTask);
            createdTasks.push(parsedTask);
            imported++;
        }
        catch (err) {
            logger_1.logger.error({ err, issue: issue.number }, 'Failed to import GitHub issue');
            errors++;
        }
    }
    // Log sync to github_syncs table
    const syncTableHasWorkspace = db
        .prepare("SELECT 1 as ok FROM pragma_table_info('github_syncs') WHERE name = 'workspace_id'")
        .get();
    if (syncTableHasWorkspace === null || syncTableHasWorkspace === void 0 ? void 0 : syncTableHasWorkspace.ok) {
        db.prepare(`
      INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error, workspace_id)
      VALUES (?, ?, ?, 'inbound', ?, ?, ?)
    `).run(repo, now, imported, errors > 0 ? 'partial' : 'success', errors > 0 ? `${errors} issues failed to import` : null, workspaceId);
    }
    else {
        db.prepare(`
      INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error)
      VALUES (?, ?, ?, 'inbound', ?, ?)
    `).run(repo, now, imported, errors > 0 ? 'partial' : 'success', errors > 0 ? `${errors} issues failed to import` : null);
    }
    event_bus_1.eventBus.broadcast('github.synced', {
        repo,
        imported,
        skipped,
        errors,
        timestamp: now,
    });
    return server_1.NextResponse.json({
        imported,
        skipped,
        errors,
        tasks: createdTasks,
    });
}
// ── Comment: post a comment on a GitHub issue ───────────────────
async function handleComment(body, actor, workspaceId) {
    if (!body.repo || !body.issueNumber || !body.body) {
        return server_1.NextResponse.json({ error: 'repo, issueNumber, and body are required' }, { status: 400 });
    }
    await (0, github_1.createIssueComment)(body.repo, body.issueNumber, body.body);
    db_1.db_helpers.logActivity('github_comment', 'task', 0, actor, `Commented on ${body.repo}#${body.issueNumber}`, { github_repo: body.repo, github_issue: body.issueNumber }, workspaceId);
    return server_1.NextResponse.json({ ok: true });
}
// ── Close: close a GitHub issue ─────────────────────────────────
async function handleClose(body, actor, workspaceId) {
    if (!body.repo || !body.issueNumber) {
        return server_1.NextResponse.json({ error: 'repo and issueNumber are required' }, { status: 400 });
    }
    // Optionally post a closing comment first
    if (body.comment) {
        await (0, github_1.createIssueComment)(body.repo, body.issueNumber, body.comment);
    }
    await (0, github_1.updateIssueState)(body.repo, body.issueNumber, 'closed');
    // Update local task metadata if we have a linked task
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE tasks
    SET metadata = json_set(metadata, '$.github_state', 'closed'),
        updated_at = ?
    WHERE json_extract(metadata, '$.github_repo') = ?
      AND json_extract(metadata, '$.github_issue_number') = ?
      AND workspace_id = ?
  `).run(now, body.repo, body.issueNumber, workspaceId);
    db_1.db_helpers.logActivity('github_close', 'task', 0, actor, `Closed GitHub issue ${body.repo}#${body.issueNumber}`, { github_repo: body.repo, github_issue: body.issueNumber }, workspaceId);
    return server_1.NextResponse.json({ ok: true });
}
// ── Status: return recent sync history ──────────────────────────
function handleStatus(workspaceId) {
    const db = (0, db_1.getDatabase)();
    const tableHasWorkspace = db
        .prepare("SELECT 1 as ok FROM pragma_table_info('github_syncs') WHERE name = 'workspace_id'")
        .get();
    const syncs = db.prepare(`
    SELECT * FROM github_syncs
    ${(tableHasWorkspace === null || tableHasWorkspace === void 0 ? void 0 : tableHasWorkspace.ok) ? 'WHERE workspace_id = ?' : ''}
    ORDER BY created_at DESC
    LIMIT 20
  `).all(...((tableHasWorkspace === null || tableHasWorkspace === void 0 ? void 0 : tableHasWorkspace.ok) ? [workspaceId] : []));
    return server_1.NextResponse.json({ syncs });
}
// ── Stats: GitHub user profile + repo overview ──────────────────
async function handleGitHubStats() {
    const token = await (0, github_1.getGitHubToken)();
    if (!token) {
        return server_1.NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 400 });
    }
    // Fetch user profile
    const userRes = await (0, github_1.githubFetch)('/user');
    if (!userRes.ok) {
        return server_1.NextResponse.json({ error: 'Failed to fetch GitHub user' }, { status: 500 });
    }
    const user = await userRes.json();
    // Fetch repos (up to 100, sorted by recent push)
    const reposRes = await (0, github_1.githubFetch)('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator');
    if (!reposRes.ok) {
        return server_1.NextResponse.json({ error: 'Failed to fetch repos' }, { status: 500 });
    }
    const allRepos = await reposRes.json();
    // Filter: exclude repos that are forks AND where user has never pushed
    // A fork the user actively commits to will have pushed_at > created_at (by more than a few seconds)
    const activeRepos = allRepos.filter(r => {
        if (!r.fork)
            return true;
        // For forks, include only if pushed_at is meaningfully after created_at
        // (GitHub sets pushed_at = parent's pushed_at on fork creation)
        const created = new Date(r.created_at).getTime();
        const pushed = new Date(r.pushed_at).getTime();
        return (pushed - created) > 60000; // pushed > 1min after fork creation
    });
    // Aggregate languages
    const langCounts = {};
    for (const r of activeRepos) {
        if (r.language) {
            langCounts[r.language] = (langCounts[r.language] || 0) + 1;
        }
    }
    const topLanguages = Object.entries(langCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => ({ name, count }));
    // Recent repos (last 10 with actual pushes)
    const recentRepos = activeRepos.slice(0, 10).map(r => ({
        name: r.full_name,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        open_issues: r.open_issues_count,
        pushed_at: r.pushed_at,
        is_fork: r.fork,
        is_private: r.private,
        html_url: r.html_url,
    }));
    return server_1.NextResponse.json({
        user: {
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
            public_repos: user.public_repos,
            followers: user.followers,
            following: user.following,
        },
        repos: {
            total: activeRepos.length,
            public: activeRepos.filter(r => !r.private).length,
            private: activeRepos.filter(r => r.private).length,
            total_stars: activeRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
            total_forks: activeRepos.reduce((sum, r) => sum + (r.forks_count || 0), 0),
            total_open_issues: activeRepos.reduce((sum, r) => sum + (r.open_issues_count || 0), 0),
        },
        topLanguages,
        recentRepos,
    });
}
// ── Init Labels: create MC labels on repo ────────────────────────
async function handleInitLabels(body, workspaceId) {
    const repo = body.repo || process.env.GITHUB_DEFAULT_REPO;
    if (!repo) {
        return server_1.NextResponse.json({ error: 'repo is required' }, { status: 400 });
    }
    await (0, github_sync_engine_1.initializeLabels)(repo);
    // Mark project labels as initialized
    const db = (0, db_1.getDatabase)();
    db.prepare(`
    UPDATE projects
    SET github_labels_initialized = 1, updated_at = unixepoch()
    WHERE github_repo = ? AND workspace_id = ?
  `).run(repo, workspaceId);
    return server_1.NextResponse.json({ ok: true, repo });
}
// ── Sync Project: pull from GitHub for a project ─────────────────
async function handleSyncProject(body, actor, workspaceId) {
    if (typeof body.project_id !== 'number') {
        return server_1.NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }
    const db = (0, db_1.getDatabase)();
    const project = db.prepare(`
    SELECT id, github_repo, github_sync_enabled, github_default_branch
    FROM projects
    WHERE id = ? AND workspace_id = ? AND status = 'active'
  `).get(body.project_id, workspaceId);
    if (!project) {
        return server_1.NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!project.github_repo || !project.github_sync_enabled) {
        return server_1.NextResponse.json({ error: 'GitHub sync not enabled for this project' }, { status: 400 });
    }
    const result = await (0, github_sync_engine_1.pullFromGitHub)(project, workspaceId);
    db_1.db_helpers.logActivity('github_sync', 'project', project.id, actor, `Manual sync: pulled ${result.pulled}, pushed ${result.pushed}`, Object.assign({ repo: project.github_repo }, result), workspaceId);
    return server_1.NextResponse.json(Object.assign({ ok: true }, result));
}
// ── Priority mapping helper ─────────────────────────────────────
function mapPriority(labels) {
    for (const label of labels) {
        const lower = label.toLowerCase();
        if (lower === 'priority:critical' || lower === 'critical')
            return 'critical';
        if (lower === 'priority:high' || lower === 'high')
            return 'high';
        if (lower === 'priority:low' || lower === 'low')
            return 'low';
        if (lower === 'priority:medium')
            return 'medium';
    }
    return 'medium';
}
