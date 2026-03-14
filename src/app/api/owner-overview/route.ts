import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface OwnerOverview {
  priorities: string[]
  blockedTasks: Array<{ id: number; title: string; assigned_to: string | null; updated_at: number }>
  qcQueue: Array<{ id: number; title: string; assigned_to: string | null; updated_at: number }>
  activeRuns: Array<{ name: string; status: string; lastOutput: string }>
  staleRuns: Array<{ name: string; status: string; lastOutput: string }>
  agentUpdates: Array<{ agent: string; status: string; lastActivity: string; currentTask: string | null }>
  counts: {
    blocked: number
    qcWaiting: number
    activeRuns: number
    staleRuns: number
    inProgress: number
  }
}

/**
 * GET /api/owner-overview
 *
 * Returns the owner cockpit summary strip data:
 * - top priorities from company/PRIORITIES.md
 * - blocked tasks from task DB
 * - quality review queue
 * - active/stale tmux runs
 * - latest meaningful agent updates
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const [priorities, taskData, runs, agentUpdates] = await Promise.all([
      getPriorities(),
      getTaskData(workspaceId),
      getActiveRuns(),
      getAgentUpdates(workspaceId),
    ])

    const staleThresholdMs = 30 * 60 * 1000 // 30 minutes
    const now = Date.now()
    const activeRuns: OwnerOverview['activeRuns'] = []
    const staleRuns: OwnerOverview['staleRuns'] = []

    for (const run of runs) {
      if (run.status === 'stale') {
        staleRuns.push(run)
      } else {
        activeRuns.push(run)
      }
    }

    const overview: OwnerOverview = {
      priorities,
      blockedTasks: taskData.blocked,
      qcQueue: taskData.qcQueue,
      activeRuns,
      staleRuns,
      agentUpdates,
      counts: {
        blocked: taskData.blocked.length,
        qcWaiting: taskData.qcQueue.length,
        activeRuns: activeRuns.length,
        staleRuns: staleRuns.length,
        inProgress: taskData.inProgressCount,
      },
    }

    return NextResponse.json(overview)
  } catch (error) {
    logger.error({ err: error }, 'Owner overview API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Parse top priorities from company/PRIORITIES.md
 */
async function getPriorities(): Promise<string[]> {
  const priorities: string[] = []
  const possiblePaths = [
    path.join(process.cwd(), '..', 'company', 'PRIORITIES.md'),
    path.join(process.env.OPENCLAW_HOME || '', 'company', 'PRIORITIES.md'),
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8')
        // Extract items under "## Now" section
        const nowMatch = content.match(/## Now\n([\s\S]*?)(?=\n## |$)/)
        if (nowMatch) {
          const lines = nowMatch[1].split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('- ')) {
              priorities.push(trimmed.slice(2))
            }
          }
        }
        break
      } catch {
        // Skip unreadable files
      }
    }
  }

  return priorities
}

/**
 * Query blocked tasks and QC queue from the task database
 */
async function getTaskData(workspaceId: number) {
  const db = getDatabase()

  const blocked = db.prepare(`
    SELECT id, title, assigned_to, updated_at
    FROM tasks
    WHERE workspace_id = ? AND status = 'blocked'
    ORDER BY updated_at DESC
    LIMIT 20
  `).all(workspaceId) as Array<{ id: number; title: string; assigned_to: string | null; updated_at: number }>

  const qcQueue = db.prepare(`
    SELECT id, title, assigned_to, updated_at
    FROM tasks
    WHERE workspace_id = ? AND status IN ('review', 'quality_review')
    ORDER BY updated_at DESC
    LIMIT 20
  `).all(workspaceId) as Array<{ id: number; title: string; assigned_to: string | null; updated_at: number }>

  const inProgressRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE workspace_id = ? AND status = 'in_progress'
  `).get(workspaceId) as { count: number }

  return {
    blocked,
    qcQueue,
    inProgressCount: inProgressRow.count,
  }
}

/**
 * Detect active and stale tmux sessions
 */
async function getActiveRuns(): Promise<Array<{ name: string; status: string; lastOutput: string }>> {
  const runs: Array<{ name: string; status: string; lastOutput: string }> = []

  try {
    // Check tmux sessions via the default socket and the user socket
    const sockets = ['/tmp/tmux-1000/default', `${process.env.HOME}/.tmux/sock`]

    for (const sock of sockets) {
      try {
        const sessionList = execSync(
          `tmux -S "${sock}" list-sessions -F "#{session_name}:#{session_activity}" 2>/dev/null`,
          { timeout: 5000, encoding: 'utf-8' }
        ).trim()

        if (!sessionList) continue

        const now = Math.floor(Date.now() / 1000)
        for (const line of sessionList.split('\n')) {
          const [name, activityStr] = line.split(':')
          if (!name) continue
          const activity = parseInt(activityStr || '0', 10)
          const ageSeconds = now - activity
          const isStale = ageSeconds > 1800 // 30 min

          let lastOutput = ''
          try {
            lastOutput = execSync(
              `tmux -S "${sock}" capture-pane -t "${name}" -p 2>/dev/null | tail -3`,
              { timeout: 3000, encoding: 'utf-8' }
            ).trim()
          } catch {
            lastOutput = '(unable to capture)'
          }

          // Truncate long output
          if (lastOutput.length > 200) {
            lastOutput = lastOutput.slice(-200)
          }

          runs.push({
            name,
            status: isStale ? 'stale' : 'active',
            lastOutput,
          })
        }
      } catch {
        // Socket not available, skip
      }
    }
  } catch {
    // tmux not available
  }

  return runs
}

/**
 * Get latest agent status updates from the database
 */
async function getAgentUpdates(workspaceId: number): Promise<OwnerOverview['agentUpdates']> {
  const db = getDatabase()

  const agents = db.prepare(`
    SELECT name, status, last_activity, updated_at
    FROM agents
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
    LIMIT 10
  `).all(workspaceId) as Array<{
    name: string
    status: string
    last_activity: string | null
    updated_at: number
  }>

  return agents.map(a => {
    // Find the agent's current in-progress task
    const currentTask = db.prepare(`
      SELECT title FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(workspaceId, a.name) as { title: string } | undefined

    return {
      agent: a.name,
      status: a.status,
      lastActivity: a.last_activity || `updated ${a.updated_at}`,
      currentTask: currentTask?.title || null,
    }
  })
}
