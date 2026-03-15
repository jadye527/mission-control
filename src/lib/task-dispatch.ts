import { getDatabase, db_helpers } from './db'
import { runOpenClaw } from './command'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { callOpenClawGateway } from './openclaw-gateway'
import { isRecurringTaskTemplate, parseTaskMetadata } from './task-status'
import { parseGatewayHistoryTranscript } from './transcript-parser'

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
  ticket_prefix: string | null
  project_ticket_no: number | null
  project_id: number | null
  tags?: string[]
  retry_count?: number
  metadata?: string | null
}

const DISPATCH_BATCH_SIZE = 10
const DISPATCH_CONCURRENCY = 5
const AGENT_WAIT_TIMEOUT_MS = 120_000
const REVIEW_BATCH_SIZE = 5
const REVIEW_CONCURRENCY = 3
const AEGIS_MAX_RETRIES = 3

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  async function consume(): Promise<void> {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      results[current] = await worker(items[current])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()))
  return results
}

function buildTaskPrompt(task: DispatchableTask, rejectionFeedback?: string | null): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You have been assigned a task in Mission Control.',
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

  if (rejectionFeedback) {
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

function extractReplyText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  if (waitPayload.result && typeof waitPayload.result === 'object') {
    const nested = extractReplyText(waitPayload.result)
    if (nested) return nested
  }

  if (Array.isArray(waitPayload.payloads)) {
    const text = waitPayload.payloads
      .map((p: any) => (typeof p === 'string' ? p : p?.text || '').trim())
      .filter(Boolean)
      .join('\n')
    if (text) return text.slice(0, 10000)
  }

  if (waitPayload.reply && typeof waitPayload.reply === 'string' && waitPayload.reply.trim()) {
    return waitPayload.reply.trim().slice(0, 10000)
  }

  if (Array.isArray(waitPayload.output)) {
    const parts: string[] = []
    for (const item of waitPayload.output) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text === 'string' && item.text.trim()) parts.push(item.text.trim())
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (!block || typeof block !== 'object') continue
          const blockType = String(block.type || '')
          if ((blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') && typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim())
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('\n').slice(0, 10000)
  }

  if (waitPayload.result && typeof waitPayload.result === 'string' && waitPayload.result.trim()) {
    return waitPayload.result.trim().slice(0, 10000)
  }

  return null
}

function parseAgentResponse(raw: string, waitPayload?: any): AgentResponseParsed {
  const payload = waitPayload && typeof waitPayload === 'object' ? waitPayload : (() => {
    try { return JSON.parse(raw) } catch { return null }
  })()

  const sessionId: string | null = typeof payload?.sessionId === 'string' ? payload.sessionId
    : typeof payload?.session_id === 'string' ? payload.session_id
    : null

  const extracted = extractReplyText(payload)
  if (extracted) return { text: extracted, sessionId }

  if (typeof raw === 'string' && raw.trim()) {
    return { text: raw.trim().slice(0, 10000), sessionId }
  }

  return { text: null, sessionId }
}

async function tryFetchReplyFromSessionHistory(sessionKey: string | null): Promise<string | null> {
  if (!sessionKey) return null
  try {
    const history = await callOpenClawGateway<{ messages?: unknown[] }>('chat.history', { sessionKey, limit: 20 }, 15000)
    const parsed = parseGatewayHistoryTranscript(Array.isArray(history?.messages) ? history.messages : [], 20)
    for (let i = parsed.length - 1; i >= 0; i--) {
      const msg = parsed[i]
      if (msg.role !== 'assistant') continue
      const text = msg.parts
        .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
        .map((p: any) => p.text.trim())
        .filter(Boolean)
        .join('\n')
      if (text) return text.slice(0, 10000)
    }
  } catch {
    // Best effort fallback only
  }
  return null
}

interface ReviewableTask {
  id: number
  title: string
  description: string | null
  resolution: string | null
  assigned_to: string | null
  workspace_id: number
  ticket_prefix: string | null
  project_ticket_no: number | null
  retry_count: number | null
  metadata: string | null
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
    'Reject only when you can cite specific missing deliverables, incorrect behavior, or evidence gaps.',
    'If you reject, the NOTES must contain actionable feedback the agent can fix in the next attempt.',
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

function isActionableReviewFeedback(notes: string): boolean {
  const normalized = notes.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.length < 24) return false
  const generic = [
    'quality check failed',
    'needs improvement',
    'not good enough',
    'insufficient quality',
    'try again',
    'rejected',
  ]
  return !generic.some((phrase) => normalized === phrase || normalized.includes(`${phrase}.`))
}

function buildFallbackRejectionNotes(task: ReviewableTask): string {
  return [
    `Aegis rejected "${task.title}" without specific guidance.`,
    'On the next attempt, include a concrete summary of work completed, the exact deliverable, and any commands, tests, or evidence that prove the task is done.',
    'If work remains, list the remaining gap explicitly before handing the task back for review.',
  ].join(' ')
}

function parseReviewVerdict(text: string, task: ReviewableTask): { status: 'approved' | 'rejected'; notes: string; actionable: boolean } {
  const upper = text.toUpperCase()
  const status = upper.includes('VERDICT: APPROVED') ? 'approved' as const : 'rejected' as const
  const notesMatch = text.match(/NOTES:\s*(.+)/i)
  let notes = notesMatch?.[1]?.trim().substring(0, 2000) || (status === 'approved' ? 'Quality check passed' : 'Quality check failed')
  const actionable = status === 'approved' ? true : isActionableReviewFeedback(notes)
  if (status === 'rejected' && !actionable) {
    notes = buildFallbackRejectionNotes(task)
  }
  return { status, notes, actionable }
}

/**
 * Run Aegis quality reviews on tasks in 'review' status.
 * Uses an agent to evaluate the task resolution, then approves or rejects.
 */
export async function runAegisReviews(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.resolution, t.assigned_to, t.workspace_id,
           t.retry_count, t.metadata, p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status = 'review'
    ORDER BY t.updated_at ASC
    LIMIT ?
  `).all(REVIEW_BATCH_SIZE) as ReviewableTask[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No tasks awaiting review' }
  }

  const results = await runWithConcurrency(tasks, REVIEW_CONCURRENCY, async (task) => {
    const locked = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'review', 'quality_review')
    if (!locked) {
      const current = db_helpers.getTaskState(task.id, task.workspace_id)
      return { id: task.id, verdict: 'skipped', error: `status=${current?.status || 'missing'}` }
    }

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'quality_review',
      previous_status: 'review',
    })

    try {
      if (isRecurringTaskTemplate(task.metadata)) {
        const autoNotes = 'Recurring task template auto-approved. Future work should be created by the recurring task spawner as child tasks.'
        db.prepare(`
          INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
          VALUES (?, 'aegis', 'approved', ?, ?)
        `).run(task.id, autoNotes, task.workspace_id)
        const completed = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'quality_review', 'done', {
          error_message: null,
          feedback_notes: autoNotes,
          completed_at: nowSec(),
        })
        if (completed) {
          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'done',
            previous_status: 'quality_review',
          })
        }
        return { id: task.id, verdict: 'approved' }
      }

      const invokeParams = {
        message: buildReviewPrompt(task),
        agentId: 'obsidian',
        idempotencyKey: `aegis-review-${task.id}-${Date.now()}`,
        deliver: false,
      }
      const invokeResult = await runOpenClaw(
        ['gateway', 'call', 'agent', '--expect-final', '--timeout', String(AGENT_WAIT_TIMEOUT_MS), '--params', JSON.stringify(invokeParams), '--json'],
        { timeoutMs: AGENT_WAIT_TIMEOUT_MS + 10_000 }
      )
      const waitPayload = parseGatewayJson(invokeResult.stdout)
        ?? parseGatewayJson(String((invokeResult as any)?.stderr || ''))
      const agentResponse = parseAgentResponse(invokeResult.stdout, waitPayload)
      if (!agentResponse.text) throw new Error('Aegis review returned empty response')

      const verdict = parseReviewVerdict(agentResponse.text, task)
      db.prepare(`
        INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
        VALUES (?, 'aegis', ?, ?, ?)
      `).run(task.id, verdict.status, verdict.notes, task.workspace_id)

      const nextRetryCount = Number(task.retry_count || 0) + (verdict.status === 'rejected' ? 1 : 0)
      const autoApprovedAfterRetries = verdict.status === 'rejected' && nextRetryCount >= AEGIS_MAX_RETRIES

      if (verdict.status === 'approved' || autoApprovedAfterRetries) {
        const approvalNotes = autoApprovedAfterRetries
          ? `Auto-approved after ${nextRetryCount} Aegis rejection cycles to prevent an infinite review loop. Last feedback: ${verdict.notes}`
          : verdict.notes

        const completed = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'quality_review', 'done', {
          error_message: null,
          feedback_notes: approvalNotes,
          retry_count: nextRetryCount,
          completed_at: nowSec(),
        })
        if (completed) {
          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'done',
            previous_status: 'quality_review',
          })
        }

        db_helpers.logActivity(
          'aegis_review',
          'task',
          task.id,
          'aegis',
          `Aegis approved task "${task.title}": ${approvalNotes.substring(0, 200)}`,
          { verdict: autoApprovedAfterRetries ? 'auto_approved' : 'approved', notes: approvalNotes, retry_count: nextRetryCount },
          task.workspace_id
        )

        return { id: task.id, verdict: autoApprovedAfterRetries ? 'auto_approved' : 'approved' }
      }

      const reassigned = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'quality_review', 'assigned', {
        error_message: `Aegis rejected: ${verdict.notes}`,
        feedback_notes: verdict.notes,
        retry_count: nextRetryCount,
        completed_at: null,
      })
      if (reassigned) {
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'assigned',
          previous_status: 'quality_review',
        })
      }

      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, 'aegis', ?, ?, ?)
      `).run(task.id, `Quality Review Rejected:\n${verdict.notes}`, nowSec(), task.workspace_id)

      db_helpers.logActivity(
        'aegis_review',
        'task',
        task.id,
        'aegis',
        `Aegis rejected task "${task.title}": ${verdict.notes.substring(0, 200)}`,
        { verdict: 'rejected', notes: verdict.notes, retry_count: nextRetryCount, actionable: verdict.actionable },
        task.workspace_id
      )

      return { id: task.id, verdict: 'rejected' }
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, err }, 'Aegis review failed')
      const reverted = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'quality_review', 'review')
      if (reverted) {
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'review',
          previous_status: 'quality_review',
        })
      }
      return { id: task.id, verdict: 'error', error: errorMsg.substring(0, 100) }
    }
  })

  const approved = results.filter(r => r.verdict === 'approved' || r.verdict === 'auto_approved').length
  const rejected = results.filter(r => r.verdict === 'rejected').length
  const errors = results.filter(r => r.verdict === 'error').length
  const skipped = results.filter(r => r.verdict === 'skipped').length

  return {
    ok: errors === 0,
    message: `Reviewed ${tasks.length}: ${approved} approved, ${rejected} rejected${errors ? `, ${errors} error(s)` : ''}${skipped ? `, ${skipped} skipped` : ''}`,
  }
}

