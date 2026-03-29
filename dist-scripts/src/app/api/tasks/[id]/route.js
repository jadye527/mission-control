"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const event_bus_1 = require("@/lib/event-bus");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const validation_1 = require("@/lib/validation");
const mentions_1 = require("@/lib/mentions");
const task_status_1 = require("@/lib/task-status");
const github_sync_engine_1 = require("@/lib/github-sync-engine");
const gnap_sync_1 = require("@/lib/gnap-sync");
const config_1 = require("@/lib/config");
function formatTicketRef(prefix, num) {
    if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0)
        return undefined;
    return `${prefix}-${String(num).padStart(3, '0')}`;
}
function mapTaskRow(task) {
    return Object.assign(Object.assign({}, task), { tags: task.tags ? JSON.parse(task.tags) : [], metadata: task.metadata ? JSON.parse(task.metadata) : {}, ticket_ref: formatTicketRef(task.project_prefix, task.project_ticket_no) });
}
function hasAegisApproval(db, taskId, workspaceId) {
    const review = db.prepare(`
    SELECT status FROM quality_reviews
    WHERE task_id = ? AND reviewer = 'aegis' AND workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId, workspaceId);
    return (review === null || review === void 0 ? void 0 : review.status) === 'approved';
}
/**
 * GET /api/tasks/[id] - Get a specific task
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
        const stmt = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `);
        const task = stmt.get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        // Parse JSON fields
        const taskWithParsedData = mapTaskRow(task);
        return server_1.NextResponse.json({ task: taskWithParsedData });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/tasks/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
    }
}
/**
 * PUT /api/tasks/[id] - Update a specific task
 */
