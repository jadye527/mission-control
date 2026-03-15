import type { Task } from './db'

export type TaskStatus = Task['status']
export interface TaskRecurrenceMetadata {
  cron_expr?: string
  natural_text?: string
  enabled?: boolean
  last_spawned_at?: number | null
  spawn_count?: number
  parent_task_id?: number | null
  spawned_from_cron?: string
}

export type TaskMetadata = Record<string, unknown> & {
  recurrence?: TaskRecurrenceMetadata
}

function hasAssignee(assignedTo: string | null | undefined): boolean {
  return Boolean(assignedTo && assignedTo.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseTaskMetadata(
  metadata: string | Record<string, unknown> | null | undefined
): TaskMetadata {
  if (!metadata) return {}

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata)
      return isRecord(parsed) ? parsed as TaskMetadata : {}
    } catch {
      return {}
    }
  }

  return isRecord(metadata) ? metadata as TaskMetadata : {}
}

export function isRecurringTaskTemplate(
  metadata: string | Record<string, unknown> | null | undefined
): boolean {
  const parsed = parseTaskMetadata(metadata)
  const recurrence = parsed.recurrence
  return Boolean(
    recurrence?.enabled &&
    recurrence?.cron_expr &&
    (recurrence.parent_task_id === null || recurrence.parent_task_id === undefined)
  )
}

export function isRecurringTaskInstance(
  metadata: string | Record<string, unknown> | null | undefined
): boolean {
  const parsed = parseTaskMetadata(metadata)
  const parentTaskId = parsed.recurrence?.parent_task_id
  return typeof parentTaskId === 'number' && Number.isFinite(parentTaskId)
}

/**
 * Keep task state coherent when a task is created with an assignee.
 * If caller asks for `inbox` but also sets `assigned_to`, normalize to `assigned`.
 */
export function normalizeTaskCreateStatus(
  requestedStatus: TaskStatus | undefined,
  assignedTo: string | undefined
): TaskStatus {
  const status = requestedStatus ?? 'inbox'
  if (status === 'inbox' && hasAssignee(assignedTo)) return 'assigned'
  return status
}

/**
 * Auto-adjust status for assignment-only updates when caller does not
 * explicitly request a status transition.
 */
export function normalizeTaskUpdateStatus(args: {
  currentStatus: TaskStatus
  requestedStatus: TaskStatus | undefined
  assignedTo: string | null | undefined
  assignedToProvided: boolean
}): TaskStatus | undefined {
  const { currentStatus, requestedStatus, assignedTo, assignedToProvided } = args
  if (requestedStatus !== undefined) return requestedStatus
  if (!assignedToProvided) return undefined

  if (hasAssignee(assignedTo) && currentStatus === 'inbox') return 'assigned'
  if (!hasAssignee(assignedTo) && currentStatus === 'assigned') return 'inbox'
  return undefined
}