export async function dispatchAssignedTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const tasks = db.prepare(`
    SELECT t.*, a.name as agent_name, a.id as agent_id,
           p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status = 'assigned'
      AND t.assigned_to IS NOT NULL
      AND NOT (
        COALESCE(json_extract(t.metadata, '$.recurrence.enabled'), 0) = 1
        AND json_extract(t.metadata, '$.recurrence.parent_task_id') IS NULL
      )
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      t.created_at ASC
    LIMIT ?
  `).all(DISPATCH_BATCH_SIZE) as (DispatchableTask & { tags?: string })[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No assigned tasks to dispatch' }
  }

  // Parse JSON tags column
  for (const task of tasks) {
    if (typeof task.tags === 'string') {
      try { task.tags = JSON.parse(task.tags as string) } catch { task.tags = undefined }
    }
  }

  const results = await runWithConcurrency(tasks, DISPATCH_CONCURRENCY, async (task) => {
    const currentState = db_helpers.getTaskState(task.id, task.workspace_id)
    if (!currentState || currentState.status !== 'assigned') {
      return { id: task.id, success: false, skipped: true, error: `status=${currentState?.status || 'missing'}` }
    }
    if (isRecurringTaskTemplate(currentState.metadata)) {
      return { id: task.id, success: false, skipped: true, error: 'recurring_template' }
    }

    const locked = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'assigned', 'in_progress', {
      error_message: null,
    })
    if (!locked) {
      const latest = db_helpers.getTaskState(task.id, task.workspace_id)
      return { id: task.id, success: false, skipped: true, error: `status=${latest?.status || 'missing'}` }
    }

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

      // Step 1: Invoke via gateway
      const invokeParams = {
        message: prompt,
        agentId: task.agent_name,
        idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
        deliver: false,
      }
      const invokeResult = await runOpenClaw(
        ['gateway', 'call', 'agent', '--expect-final', '--timeout', String(AGENT_WAIT_TIMEOUT_MS), '--params', JSON.stringify(invokeParams), '--json'],
        { timeoutMs: AGENT_WAIT_TIMEOUT_MS + 10_000 }
      )
      const waitPayload = parseGatewayJson(invokeResult.stdout)
        ?? parseGatewayJson(String((invokeResult as any)?.stderr || ''))

      const agentResponse = parseAgentResponse(invokeResult.stdout, waitPayload)
      // Capture sessionId from the wait payload if not in the parsed response
      if (!agentResponse.sessionId && waitPayload?.sessionId) {
        agentResponse.sessionId = waitPayload.sessionId
      }

      let finalText = agentResponse.text
      if (!finalText || /^\s*\{[\s\S]*?"runId"\s*:/.test(finalText)) {
        const historyText = await tryFetchReplyFromSessionHistory(agentResponse.sessionId)
        if (historyText) finalText = historyText
      }

      if (!finalText) {
        throw new Error('Agent returned empty response')
      }

      const truncated = finalText.length > 10_000
        ? finalText.substring(0, 10_000) + '\n\n[Response truncated at 10,000 characters]'
        : finalText

      const existingMeta = parseTaskMetadata(db_helpers.getTaskState(task.id, task.workspace_id)?.metadata)
      if (agentResponse.sessionId) {
        existingMeta.dispatch_session_id = agentResponse.sessionId
      }

      const advanced = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'in_progress', 'review', {
        outcome: 'success',
        resolution: truncated,
        metadata: JSON.stringify(existingMeta),
        error_message: null,
      })
      if (!advanced) {
        const latest = db_helpers.getTaskState(task.id, task.workspace_id)
        logger.warn({ taskId: task.id, status: latest?.status }, 'Task status changed during dispatch completion; skipping review transition')
        return { id: task.id, success: true, skipped: true, error: `completion_skipped:${latest?.status || 'missing'}` }
      }

      // Add a comment from the agent with the full response
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        task.id,
        task.agent_name,
        truncated,
        nowSec(),
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
        { response_length: finalText.length, dispatch_session_id: agentResponse.sessionId },
        task.workspace_id
      )

      logger.info({ taskId: task.id, agent: task.agent_name }, 'Task dispatched and completed')
      return { id: task.id, success: true }
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, agent: task.agent_name, err }, 'Task dispatch failed')

      const reverted = db_helpers.compareAndSetTaskStatus(task.id, task.workspace_id, 'in_progress', 'assigned', {
        error_message: errorMsg.substring(0, 5000),
      })
      if (reverted) {
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'assigned',
          previous_status: 'in_progress',
        })
      }

      db_helpers.logActivity(
        'task_dispatch_failed',
        'task',
        task.id,
        'scheduler',
        `Task dispatch failed for "${task.title}": ${errorMsg.substring(0, 200)}`,
        { error: errorMsg.substring(0, 1000) },
        task.workspace_id
      )

      return { id: task.id, success: false, error: errorMsg.substring(0, 100) }
    }
  })

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success && !r.skipped)
  const skipped = results.filter(r => r.skipped).length
  const failSummary = failed.length > 0
    ? ` (${failed.length} failed: ${failed.map(f => f.error).join('; ')})`
    : ''

  return {
    ok: failed.length === 0,
    message: `Dispatched ${succeeded}/${tasks.length} tasks${skipped ? `, ${skipped} skipped` : ''}${failSummary}`,
  }
}

