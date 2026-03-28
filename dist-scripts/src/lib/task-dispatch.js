import { getDatabase, db_helpers } from './db';
import { runOpenClaw } from './command';
import { callOpenClawGateway } from './openclaw-gateway';
import { eventBus } from './event-bus';
import { logger } from './logger';
import { canDispatch, recordSuccess, recordFailure } from './circuit-breaker';
import { handleDispatchQuotaError, handleCliWatchdogTimeout } from './provider-cooldown';
// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------
/**
 * Classify a task's complexity and return the appropriate model ID to pass
 * to the OpenClaw gateway. Uses keyword signals on title + description.
 *
 * Tiers:
 *   ROUTINE  → cheap model (Haiku)   — file ops, status checks, formatting
 *   MODERATE → mid model  (Sonnet)   — code gen, summaries, analysis, drafts
 *   COMPLEX  → premium model (Opus)  — debugging, architecture, novel problems
 *
 * The caller may override this by setting agent.config.dispatchModel.
 */
function classifyTaskModel(task) {
    var _a, _b, _c;
    // Allow per-agent config override
    if (task.agent_config) {
        try {
            const cfg = JSON.parse(task.agent_config);
            if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel)
                return cfg.dispatchModel;
        }
        catch ( /* ignore */_d) { /* ignore */ }
    }
    const text = `${task.title} ${(_a = task.description) !== null && _a !== void 0 ? _a : ''}`.toLowerCase();
    const priority = (_c = (_b = task.priority) === null || _b === void 0 ? void 0 : _b.toLowerCase()) !== null && _c !== void 0 ? _c : '';
    // Complex signals → Opus
    const complexSignals = [
        'debug', 'diagnos', 'architect', 'design system', 'security audit',
        'root cause', 'investigate', 'incident', 'failure', 'broken', 'not working',
        'refactor', 'migration', 'performance optim', 'why is',
    ];
    if (priority === 'critical' || complexSignals.some(s => text.includes(s))) {
        return '9router/cc/claude-opus-4-6';
    }
    // Routine signals → Haiku
    const routineSignals = [
        'status check', 'health check', 'ping', 'list ', 'fetch ', 'format',
        'rename', 'move file', 'read file', 'update readme', 'bump version',
        'send message', 'post to', 'notify', 'summarize', 'translate',
        'quick ', 'simple ', 'routine ', 'minor ',
    ];
    if (priority === 'low' && routineSignals.some(s => text.includes(s))) {
        return '9router/cc/claude-haiku-4-5-20251001';
    }
    if (routineSignals.some(s => text.includes(s)) && priority !== 'high' && priority !== 'critical') {
        return '9router/cc/claude-haiku-4-5-20251001';
    }
    // Default: let the agent's own configured model handle it (no override)
    return null;
}
/** Extract the gateway agent identifier from the agent's config JSON.
 *  Falls back to agent_name (display name) if openclawId is not set. */
