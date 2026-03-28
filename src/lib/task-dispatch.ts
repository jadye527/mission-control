import { getDatabase, db_helpers } from './db'
import { runOpenClaw } from './command'
import { callOpenClawGateway } from './openclaw-gateway'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { canDispatch, recordSuccess, recordFailure } from './circuit-breaker'
import { handleDispatchQuotaError, handleCliWatchdogTimeout } from './provider-cooldown'

interface DispatchableTask {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string
  workspace_id: number
  agent_name: string
  agent_id: number
  agent_config: string | null
  ticket_prefix: string | null
  project_ticket_no: number | null
  project_id: number | null
  retry_count: number
  tags?: string[]
}


/** Extract the gateway agent identifier from the agent's config JSON.
 *  Falls back to agent_name (display name) if openclawId is not set. */
function resolveGatewayAgentId(task: DispatchableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.openclawId === 'string' && cfg.openclawId) return cfg.openclawId
    } catch { /* ignore */ }
  }
  return task.agent_name
}

function buildTaskPrompt(task: DispatchableTask, rejectionFeedback?: string | null): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'IMPORTANT: You are being dispatched to complete ONE specific task.',
    '- Do not reference other assigned tasks or plan to parallelize.',
    '- Do not say "I will do X" — just do X and report what you did.',
    '- Your response is your resolution. If you cannot complete the task, say exactly why with specific blockers.',
    '- Never return "HEARTBEAT_OK" as a resolution.',
    '- WAIT RULE: Do not submit a resolution while you are still running a script, waiting for a subagent, or have an active coding session in progress. Stay in your current state until the work is fully complete. Only submit a resolution when you have actual deliverables to report.',
    '',
    `**[${ticket}] ${task.title}**`,
    `Priority: ${task.priority}`,
  ]

  if (task.tags && task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.join(', ')}`)
  }

  if (task.description) {
    lines.push('', task.description)
  }

  // Only include rejection feedback on the first retry — subsequent retries escalate instead
  if (rejectionFeedback && task.retry_count <= 1) {
    lines.push('', '## Previous Review Feedback', rejectionFeedback, '', 'Please address this feedback in your response.')
  }

  lines.push('', 'Complete this task and provide your response. Be concise and actionable.')
  return lines.join('\n')
}

/** Extract first valid JSON object from raw stdout (handles surrounding text/warnings). */
function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

interface AgentResponseParsed {
  text: string | null
  sessionId: string | null
}

function parseAgentResponse(stdout: string): AgentResponseParsed {
  try {
    const parsed = JSON.parse(stdout)
    const sessionId: string | null = typeof parsed?.sessionId === 'string' ? parsed.sessionId
      : typeof parsed?.session_id === 'string' ? parsed.session_id
      : null

    // OpenClaw agent --json returns { payloads: [{ text: "..." }] }
    if (parsed?.payloads?.[0]?.text) {
      return { text: parsed.payloads[0].text, sessionId }
    }
    // Fallback: if there's a result or output field
    if (parsed?.result) return { text: String(parsed.result), sessionId }
    if (parsed?.output) return { text: String(parsed.output), sessionId }
    // Last resort: stringify the whole response
    return { text: JSON.stringify(parsed, null, 2), sessionId }
  } catch {
    // Not valid JSON — return raw stdout if non-empty
    return { text: stdout.trim() || null, sessionId: null }
  }
}

interface ReviewableTask {
  id: number
  title: string
  description: string | null
  resolution: string | null
  assigned_to: string | null
  agent_config: string | null
  workspace_id: number
  ticket_prefix: string | null
  project_ticket_no: number | null
}

function resolveGatewayAgentIdForReview(task: ReviewableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.openclawId === 'string' && cfg.openclawId) return cfg.openclawId
    } catch { /* ignore */ }
  }
  return task.assigned_to || 'jarv'
}

function buildReviewPrompt(task: ReviewableTask): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You are Aegis, the quality reviewer for Mission Control.',
    'Review the following completed task and its resolution.',
    '',
    `**[${ticket}] ${task.title}**`,
  ]

  if (task.description) {
    lines.push('', '## Task Description', task.description)
  }

  if (task.resolution) {
    lines.push('', '## Agent Resolution', task.resolution.substring(0, 6000))
  }

  lines.push(
    '',
    '## Instructions',
    'Evaluate whether the agent\'s response adequately addresses the task.',
    'Respond with EXACTLY one of these two formats:',
    '',
    'If the work is acceptable:',
    'VERDICT: APPROVED',
    'NOTES: <brief summary of why it passes>',
    '',
    'If the work needs improvement:',
    'VERDICT: REJECTED',
    'NOTES: <specific issues that need to be fixed>',
  )

  return lines.join('\n')
}

const OWNER_ACTION_KEYWORDS = [
  'owner action', 'you need to', 'manual step', 'browser login',
  'create account', 'purchase', 'sign up', 'login required',
  'action required', 'requires human', 'cannot be automated',
]

/** Check whether a resolution's text indicates human follow-up is needed. */
function resolutionRequiresOwnerAction(resolution: string | null | undefined): boolean {
  if (!resolution) return false
  const lower = resolution.toLowerCase()
  return OWNER_ACTION_KEYWORDS.some(kw => lower.includes(kw))
}

function parseReviewVerdict(text: string): { status: 'approved' | 'rejected'; notes: string } {
  const upper = text.toUpperCase()
  const status = upper.includes('VERDICT: APPROVED') ? 'approved' as const : 'rejected' as const
  const notesMatch = text.match(/NOTES:\s*([\s\S]+)/i)
  const notes = notesMatch?.[1]?.trim().substring(0, 2000) || (status === 'approved' ? 'Quality check passed' : 'Quality check failed')
  return { status, notes }
}

/**
 * Run Aegis quality reviews on tasks in 'review' status.
 * Uses an agent to evaluate the task resolution, then approves or rejects.
 */
export async function runAegisReviews(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.resolution, t.assigned_to, t.workspace_id,
           p.ticket_prefix, t.project_ticket_no, a.config as agent_config
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status = 'review'
    ORDER BY t.updated_at ASC
    LIMIT 3
  `).all() as ReviewableTask[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No tasks awaiting review' }
  }

  const results: Array<{ id: number; verdict: string; error?: string }> = []

  for (const task of tasks) {
    // Move to quality_review to prevent re-processing
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('quality_review', Math.floor(Date.now() / 1000), task.id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'quality_review',
      previous_status: 'review',
    })

    try {
      const prompt = buildReviewPrompt(task)
      // Resolve the gateway agent ID from config, falling back to assigned_to or default
      const reviewAgent = resolveGatewayAgentIdForReview(task)

      // Use `openclaw agent` directly — more reliable than gateway WebSocket call
      const finalResult = await runOpenClaw(
        ['agent', '--agent', reviewAgent, '--message', prompt, '--timeout', '300'],
        { timeoutMs: 310_000 }
      )
      const agentResponse: AgentResponseParsed = {
        text: finalResult.stdout.trim() || null,
        sessionId: null,
      }
      if (!agentResponse.text) {
        throw new Error('Aegis review returned empty response')
      }

      const verdict = parseReviewVerdict(agentResponse.text)

      // Insert quality review record
      db.prepare(`
        INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
        VALUES (?, 'aegis', ?, ?, ?)
      `).run(task.id, verdict.status, verdict.notes, task.workspace_id)

      if (verdict.status === 'approved') {
        const finalStatus = resolutionRequiresOwnerAction(task.resolution) ? 'awaiting_owner' : 'done'

        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
          .run(finalStatus, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: finalStatus,
          previous_status: 'quality_review',
        })

        if (finalStatus === 'awaiting_owner') {
          db_helpers.logActivity(
            'task_awaiting_owner',
            'task',
            task.id,
            'aegis',
            `Task "${task.title}" approved but requires owner action`,
            { notes: verdict.notes },
            task.workspace_id
          )
          // Notify owner via MC notification
          db_helpers.createNotification(
            'admin',
            'awaiting_owner',
            'Owner action needed',
            `Task "${task.title}" needs your attention: ${verdict.notes || 'approved but requires manual step'}`,
            'task',
            task.id,
            task.workspace_id
          )
        }
      } else {
        // Rejected: push back to assigned so dispatcher re-sends with feedback
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
          .run('assigned', `Aegis rejected: ${verdict.notes}`, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'assigned',
          previous_status: 'quality_review',
        })

        // Add rejection as a comment so the agent sees it on next dispatch
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'aegis', ?, ?, ?)
        `).run(task.id, `Quality Review Rejected:\n${verdict.notes}`, Math.floor(Date.now() / 1000), task.workspace_id)
      }

      db_helpers.logActivity(
        'aegis_review',
        'task',
        task.id,
        'aegis',
        `Aegis ${verdict.status} task "${task.title}": ${verdict.notes.substring(0, 200)}`,
        { verdict: verdict.status, notes: verdict.notes },
        task.workspace_id
      )

      results.push({ id: task.id, verdict: verdict.status })
      logger.info({ taskId: task.id, verdict: verdict.status }, 'Aegis review completed')
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, err }, 'Aegis review failed')

      // If a prior approved QR exists (e.g. approved before a restart), honour it and close
      const priorApproval = db.prepare(
        "SELECT id FROM quality_reviews WHERE task_id = ? AND status = 'approved' LIMIT 1"
      ).get(task.id) as { id: number } | undefined

      if (priorApproval) {
        const finalStatus = resolutionRequiresOwnerAction(task.resolution) ? 'awaiting_owner' : 'done'
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
          .run(finalStatus, Math.floor(Date.now() / 1000), task.id, 'quality_review')
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: finalStatus,
          previous_status: 'quality_review',
        })
        logger.info({ taskId: task.id }, `Aegis timeout — honoured prior approval, set to ${finalStatus}`)
      } else {
        // Revert to review so it can be retried — only if still in quality_review
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
          .run('review', Math.floor(Date.now() / 1000), task.id, 'quality_review')
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'review',
          previous_status: 'quality_review',
        })
      }

      results.push({ id: task.id, verdict: 'error', error: errorMsg.substring(0, 100) })
    }
  }

  const approved = results.filter(r => r.verdict === 'approved').length
  const rejected = results.filter(r => r.verdict === 'rejected').length
  const errors = results.filter(r => r.verdict === 'error').length

  return {
    ok: errors === 0,
    message: `Reviewed ${tasks.length}: ${approved} approved, ${rejected} rejected${errors ? `, ${errors} error(s)` : ''}`,
  }
}

export async function dispatchAssignedTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

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
  `).all() as (DispatchableTask & { tags?: string })[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No assigned tasks to dispatch' }
  }

  // Parse JSON tags column
  for (const task of tasks) {
    if (typeof task.tags === 'string') {
      try { task.tags = JSON.parse(task.tags as string) } catch { task.tags = undefined }
    }
  }

  const results: Array<{ id: number; success: boolean; error?: string }> = []
  const now = Math.floor(Date.now() / 1000)

  for (const task of tasks) {
    // Circuit breaker check — skip if task has too many failures
    const cbCheck = canDispatch(task.id)
    if (!cbCheck.allowed) {
      logger.info({ taskId: task.id, reason: cbCheck.reason }, 'Circuit breaker: skipping dispatch')
      results.push({ id: task.id, success: false, error: cbCheck.reason })
      continue
    }

    // Mark as in_progress immediately to prevent re-dispatch
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('in_progress', now, task.id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'in_progress',
      previous_status: 'assigned',
    })

    db_helpers.logActivity(
      'task_dispatched',
      'task',
      task.id,
      'scheduler',
      `Dispatching task "${task.title}" to agent ${task.agent_name}`,
      { agent: task.agent_name, priority: task.priority },
      task.workspace_id
    )

    try {
      // Check for previous Aegis rejection feedback
      const rejectionRow = db.prepare(`
        SELECT content FROM comments
        WHERE task_id = ? AND author = 'aegis' AND content LIKE 'Quality Review Rejected:%'
        ORDER BY created_at DESC LIMIT 1
      `).get(task.id) as { content: string } | undefined
      const rejectionFeedback = rejectionRow?.content?.replace(/^Quality Review Rejected:\n?/, '') || null

      const prompt = buildTaskPrompt(task, rejectionFeedback)

      // Check if task has a target session specified in metadata
      const taskMeta = (() => {
        try {
          const row = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata: string } | undefined
          return row?.metadata ? JSON.parse(row.metadata) : {}
        } catch { return {} }
      })()
      const targetSession: string | null = typeof taskMeta?.target_session === 'string' && taskMeta.target_session
        ? taskMeta.target_session
        : null

      let agentResponse: AgentResponseParsed

      if (targetSession) {
        // Dispatch to a specific existing session via chat.send
        logger.info({ taskId: task.id, targetSession, agent: task.agent_name }, 'Dispatching task to targeted session')
        const sendResult = await callOpenClawGateway<any>(
          'chat.send',
          {
            sessionKey: targetSession,
            message: prompt,
            idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
            deliver: false,
          },
          125_000,
        )
        const status = String(sendResult?.status || '').toLowerCase()
        if (status !== 'started' && status !== 'ok' && status !== 'in_flight') {
          throw new Error(`chat.send to session ${targetSession} returned status: ${status}`)
        }
        // chat.send is fire-and-forget; we record the session but won't get inline response text
        agentResponse = {
          text: `Task dispatched to existing session ${targetSession}. The agent will process it within that session context.`,
          sessionId: sendResult?.runId || targetSession,
        }
      } else {
        // Step 1: Invoke via gateway (new session)
        const gatewayAgentId = resolveGatewayAgentId(task)
        const invokeParams: Record<string, unknown> = {
          message: prompt,
          agentId: gatewayAgentId,
          idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
          deliver: false,
        }
        // Model override intentionally disabled for gateway agent calls.
        // Current gateway validation rejects arbitrary top-level `model` params,
        // which causes retry loops and stale in_progress tasks.
        // Model overrides are not supported by the gateway for agent="main".
        // Let each agent use its own configured default model.

        // Use --expect-final to block until the agent completes and returns the full
        // response payload (result.payloads[0].text). The two-step agent → agent.wait
        // pattern only returns lifecycle metadata and never includes the agent's text.
        const finalResult = await runOpenClaw(
          ['gateway', 'call', 'agent', '--expect-final', '--timeout', '120000', '--params', JSON.stringify(invokeParams), '--json'],
          { timeoutMs: 125_000 }
        )
        const finalPayload = parseGatewayJson(finalResult.stdout)
          ?? parseGatewayJson(String((finalResult as any)?.stderr || ''))

        agentResponse = parseAgentResponse(
          finalPayload?.result ? JSON.stringify(finalPayload.result) : finalResult.stdout
        )
        if (!agentResponse.sessionId && finalPayload?.result?.meta?.agentMeta?.sessionId) {
          agentResponse.sessionId = finalPayload.result.meta.agentMeta.sessionId
        }
      } // end else (new session dispatch)

      if (!agentResponse.text) {
        throw new Error('Agent returned empty response')
      }

      // Detect administrative responses that are not actual work products.
      // These patterns indicate the agent talked about the task instead of doing it.
      const ADMIN_PATTERNS = [
        /^I('ve| have) got (two|multiple|several) assigned tasks/i,
        /^Writing the .* (file|code|PRD|doc) now/i,
        /^I can'?t safely .* (continue|resume)/i,
        /^HEARTBEAT_OK/,
        /^(All deliverables are already|The (file|work) (exists|was already))/i,
        /^I('m| am) going to (start the split|parallelize|spawn)/i,
      ]
      const isAdminResponse = ADMIN_PATTERNS.some(p => p.test(agentResponse.text!.trim()))
      if (isAdminResponse) {
        throw new Error(
          `Agent returned administrative response instead of work product: "${agentResponse.text!.substring(0, 150)}"`
        )
      }

      // If this is a repeated failure (retry > 1), escalate to awaiting_owner
      // rather than cycling through Aegis again.
      if (task.retry_count > 1) {
        const escalateMsg = `Escalated after ${task.retry_count} retries — agent unable to produce acceptable work. Owner review required.`
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, resolution = ?, updated_at = ? WHERE id = ?')
          .run('awaiting_owner', escalateMsg, agentResponse.text, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'awaiting_owner',
          previous_status: 'in_progress',
        })

        db_helpers.createNotification(
          'admin',
          'awaiting_owner',
          'Task escalated after repeated failures',
          `Task "${task.title}" failed ${task.retry_count} times and needs owner review.`,
          'task',
          task.id,
          task.workspace_id
        )

        db_helpers.logActivity(
          'task_escalated',
          'task',
          task.id,
          'scheduler',
          `Task "${task.title}" escalated to awaiting_owner after ${task.retry_count} retries`,
          { retry_count: task.retry_count },
          task.workspace_id
        )

        recordSuccess(task.id)
        results.push({ id: task.id, success: true })
        logger.warn({ taskId: task.id, retryCount: task.retry_count }, 'Task escalated to awaiting_owner')
        continue
      }

      const truncated = agentResponse.text.length > 10_000
        ? agentResponse.text.substring(0, 10_000) + '\n\n[Response truncated at 10,000 characters]'
        : agentResponse.text

      // Merge dispatch_session_id into existing metadata
      const existingMeta = (() => {
        try {
          const row = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata: string } | undefined
          return row?.metadata ? JSON.parse(row.metadata) : {}
        } catch { return {} }
      })()
      if (agentResponse.sessionId) {
        existingMeta.dispatch_session_id = agentResponse.sessionId
      }

      // Update task: status → review, set outcome
      db.prepare(`
        UPDATE tasks SET status = ?, outcome = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ?
      `).run('review', 'success', truncated, JSON.stringify(existingMeta), Math.floor(Date.now() / 1000), task.id)

      // Add a comment from the agent with the full response
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        task.id,
        task.agent_name,
        truncated,
        Math.floor(Date.now() / 1000),
        task.workspace_id
      )

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'review',
        previous_status: 'in_progress',
      })

      eventBus.broadcast('task.updated', {
        id: task.id,
        status: 'review',
        outcome: 'success',
        assigned_to: task.assigned_to,
        dispatch_session_id: agentResponse.sessionId,
      })

      db_helpers.logActivity(
        'task_agent_completed',
        'task',
        task.id,
        task.agent_name,
        `Agent completed task "${task.title}" — awaiting review`,
        { response_length: agentResponse.text.length, dispatch_session_id: agentResponse.sessionId },
        task.workspace_id
      )

      recordSuccess(task.id)
      results.push({ id: task.id, success: true })
      logger.info({ taskId: task.id, agent: task.agent_name }, 'Task dispatched and completed')
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, agent: task.agent_name, err }, 'Task dispatch failed')
      recordFailure(task.id, errorMsg.substring(0, 200))
      handleDispatchQuotaError(errorMsg)
      handleCliWatchdogTimeout(errorMsg)

      // Revert to assigned so it can be retried on the next tick.
      // Also persist retry_count to DB so it survives server restarts.
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, retry_count = retry_count + 1, updated_at = ? WHERE id = ?')
        .run('assigned', errorMsg.substring(0, 5000), Math.floor(Date.now() / 1000), task.id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'assigned',
        previous_status: 'in_progress',
      })

      db_helpers.logActivity(
        'task_dispatch_failed',
        'task',
        task.id,
        'scheduler',
        `Task dispatch failed for "${task.title}": ${errorMsg.substring(0, 200)}`,
        { error: errorMsg.substring(0, 1000) },
        task.workspace_id
      )

      results.push({ id: task.id, success: false, error: errorMsg.substring(0, 100) })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success)
  const failSummary = failed.length > 0
    ? ` (${failed.length} failed: ${failed.map(f => f.error).join('; ')})`
    : ''

  return {
    ok: failed.length === 0,
    message: `Dispatched ${succeeded}/${tasks.length} tasks${failSummary}`,
  }
}
