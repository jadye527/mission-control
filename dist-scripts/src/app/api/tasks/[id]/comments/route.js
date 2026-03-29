"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const mentions_1 = require("@/lib/mentions");
/**
 * GET /api/tasks/[id]/comments - Get all comments for a task
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
        // Verify task exists
        const task = db
            .prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        // Get comments ordered by creation time
        const stmt = db.prepare(`
      SELECT * FROM comments 
      WHERE task_id = ? AND workspace_id = ?
      ORDER BY created_at ASC
    `);
        const comments = stmt.all(taskId, workspaceId);
        // Parse JSON fields and build thread structure
        const commentsWithParsedData = comments.map(comment => (Object.assign(Object.assign({}, comment), { mentions: comment.mentions ? JSON.parse(comment.mentions) : [] })));
        // Organize into thread structure (parent comments with replies)
        const commentMap = new Map();
        const topLevelComments = [];
        // First pass: create all comment objects
        commentsWithParsedData.forEach(comment => {
            commentMap.set(comment.id, Object.assign(Object.assign({}, comment), { replies: [] }));
        });
        // Second pass: organize into threads
        commentsWithParsedData.forEach(comment => {
            const commentWithReplies = commentMap.get(comment.id);
            if (comment.parent_id) {
                // This is a reply, add to parent's replies
                const parent = commentMap.get(comment.parent_id);
                if (parent) {
                    parent.replies.push(commentWithReplies);
                }
            }
            else {
                // This is a top-level comment
                topLevelComments.push(commentWithReplies);
            }
        });
        return server_1.NextResponse.json({
            comments: topLevelComments,
            total: comments.length
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/tasks/[id]/comments error');
        return server_1.NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
    }
}
/**
 * POST /api/tasks/[id]/comments - Add a new comment to a task
 */
async function POST(request, { params }) {
    var _a, _b, _c, _d;
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
        const result = await (0, validation_1.validateBody)(request, validation_1.createCommentSchema);
        if ('error' in result)
            return result.error;
        const { content: rawContent, parent_id } = result.data;
        const author = auth.user.display_name || auth.user.username || 'system';
        // Normalize agent payload JSON — extract text from OpenClaw result format
        let content = rawContent;
        try {
            const stripped = rawContent.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[3[0-9]m/g, '').replace(/\[39m/g, '');
            const parsed = JSON.parse(stripped);
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.payloads)) {
                const text = parsed.payloads
                    .map((p) => (typeof p === 'string' ? p : (p === null || p === void 0 ? void 0 : p.text) || '').trim())
                    .filter(Boolean)
                    .join('\n');
                if (text) {
                    const meta = (_b = parsed.meta) === null || _b === void 0 ? void 0 : _b.agentMeta;
                    const metaLine = meta
                        ? `\n\n_${[meta.model, ((_c = meta.usage) === null || _c === void 0 ? void 0 : _c.total) ? `${meta.usage.total} tokens` : '', ((_d = parsed.meta) === null || _d === void 0 ? void 0 : _d.durationMs) ? `${(parsed.meta.durationMs / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ')}_`
                        : '';
                    content = text + metaLine;
                }
            }
        }
        catch (_e) {
            // Not JSON — keep original content
        }
        // Verify task exists
        const task = db
            .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(taskId, workspaceId);
        if (!task) {
            return server_1.NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        // Verify parent comment exists if specified
        if (parent_id) {
            const parentComment = db
                .prepare('SELECT id FROM comments WHERE id = ? AND task_id = ? AND workspace_id = ?')
                .get(parent_id, taskId, workspaceId);
            if (!parentComment) {
                return server_1.NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
            }
        }
        const mentionResolution = (0, mentions_1.resolveMentionRecipients)(content, db, workspaceId);
        if (mentionResolution.unresolved.length > 0) {
            return server_1.NextResponse.json({
                error: `Unknown mentions: ${mentionResolution.unresolved.map((m) => `@${m}`).join(', ')}`,
                missing_mentions: mentionResolution.unresolved
            }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        // Insert comment
        const stmt = db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const insertResult = stmt.run(taskId, author, content, now, parent_id || null, mentionResolution.tokens.length > 0 ? JSON.stringify(mentionResolution.tokens) : null, workspaceId);
        const commentId = insertResult.lastInsertRowid;
        // Log activity
        const activityDescription = parent_id
            ? `Replied to comment on task: ${task.title}`
            : `Added comment to task: ${task.title}`;
        db_1.db_helpers.logActivity('comment_added', 'comment', commentId, author, activityDescription, {
            task_id: taskId,
            task_title: task.title,
            parent_id,
            mentions: mentionResolution.tokens,
            content_preview: content.substring(0, 100)
        }, workspaceId);
        // Ensure subscriptions for author, mentions, and assignee
        db_1.db_helpers.ensureTaskSubscription(taskId, author, workspaceId);
        const mentionRecipients = mentionResolution.recipients;
        mentionRecipients.forEach((mentionedRecipient) => {
            db_1.db_helpers.ensureTaskSubscription(taskId, mentionedRecipient, workspaceId);
        });
        if (task.assigned_to) {
            db_1.db_helpers.ensureTaskSubscription(taskId, task.assigned_to, workspaceId);
        }
        // Notify subscribers
        const subscribers = new Set(db_1.db_helpers.getTaskSubscribers(taskId, workspaceId));
        subscribers.delete(author);
        const mentionSet = new Set(mentionRecipients);
        for (const subscriber of subscribers) {
            const isMention = mentionSet.has(subscriber);
            db_1.db_helpers.createNotification(subscriber, isMention ? 'mention' : 'comment', isMention ? 'You were mentioned' : 'New comment on a subscribed task', isMention
                ? `${author} mentioned you in a comment on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`
                : `${author} commented on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`, 'comment', commentId, workspaceId);
        }
        // Fetch the created comment
        const createdComment = db
            .prepare('SELECT * FROM comments WHERE id = ? AND workspace_id = ?')
            .get(commentId, workspaceId);
        return server_1.NextResponse.json({
            comment: Object.assign(Object.assign({}, createdComment), { mentions: createdComment.mentions ? JSON.parse(createdComment.mentions) : [], replies: [] // New comments have no replies initially
             })
        }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/tasks/[id]/comments error');
        return server_1.NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
    }
}