// ─── Inbox Triage ────────────────────────────────────────────────────────────

const AGENT_PROFILES = `
Available agents and their specializations:

1. **obsidian** — CEO / Orchestrator. Strategic decisions, P&L judgment, revenue planning, approval authority, coordination across agents. Use for: strategy, business decisions, metrics review, anything requiring executive judgment.

2. **sentinel** — Intelligence & Surveillance. Polymarket weather trading, real-time market surveillance, METAR analysis, data collection, monitoring, position sizing. Use for: trading, market analysis, data research, monitoring tasks.

3. **ralph** — Staff Developer. Full-stack code implementation, dashboards, CI/CD, automation scripts, bug fixes, DevOps, infrastructure. Use for: coding, building features, fixing bugs, deployment, tooling, content creation tooling.
`.trim()

interface InboxTask {
  id: number
  title: string
  description: string | null
  priority: string
  tags: string | null
  workspace_id: number
  project_id: number | null
  ticket_prefix: string | null
  project_ticket_no: number | null
}

function buildTriagePrompt(taskBatch: InboxTask[]): string {
  const lines = [
    'You are the CEO triage system for Mission Control.',
    'Assign each unassigned inbox task to the best agent based on the task content and agent specializations.',
    '',
    AGENT_PROFILES,
    '',
    '## Tasks to assign',
    '',
  ]

  for (const task of taskBatch) {
    const ticket = task.ticket_prefix && task.project_ticket_no
      ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
      : `TASK-${task.id}`
    const tags = task.tags ? ` [tags: ${task.tags}]` : ''
    lines.push(`### ${ticket}: ${task.title}${tags}`)
    if (task.description) {
      lines.push(task.description.substring(0, 500))
    }
    lines.push('')
  }

  lines.push(
    '## Instructions',
    'For EACH task above, respond with exactly one line in this format:',
    'ASSIGN: <ticket> -> <agent_name>',
    '',
    'Example:',
    'ASSIGN: DIST-001 -> ralph',
    'ASSIGN: DIST-002 -> sentinel',
    '',
    'Only use agent names: obsidian, sentinel, ralph',
    'Assign every task. Do not skip any.',
  )

  return lines.join('\n')
}