async function PUT(request, { params }) {
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
        const validated = await (0, validation_1.validateBody)(request, validation_1.updateTaskSchema);
        if ('error' in validated)
            return validated.error;
        const body = validated.data;
        if (isNaN(taskId)) {
            return server_1.NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
        }
        // Get current task for comparison
        const currentTask = db
            .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(taskId, workspaceId);
        if (!currentTask) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        const { title, description, status: requestedStatus, priority, project_id, assigned_to, due_date, estimated_hours, actual_hours, outcome, error_message, resolution, feedback_rating, feedback_notes, retry_count, completed_at, tags, metadata } = body;
        const normalizedStatus = (0, task_status_1.normalizeTaskUpdateStatus)({
            currentStatus: currentTask.status,
            requestedStatus,
            assignedTo: assigned_to,
            assignedToProvided: assigned_to !== undefined,
        });
        const now = Math.floor(Date.now() / 1000);
        const descriptionMentionResolution = description !== undefined
            ? (0, mentions_1.resolveMentionRecipients)(description || '', db, workspaceId)
            : null;
        if (descriptionMentionResolution && descriptionMentionResolution.unresolved.length > 0) {
            return server_1.NextResponse.json({
                error: `Unknown mentions: ${descriptionMentionResolution.unresolved.map((m) => `@${m}`).join(', ')}`,
                missing_mentions: descriptionMentionResolution.unresolved
            }, { status: 400 });
        }
        const previousDescriptionMentionRecipients = (0, mentions_1.resolveMentionRecipients)(currentTask.description || '', db, workspaceId).recipients;
        // Build dynamic update query
        const fieldsToUpdate = [];
        const updateParams = [];
        let nextProjectTicketNo = null;
        if (title !== undefined) {
            fieldsToUpdate.push('title = ?');
            updateParams.push(title);
        }
        if (description !== undefined) {
            fieldsToUpdate.push('description = ?');
            updateParams.push(description);
        }
        if (normalizedStatus !== undefined) {
            if (normalizedStatus === 'done' && !hasAegisApproval(db, taskId, workspaceId)) {
                return server_1.NextResponse.json({ error: 'Aegis approval is required to move task to done.' }, { status: 403 });
            }
            fieldsToUpdate.push('status = ?');
            updateParams.push(normalizedStatus);
        }
        if (priority !== undefined) {
            fieldsToUpdate.push('priority = ?');
            updateParams.push(priority);
        }
        if (project_id !== undefined) {
            const project = db.prepare(`
        SELECT id FROM projects
        WHERE id = ? AND workspace_id = ? AND status = 'active'
      `).get(project_id, workspaceId);
            if (!project) {
                return server_1.NextResponse.json({ error: 'Project not found or archived' }, { status: 400 });
            }
            if (project_id !== currentTask.project_id) {
                db.prepare(`
          UPDATE projects
          SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ?
        `).run(project_id, workspaceId);
                const row = db.prepare(`
          SELECT ticket_counter FROM projects
          WHERE id = ? AND workspace_id = ?
        `).get(project_id, workspaceId);
                if (!row || !row.ticket_counter) {
                    return server_1.NextResponse.json({ error: 'Failed to allocate project ticket number' }, { status: 500 });
                }
                nextProjectTicketNo = row.ticket_counter;
            }
            fieldsToUpdate.push('project_id = ?');
            updateParams.push(project_id);
            if (nextProjectTicketNo !== null) {
                fieldsToUpdate.push('project_ticket_no = ?');
                updateParams.push(nextProjectTicketNo);
            }
        }
        if (assigned_to !== undefined) {
            fieldsToUpdate.push('assigned_to = ?');
            updateParams.push(assigned_to);
        }
        if (due_date !== undefined) {
            fieldsToUpdate.push('due_date = ?');
            updateParams.push(due_date);
        }
        if (estimated_hours !== undefined) {
            fieldsToUpdate.push('estimated_hours = ?');
            updateParams.push(estimated_hours);
        }
        if (actual_hours !== undefined) {
            fieldsToUpdate.push('actual_hours = ?');
            updateParams.push(actual_hours);
        }
        if (outcome !== undefined) {
            fieldsToUpdate.push('outcome = ?');
            updateParams.push(outcome);
        }
        if (error_message !== undefined) {
            fieldsToUpdate.push('error_message = ?');
            updateParams.push(error_message);
        }
        if (resolution !== undefined) {
            fieldsToUpdate.push('resolution = ?');
            updateParams.push(resolution);
        }
        if (feedback_rating !== undefined) {
            fieldsToUpdate.push('feedback_rating = ?');
            updateParams.push(feedback_rating);
        }
        if (feedback_notes !== undefined) {
            fieldsToUpdate.push('feedback_notes = ?');
            updateParams.push(feedback_notes);
        }
        if (retry_count !== undefined) {
            fieldsToUpdate.push('retry_count = ?');
            updateParams.push(retry_count);
        }
        if (completed_at !== undefined) {
            fieldsToUpdate.push('completed_at = ?');
            updateParams.push(completed_at);
        }
        else if (normalizedStatus === 'done' && !currentTask.completed_at) {
            fieldsToUpdate.push('completed_at = ?');
            updateParams.push(now);
        }
        if (tags !== undefined) {
            fieldsToUpdate.push('tags = ?');
            updateParams.push(JSON.stringify(tags));
        }
        if (metadata !== undefined) {
            fieldsToUpdate.push('metadata = ?');
            updateParams.push(JSON.stringify(metadata));
        }
        fieldsToUpdate.push('updated_at = ?');
        updateParams.push(now);
        updateParams.push(taskId, workspaceId);
        if (fieldsToUpdate.length === 1) { // Only updated_at
            return server_1.NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }
        const stmt = db.prepare(`
      UPDATE tasks 
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = ? AND workspace_id = ?
    `);
        stmt.run(...updateParams);
        // Track changes and log activities
        const changes = [];
        if (normalizedStatus !== undefined && normalizedStatus !== currentTask.status) {
            changes.push(`status: ${currentTask.status} → ${normalizedStatus}`);
            // Create notification for status change if assigned
            if (currentTask.assigned_to) {
                db_1.db_helpers.createNotification(currentTask.assigned_to, 'status_change', 'Task Status Updated', `Task "${currentTask.title}" status changed to ${normalizedStatus}`, 'task', taskId, workspaceId);
            }
        }
        if (assigned_to !== undefined && assigned_to !== currentTask.assigned_to) {
            changes.push(`assigned: ${currentTask.assigned_to || 'unassigned'} → ${assigned_to || 'unassigned'}`);
            // Create notification for new assignee
            if (assigned_to) {
                db_1.db_helpers.ensureTaskSubscription(taskId, assigned_to, workspaceId);
                db_1.db_helpers.createNotification(assigned_to, 'assignment', 'Task Assigned', `You have been assigned to task: ${currentTask.title}`, 'task', taskId, workspaceId);
            }
        }
        if (title && title !== currentTask.title) {
            changes.push('title updated');
        }
        if (priority && priority !== currentTask.priority) {
            changes.push(`priority: ${currentTask.priority} → ${priority}`);
        }
        if (project_id !== undefined && project_id !== currentTask.project_id) {
            changes.push(`project: ${currentTask.project_id || 'none'} → ${project_id}`);
        }
        if (outcome !== undefined && outcome !== currentTask.outcome) {
            changes.push(`outcome: ${currentTask.outcome || 'unset'} → ${outcome || 'unset'}`);
        }
        if (descriptionMentionResolution) {
            const newMentionRecipients = new Set(descriptionMentionResolution.recipients);
            const previousRecipients = new Set(previousDescriptionMentionRecipients);
            for (const recipient of newMentionRecipients) {
                if (previousRecipients.has(recipient))
                    continue;
                db_1.db_helpers.ensureTaskSubscription(taskId, recipient, workspaceId);
                if (recipient === auth.user.username)
                    continue;
                db_1.db_helpers.createNotification(recipient, 'mention', 'You were mentioned in a task description', `${auth.user.username} mentioned you in task "${title || currentTask.title}"`, 'task', taskId, workspaceId);
            }
        }
        // Log activity if there were meaningful changes
        if (changes.length > 0) {
            db_1.db_helpers.logActivity('task_updated', 'task', taskId, auth.user.username, `Task updated: ${changes.join(', ')}`, {
                changes: changes,
                oldValues: {
                    title: currentTask.title,
                    status: currentTask.status,
                    priority: currentTask.priority,
                    assigned_to: currentTask.assigned_to
                },
                newValues: { title, status: normalizedStatus !== null && normalizedStatus !== void 0 ? normalizedStatus : currentTask.status, priority, assigned_to }
            }, workspaceId);
        }
        // Fetch updated task
        const updatedTask = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId);
        const parsedTask = mapTaskRow(updatedTask);
        // Fire-and-forget outbound GitHub sync for relevant changes
        const syncRelevantChanges = changes.some(c => c.startsWith('status:') || c.startsWith('priority:') || c.includes('title') || c.includes('assigned'));
        if (syncRelevantChanges && updatedTask.github_repo) {
            const project = db.prepare(`
        SELECT id, github_repo, github_sync_enabled FROM projects
        WHERE id = ? AND workspace_id = ?
      `).get(updatedTask.project_id, workspaceId);
            if (project === null || project === void 0 ? void 0 : project.github_sync_enabled) {
                (0, github_sync_engine_1.pushTaskToGitHub)(updatedTask, project).catch(err => logger_1.logger.error({ err, taskId }, 'Outbound GitHub sync failed'));
            }
        }
        // Fire-and-forget GNAP sync for task updates
        if (config_1.config.gnap.enabled && config_1.config.gnap.autoSync && changes.length > 0) {
            try {
                (0, gnap_sync_1.pushTaskToGnap)(updatedTask, config_1.config.gnap.repoPath);
            }
            catch (err) {
                logger_1.logger.warn({ err, taskId }, 'GNAP sync failed for task update');
            }
        }
        // Broadcast to SSE clients
        event_bus_1.eventBus.broadcast('task.updated', parsedTask);
        return server_1.NextResponse.json({ task: parsedTask });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PUT /api/tasks/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
    }
}
/**
 * DELETE /api/tasks/[id] - Delete a specific task
 */
async function DELETE(request, { params }) {
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
        // Get task before deletion for logging
        const task = db
            .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        // Delete task (cascades will handle comments)
        const stmt = db.prepare('DELETE FROM tasks WHERE id = ? AND workspace_id = ?');
        stmt.run(taskId, workspaceId);
        // Log deletion
        db_1.db_helpers.logActivity('task_deleted', 'task', taskId, auth.user.username, `Deleted task: ${task.title}`, {
            title: task.title,
            status: task.status,
            assigned_to: task.assigned_to
        }, workspaceId);
        // Remove from GNAP repo
        if (config_1.config.gnap.enabled && config_1.config.gnap.autoSync) {
            try {
                (0, gnap_sync_1.removeTaskFromGnap)(taskId, config_1.config.gnap.repoPath);
            }
            catch (err) {
                logger_1.logger.warn({ err, taskId }, 'GNAP sync failed for task deletion');
            }
        }
        // Broadcast to SSE clients
        event_bus_1.eventBus.broadcast('task.deleted', { id: taskId, title: task.title });
        return server_1.NextResponse.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/tasks/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
    }
}
