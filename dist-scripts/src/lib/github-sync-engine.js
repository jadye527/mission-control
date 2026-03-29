"use strict";
/**
 * GitHub Sync Engine — bidirectional sync between MC tasks and GitHub issues.
 * Uses proper DB columns (github_repo, github_issue_number, github_synced_at)
 * instead of metadata JSON for matching.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeLabels = initializeLabels;
exports.pushTaskToGitHub = pushTaskToGitHub;
exports.pullFromGitHub = pullFromGitHub;
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const github_1 = require("@/lib/github");
const github_label_map_1 = require("@/lib/github-label-map");
/**
 * Idempotently create all MC labels on a GitHub repo.
 */
async function initializeLabels(repo) {
    await (0, github_1.ensureLabels)(repo, github_label_map_1.ALL_MC_LABELS);
    logger_1.logger.info({ repo }, 'GitHub labels initialized');
}
/**
 * Push a single MC task to GitHub (create or update issue).
 */
async function pushTaskToGitHub(task, project) {
    const repo = task.github_repo || project.github_repo;
    if (!repo)
        return;
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    const statusLabel = (0, github_label_map_1.statusToLabel)(task.status);
    const priorityLabel = (0, github_label_map_1.priorityToLabel)(task.priority);
    const state = task.status === 'done' ? 'closed' : 'open';
    if (task.github_issue_number) {
        // Update existing issue
        let existingIssue;
        try {
            existingIssue = await (0, github_1.fetchIssue)(repo, task.github_issue_number);
        }
        catch (err) {
            logger_1.logger.error({ err, repo, issue: task.github_issue_number }, 'Failed to fetch issue for update');
            return;
        }
        // Keep non-MC labels, replace MC labels with current values
        const nonMcLabels = existingIssue.labels
            .map(l => l.name)
            .filter(name => !github_label_map_1.ALL_STATUS_LABEL_NAMES.includes(name) && !github_label_map_1.ALL_PRIORITY_LABEL_NAMES.includes(name));
        const labels = [...nonMcLabels, statusLabel.name, priorityLabel.name];
        await (0, github_1.updateIssue)(repo, task.github_issue_number, {
            title: task.title,
            body: task.description || '',
            state,
            labels,
        });
        // Mark synced to prevent ping-pong
        db.prepare(`
      UPDATE tasks SET github_synced_at = ? WHERE id = ?
    `).run(now, task.id);
        logger_1.logger.info({ repo, issue: task.github_issue_number }, 'Pushed task update to GitHub');
    }
    else if (project.github_sync_enabled) {
        // Create new issue
        const labels = [statusLabel.name, priorityLabel.name];
        const created = await (0, github_1.createIssue)(repo, {
            title: task.title,
            body: task.description || undefined,
            labels,
        });
        // Store the issue number and repo on the task
        db.prepare(`
      UPDATE tasks
      SET github_issue_number = ?, github_repo = ?, github_synced_at = ?
      WHERE id = ?
    `).run(created.number, repo, now, task.id);
        logger_1.logger.info({ repo, issue: created.number, taskId: task.id }, 'Created GitHub issue for task');
    }
}
/**
 * Pull issues from GitHub and sync into MC tasks for a project.
 */