function parseTriageResponse(text: string, taskBatch: InboxTask[]): Map<number, string> {
  const assignments = new Map<number, string>()
  const validAgents = new Set(['obsidian', 'sentinel', 'ralph'])

  const assignLines = text.match(/ASSIGN:\s*\S+\s*->\s*\w+/gi) || []

  for (const line of assignLines) {
    const match = line.match(/ASSIGN:\s*(\S+)\s*->\s*(\w+)/i)
    if (!match) continue

    const ticketRef = match[1]
    const agent = match[2].toLowerCase()
    if (!validAgents.has(agent)) continue

    // Match ticket ref to task ID
    const task = taskBatch.find(t => {
      const ticket = t.ticket_prefix && t.project_ticket_no
        ? `${t.ticket_prefix}-${String(t.project_ticket_no).padStart(3, '0')}`
        : `TASK-${t.id}`
      return ticket.toLowerCase() === ticketRef.toLowerCase()
    })

    if (task) {
      assignments.set(task.id, agent)
    }
  }

  return assignments
}

/**
 * Triage inbox tasks — sends unassigned inbox tasks to Obsidian for smart assignment.
 */
export async function triageInboxTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const inboxTasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.priority, t.tags,
           t.workspace_id, t.project_id, p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status = 'inbox' AND (t.assigned_to IS NULL OR t.assigned_to = '')
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      t.created_at ASC
    LIMIT 5
  `).all() as InboxTask[]

  if (inboxTasks.length === 0) {
    return { ok: true, message: 'No inbox tasks to triage' }
  }

  try {
    const prompt = buildTriagePrompt(inboxTasks)

    const invokeParams = {
      message: prompt,
      agentId: 'obsidian',
      idempotencyKey: `triage-inbox-${Date.now()}`,
      deliver: false,
    }
    const invokeResult = await runOpenClaw(
      ['gateway', 'call', 'agent', '--expect-final', '--timeout', '300000', '--params', JSON.stringify(invokeParams), '--json'],
      { timeoutMs: 310_000 }
    )
    const waitPayload = parseGatewayJson(invokeResult.stdout)
      ?? parseGatewayJson(String((invokeResult as any)?.stderr || ''))
    const agentResponse = parseAgentResponse(invokeResult.stdout, waitPayload)

    if (!agentResponse.text) {
      throw new Error('Triage agent returned empty response')
    }

    const assignments = parseTriageResponse(agentResponse.text, inboxTasks)

    let assigned = 0
    for (const [taskId, agentName] of assignments) {
      db.prepare('UPDATE tasks SET assigned_to = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(agentName, 'assigned', Math.floor(Date.now() / 1000), taskId)

      eventBus.broadcast('task.status_changed', {
        id: taskId,
        status: 'assigned',
        previous_status: 'inbox',
      })

      const task = inboxTasks.find(t => t.id === taskId)
      db_helpers.logActivity(
        'task_triaged',
        'task',
        taskId,
        'obsidian',
        `Obsidian assigned "${task?.title}" to ${agentName}`,
        { agent: agentName },
        task?.workspace_id || 1
      )

      assigned++
      logger.info({ taskId, agent: agentName }, 'Inbox task triaged and assigned')
    }

    const unassigned = inboxTasks.length - assigned
    return {
      ok: true,
      message: `Triaged ${assigned}/${inboxTasks.length} inbox tasks${unassigned > 0 ? ` (${unassigned} could not be assigned)` : ''}`,
    }
  } catch (err: any) {
    logger.error({ err }, 'Inbox triage failed')
    return { ok: false, message: `Triage failed: ${err.message?.substring(0, 200)}` }
  }
}