function resolveGatewayAgentId(task) {
    if (task.agent_config) {
        try {
            const cfg = JSON.parse(task.agent_config);
            if (typeof cfg.openclawId === 'string' && cfg.openclawId)
                return cfg.openclawId;
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
    return task.agent_name;
}
function buildTaskPrompt(task, rejectionFeedback) {
    const ticket = task.ticket_prefix && task.project_ticket_no
        ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
        : `TASK-${task.id}`;
    const lines = [
        'You have been assigned a task in Mission Control.',
        '',
        `**[${ticket}] ${task.title}**`,
        `Priority: ${task.priority}`,
    ];
    if (task.tags && task.tags.length > 0) {
        lines.push(`Tags: ${task.tags.join(', ')}`);
    }
    if (task.description) {
        lines.push('', task.description);
    }
    if (rejectionFeedback) {
        lines.push('', '## Previous Review Feedback', rejectionFeedback, '', 'Please address this feedback in your response.');
    }
    lines.push('', 'Complete this task and provide your response. Be concise and actionable.');
    return lines.join('\n');
}
/** Extract first valid JSON object from raw stdout (handles surrounding text/warnings). */
function parseGatewayJson(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed)
        return null;
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < start)
        return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1));
    }
    catch (_a) {
        return null;
    }
}
function parseAgentResponse(stdout) {
    var _a, _b;
    try {
        const parsed = JSON.parse(stdout);
        const sessionId = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.sessionId) === 'string' ? parsed.sessionId
            : typeof (parsed === null || parsed === void 0 ? void 0 : parsed.session_id) === 'string' ? parsed.session_id
                : null;
        // OpenClaw agent --json returns { payloads: [{ text: "..." }] }
        if ((_b = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.payloads) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.text) {
            return { text: parsed.payloads[0].text, sessionId };
        }
        // Fallback: if there's a result or output field
        if (parsed === null || parsed === void 0 ? void 0 : parsed.result)
            return { text: String(parsed.result), sessionId };
        if (parsed === null || parsed === void 0 ? void 0 : parsed.output)
            return { text: String(parsed.output), sessionId };
        // Last resort: stringify the whole response
        return { text: JSON.stringify(parsed, null, 2), sessionId };
    }
    catch (_c) {
        // Not valid JSON — return raw stdout if non-empty
        return { text: stdout.trim() || null, sessionId: null };
    }
}
function resolveGatewayAgentIdForReview(task) {
    if (task.agent_config) {
        try {
            const cfg = JSON.parse(task.agent_config);
            if (typeof cfg.openclawId === 'string' && cfg.openclawId)
                return cfg.openclawId;
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
    return task.assigned_to || 'jarv';
}
function buildReviewPrompt(task) {
    const ticket = task.ticket_prefix && task.project_ticket_no
        ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
        : `TASK-${task.id}`;
    const lines = [
        'You are Aegis, the quality reviewer for Mission Control.',
        'Review the following completed task and its resolution.',
        '',
        `**[${ticket}] ${task.title}**`,
    ];
    if (task.description) {
        lines.push('', '## Task Description', task.description);
    }
    if (task.resolution) {
        lines.push('', '## Agent Resolution', task.resolution.substring(0, 6000));
    }
    lines.push('', '## Instructions', 'Evaluate whether the agent\'s response adequately addresses the task.', 'Respond with EXACTLY one of these two formats:', '', 'If the work is acceptable:', 'VERDICT: APPROVED', 'NOTES: <brief summary of why it passes>', '', 'If the work needs improvement:', 'VERDICT: REJECTED', 'NOTES: <specific issues that need to be fixed>');
    return lines.join('\n');
}
const OWNER_ACTION_KEYWORDS = [
    'owner action', 'you need to', 'manual step', 'browser login',
    'create account', 'purchase', 'sign up', 'login required',
    'action required', 'requires human', 'cannot be automated',
];
/** Check whether a resolution's text indicates human follow-up is needed. */
function resolutionRequiresOwnerAction(resolution) {
    if (!resolution)
        return false;
    const lower = resolution.toLowerCase();
    return OWNER_ACTION_KEYWORDS.some(kw => lower.includes(kw));
}
function parseReviewVerdict(text) {
    var _a;
    const upper = text.toUpperCase();
    const status = upper.includes('VERDICT: APPROVED') ? 'approved' : 'rejected';
    const notesMatch = text.match(/NOTES:\s*(.+)/i);
    const notes = ((_a = notesMatch === null || notesMatch === void 0 ? void 0 : notesMatch[1]) === null || _a === void 0 ? void 0 : _a.trim().substring(0, 2000)) || (status === 'approved' ? 'Quality check passed' : 'Quality check failed');
    return { status, notes };
}
/**
 * Run Aegis quality reviews on tasks in 'review' status.
 * Uses an agent to evaluate the task resolution, then approves or rejects.
 */
export async function runAegisReviews() {
    const db = getDatabase();
    const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.resolution, t.assigned_to, t.workspace_id,
           p.ticket_prefix, t.project_ticket_no, a.config as agent_config
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status = 'review'
    ORDER BY t.updated_at ASC
    LIMIT 3
  `).all();
    if (tasks.length === 0) {
        return { ok: true, message: 'No tasks awaiting review' };
    }
    const results = [];
    for (const task of tasks) {
        // Move to quality_review to prevent re-processing
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
            .run('quality_review', Math.floor(Date.now() / 1000), task.id);
        eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'quality_review',
            previous_status: 'review',
        });
        try {
            const prompt = buildReviewPrompt(task);
            // Resolve the gateway agent ID from config, falling back to assigned_to or default
            const reviewAgent = resolveGatewayAgentIdForReview(task);
            // Use `openclaw agent` directly — more reliable than gateway WebSocket call
            const finalResult = await runOpenClaw(['agent', '--agent', reviewAgent, '--message', prompt, '--timeout', '120'], { timeoutMs: 125000 });
            const agentResponse = {
                text: finalResult.stdout.trim() || null,
                sessionId: null,
            };
            if (!agentResponse.text) {
                throw new Error('Aegis review returned empty response');
            }
            const verdict = parseReviewVerdict(agentResponse.text);
            // Insert quality review record
            db.prepare(`
        INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
        VALUES (?, 'aegis', ?, ?, ?)
      `).run(task.id, verdict.status, verdict.notes, task.workspace_id);
            if (verdict.status === 'approved') {
                const finalStatus = resolutionRequiresOwnerAction(task.resolution) ? 'awaiting_owner' : 'done';
                db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
                    .run(finalStatus, Math.floor(Date.now() / 1000), task.id);
                eventBus.broadcast('task.status_changed', {
                    id: task.id,
                    status: finalStatus,
                    previous_status: 'quality_review',
                });
                if (finalStatus === 'awaiting_owner') {
                    db_helpers.logActivity('task_awaiting_owner', 'task', task.id, 'aegis', `Task "${task.title}" approved but requires owner action`, { notes: verdict.notes }, task.workspace_id);
                    // Notify owner via MC notification
                    db_helpers.createNotification('admin', 'awaiting_owner', 'Owner action needed', `Task "${task.title}" needs your attention: ${verdict.notes || 'approved but requires manual step'}`, 'task', task.id, task.workspace_id);
                }
            }
            else {
                // Rejected: push back to assigned so dispatcher re-sends with feedback
                db.prepare('UPDATE tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
                    .run('assigned', `Aegis rejected: ${verdict.notes}`, Math.floor(Date.now() / 1000), task.id);
                eventBus.broadcast('task.status_changed', {
                    id: task.id,
                    status: 'assigned',
                    previous_status: 'quality_review',
                });
                // Add rejection as a comment so the agent sees it on next dispatch
                db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'aegis', ?, ?, ?)
        `).run(task.id, `Quality Review Rejected:\n${verdict.notes}`, Math.floor(Date.now() / 1000), task.workspace_id);
            }
            db_helpers.logActivity('aegis_review', 'task', task.id, 'aegis', `Aegis ${verdict.status} task "${task.title}": ${verdict.notes.substring(0, 200)}`, { verdict: verdict.status, notes: verdict.notes }, task.workspace_id);
            results.push({ id: task.id, verdict: verdict.status });
            logger.info({ taskId: task.id, verdict: verdict.status }, 'Aegis review completed');
        }
        catch (err) {
            const errorMsg = err.message || 'Unknown error';
            logger.error({ taskId: task.id, err }, 'Aegis review failed');
            // Revert to review so it can be retried
            db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
                .run('review', Math.floor(Date.now() / 1000), task.id);
            eventBus.broadcast('task.status_changed', {
                id: task.id,
                status: 'review',
                previous_status: 'quality_review',
            });
            results.push({ id: task.id, verdict: 'error', error: errorMsg.substring(0, 100) });
        }
    }
    const approved = results.filter(r => r.verdict === 'approved').length;
    const rejected = results.filter(r => r.verdict === 'rejected').length;
    const errors = results.filter(r => r.verdict === 'error').length;
    return {
        ok: errors === 0,
        message: `Reviewed ${tasks.length}: ${approved} approved, ${rejected} rejected${errors ? `, ${errors} error(s)` : ''}`,
    };
}
export async function dispatchAssignedTasks() {
    var _a, _b, _c, _d, _e;
    const db = getDatabase();
    const tasks = db.prepare(`
    SELECT t.*, a.name as agent_name, a.id as agent_id, a.config as agent_config,
           p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status = 'assigned'
      AND t.assigned_to IS NOT NULL
      AND t.id NOT IN (
        SELECT td.task_id FROM task_dependencies td
        JOIN tasks bt ON bt.id = td.depends_on_task_id
        WHERE bt.status != 'done'
      )
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      t.created_at ASC
    LIMIT 3
  `).all();
    if (tasks.length === 0) {
        return { ok: true, message: 'No assigned tasks to dispatch' };
    }
    // Parse JSON tags column
    for (const task of tasks) {
        if (typeof task.tags === 'string') {
            try {
                task.tags = JSON.parse(task.tags);
            }
            catch (_f) {
                task.tags = undefined;
            }
        }
    }
    const results = [];
    const now = Math.floor(Date.now() / 1000);
    for (const task of tasks) {
        // Circuit breaker check — skip if task has too many failures
        const cbCheck = canDispatch(task.id);
        if (!cbCheck.allowed) {
            logger.info({ taskId: task.id, reason: cbCheck.reason }, 'Circuit breaker: skipping dispatch');
            results.push({ id: task.id, success: false, error: cbCheck.reason });
            continue;
        }
        // Mark as in_progress immediately to prevent re-dispatch
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
            .run('in_progress', now, task.id);
        eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'in_progress',
            previous_status: 'assigned',
        });
        db_helpers.logActivity('task_dispatched', 'task', task.id, 'scheduler', `Dispatching task "${task.title}" to agent ${task.agent_name}`, { agent: task.agent_name, priority: task.priority }, task.workspace_id);
        try {
            // Check for previous Aegis rejection feedback
            const rejectionRow = db.prepare(`
        SELECT content FROM comments
        WHERE task_id = ? AND author = 'aegis' AND content LIKE 'Quality Review Rejected:%'
        ORDER BY created_at DESC LIMIT 1
      `).get(task.id);
            const rejectionFeedback = ((_a = rejectionRow === null || rejectionRow === void 0 ? void 0 : rejectionRow.content) === null || _a === void 0 ? void 0 : _a.replace(/^Quality Review Rejected:\n?/, '')) || null;
            const prompt = buildTaskPrompt(task, rejectionFeedback);
            // Check if task has a target session specified in metadata
            const taskMeta = (() => {
                try {
                    const row = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id);
                    return (row === null || row === void 0 ? void 0 : row.metadata) ? JSON.parse(row.metadata) : {};
                }
                catch (_a) {
                    return {};
                }
            })();
            const targetSession = typeof (taskMeta === null || taskMeta === void 0 ? void 0 : taskMeta.target_session) === 'string' && taskMeta.target_session
                ? taskMeta.target_session
                : null;
            let agentResponse;
            if (targetSession) {
                // Dispatch to a specific existing session via chat.send
                logger.info({ taskId: task.id, targetSession, agent: task.agent_name }, 'Dispatching task to targeted session');
                const sendResult = await callOpenClawGateway('chat.send', {
                    sessionKey: targetSession,
                    message: prompt,
                    idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
                    deliver: false,
                }, 125000);
                const status = String((sendResult === null || sendResult === void 0 ? void 0 : sendResult.status) || '').toLowerCase();
                if (status !== 'started' && status !== 'ok' && status !== 'in_flight') {
                    throw new Error(`chat.send to session ${targetSession} returned status: ${status}`);
                }
                // chat.send is fire-and-forget; we record the session but won't get inline response text
                agentResponse = {
                    text: `Task dispatched to existing session ${targetSession}. The agent will process it within that session context.`,
                    sessionId: (sendResult === null || sendResult === void 0 ? void 0 : sendResult.runId) || targetSession,
                };
            }
            else {
                // Step 1: Invoke via gateway (new session)
                const gatewayAgentId = resolveGatewayAgentId(task);
                const dispatchModel = classifyTaskModel(task);
                const invokeParams = {
                    message: prompt,
                    agentId: gatewayAgentId,
                    idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
                    deliver: false,
                };
                // Model override intentionally disabled for gateway agent calls.
                // Current gateway validation rejects arbitrary top-level `model` params,
                // which causes retry loops and stale in_progress tasks. Keep classification
                // logic in place for future compatibility, but do not send it here.
                void dispatchModel;
                // Use --expect-final to block until the agent completes and returns the full
                // response payload (result.payloads[0].text). The two-step agent → agent.wait
                // pattern only returns lifecycle metadata and never includes the agent's text.
                const finalResult = await runOpenClaw(['gateway', 'call', 'agent', '--expect-final', '--timeout', '120000', '--params', JSON.stringify(invokeParams), '--json'], { timeoutMs: 125000 });
                const finalPayload = (_b = parseGatewayJson(finalResult.stdout)) !== null && _b !== void 0 ? _b : parseGatewayJson(String((finalResult === null || finalResult === void 0 ? void 0 : finalResult.stderr) || ''));
                agentResponse = parseAgentResponse((finalPayload === null || finalPayload === void 0 ? void 0 : finalPayload.result) ? JSON.stringify(finalPayload.result) : finalResult.stdout);
                if (!agentResponse.sessionId && ((_e = (_d = (_c = finalPayload === null || finalPayload === void 0 ? void 0 : finalPayload.result) === null || _c === void 0 ? void 0 : _c.meta) === null || _d === void 0 ? void 0 : _d.agentMeta) === null || _e === void 0 ? void 0 : _e.sessionId)) {
                    agentResponse.sessionId = finalPayload.result.meta.agentMeta.sessionId;
                }
            } // end else (new session dispatch)
            if (!agentResponse.text) {
                throw new Error('Agent returned empty response');
            }
            const truncated = agentResponse.text.length > 10000
                ? agentResponse.text.substring(0, 10000) + '\n\n[Response truncated at 10,000 characters]'
                : agentResponse.text;
            // Merge dispatch_session_id into existing metadata
            const existingMeta = (() => {
                try {
                    const row = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id);
                    return (row === null || row === void 0 ? void 0 : row.metadata) ? JSON.parse(row.metadata) : {};
                }
                catch (_a) {
                    return {};
                }
            })();
            if (agentResponse.sessionId) {
                existingMeta.dispatch_session_id = agentResponse.sessionId;
            }
            // Update task: status → review, set outcome
            db.prepare(`
        UPDATE tasks SET status = ?, outcome = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ?
      `).run('review', 'success', truncated, JSON.stringify(existingMeta), Math.floor(Date.now() / 1000), task.id);
            // Add a comment from the agent with the full response
            db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(task.id, task.agent_name, truncated, Math.floor(Date.now() / 1000), task.workspace_id);
            eventBus.broadcast('task.status_changed', {
                id: task.id,
                status: 'review',
                previous_status: 'in_progress',
            });
            eventBus.broadcast('task.updated', {
                id: task.id,
                status: 'review',
                outcome: 'success',
                assigned_to: task.assigned_to,
                dispatch_session_id: agentResponse.sessionId,
            });
            db_helpers.logActivity('task_agent_completed', 'task', task.id, task.agent_name, `Agent completed task "${task.title}" — awaiting review`, { response_length: agentResponse.text.length, dispatch_session_id: agentResponse.sessionId }, task.workspace_id);
            recordSuccess(task.id);
            results.push({ id: task.id, success: true });
            logger.info({ taskId: task.id, agent: task.agent_name }, 'Task dispatched and completed');
        }
        catch (err) {
            const errorMsg = err.message || 'Unknown error';
            logger.error({ taskId: task.id, agent: task.agent_name, err }, 'Task dispatch failed');
            recordFailure(task.id, errorMsg.substring(0, 200));
            handleDispatchQuotaError(errorMsg);
            handleCliWatchdogTimeout(errorMsg);
            // Revert to assigned so it can be retried on the next tick
            db.prepare('UPDATE tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
                .run('assigned', errorMsg.substring(0, 5000), Math.floor(Date.now() / 1000), task.id);
            eventBus.broadcast('task.status_changed', {
                id: task.id,
                status: 'assigned',
                previous_status: 'in_progress',
            });
            db_helpers.logActivity('task_dispatch_failed', 'task', task.id, 'scheduler', `Task dispatch failed for "${task.title}": ${errorMsg.substring(0, 200)}`, { error: errorMsg.substring(0, 1000) }, task.workspace_id);
            results.push({ id: task.id, success: false, error: errorMsg.substring(0, 100) });
        }
    }
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    const failSummary = failed.length > 0
        ? ` (${failed.length} failed: ${failed.map(f => f.error).join('; ')})`
        : '';
    return {
        ok: failed.length === 0,
        message: `Dispatched ${succeeded}/${tasks.length} tasks${failSummary}`,
    };
}