async function pullFromGitHub(project, workspaceId) {
    const repo = project.github_repo;
    if (!repo || !project.github_sync_enabled) {
        return { pulled: 0, pushed: 0 };
    }
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    let pulled = 0;
    let pushed = 0;
    // Find last sync time for this project
    const lastSync = db.prepare(`
    SELECT last_synced_at FROM github_syncs
    WHERE project_id = ? AND workspace_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(project.id, workspaceId);
    const sinceDate = lastSync
        ? new Date(lastSync.last_synced_at * 1000).toISOString()
        : undefined;
    // Fetch all issues updated since last sync
    let issues;
    try {
        issues = await (0, github_1.fetchIssues)(repo, {
            state: 'all',
            since: sinceDate,
            per_page: 100,
        });
    }
    catch (err) {
        logger_1.logger.error({ err, repo }, 'Failed to fetch issues from GitHub');
        // Record failed sync
        db.prepare(`
      INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error, project_id, changes_pushed, changes_pulled, workspace_id)
      VALUES (?, ?, 0, 'inbound', 'error', ?, ?, 0, 0, ?)
    `).run(repo, now, err.message, project.id, workspaceId);
        return { pulled: 0, pushed: 0 };
    }
    for (const issue of issues) {
        try {
            // Match to existing task via DB columns
            const existingTask = db.prepare(`
        SELECT * FROM tasks
        WHERE github_repo = ? AND github_issue_number = ? AND workspace_id = ?
      `).get(repo, issue.number, workspaceId);
            const issueUpdatedAt = Math.floor(new Date(issue.updated_at).getTime() / 1000);
            const labelNames = issue.labels.map(l => l.name);
            if (!existingTask) {
                // New issue — create MC task
                const status = issue.state === 'closed' ? 'done' : ((0, github_label_map_1.labelToStatus)(labelNames.find(l => github_label_map_1.ALL_STATUS_LABEL_NAMES.includes(l)) || '') || 'inbox');
                const priority = (0, github_label_map_1.labelToPriority)(labelNames);
                const tags = labelNames.filter(l => !github_label_map_1.ALL_STATUS_LABEL_NAMES.includes(l) && !github_label_map_1.ALL_PRIORITY_LABEL_NAMES.includes(l));
                db.prepare(`
          INSERT INTO tasks (
            title, description, status, priority, created_by,
            created_at, updated_at, tags, metadata,
            github_issue_number, github_repo, github_synced_at,
            project_id, workspace_id
          ) VALUES (?, ?, ?, ?, 'github-sync', ?, ?, ?, '{}', ?, ?, ?, ?, ?)
        `).run(issue.title, issue.body || '', status, priority, now, now, JSON.stringify(tags), issue.number, repo, now, project.id, workspaceId);
                pulled++;
                db_1.db_helpers.logActivity('task_created', 'task', 0, 'github-sync', `Synced from GitHub: ${repo}#${issue.number}`, { github_issue: issue.number, github_repo: repo }, workspaceId);
            }
            else {
                // Existing task — anti-ping-pong: skip if task was just pushed
                if (existingTask.github_synced_at && Math.abs(existingTask.github_synced_at - issueUpdatedAt) < 10) {
                    continue;
                }
                // Only update if GitHub is newer
                if (issueUpdatedAt <= existingTask.updated_at) {
                    continue;
                }
                const status = issue.state === 'closed' ? 'done' : ((0, github_label_map_1.labelToStatus)(labelNames.find(l => github_label_map_1.ALL_STATUS_LABEL_NAMES.includes(l)) || '') || existingTask.status);
                const priority = (0, github_label_map_1.labelToPriority)(labelNames);
                db.prepare(`
          UPDATE tasks
          SET title = ?, description = ?, status = ?, priority = ?,
              github_synced_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `).run(issue.title, issue.body || '', status, priority, now, now, existingTask.id, workspaceId);
                pulled++;
                db_1.db_helpers.logActivity('task_updated', 'task', existingTask.id, 'github-sync', `Updated from GitHub: ${repo}#${issue.number}`, { github_issue: issue.number, github_repo: repo }, workspaceId);
            }
        }
        catch (err) {
            logger_1.logger.error({ err, issue: issue.number, repo }, 'Failed to sync GitHub issue');
        }
    }
    // Record sync
    db.prepare(`
    INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, project_id, changes_pushed, changes_pulled, workspace_id)
    VALUES (?, ?, ?, 'inbound', 'success', ?, ?, ?, ?)
  `).run(repo, now, pulled, project.id, pushed, pulled, workspaceId);
    logger_1.logger.info({ repo, pulled, pushed, projectId: project.id }, 'GitHub sync completed');
    return { pulled, pushed };
}
