import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

interface RunEntry {
  name: string
  type: 'tmux' | 'cron' | 'collector'
  owner: string | null
  status: 'active' | 'stale' | 'stopped'
  lastProgressTs: number | null
  lastOutput: string
}

interface ActiveRunsResponse {
  runs: RunEntry[]
  counts: {
    active: number
    stale: number
    stopped: number
    total: number
  }
}

const STALE_THRESHOLD_S = 1800 // 30 minutes

/**
 * GET /api/active-runs
 *
 * Returns tmux sessions, cron job status, and background collectors
 * with stale detection (no output > 30min).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [tmuxRuns, cronRuns, collectorRuns] = await Promise.all([
      getTmuxSessions(),
      getCronStatus(),
      getBackgroundCollectors(),
    ])

    const runs = [...tmuxRuns, ...cronRuns, ...collectorRuns]

    const counts = {
      active: runs.filter(r => r.status === 'active').length,
      stale: runs.filter(r => r.status === 'stale').length,
      stopped: runs.filter(r => r.status === 'stopped').length,
      total: runs.length,
    }

    return NextResponse.json({ runs, counts } satisfies ActiveRunsResponse)
  } catch (error) {
    logger.error({ err: error }, 'Active runs API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Detect tmux sessions across known sockets
 */
async function getTmuxSessions(): Promise<RunEntry[]> {
  const runs: RunEntry[] = []
  const sockets = ['/tmp/tmux-1000/default', `${process.env.HOME}/.tmux/sock`]

  for (const sock of sockets) {
    try {
      const raw = execSync(
        `tmux -S "${sock}" list-sessions -F "#{session_name}:#{session_activity}:#{session_created}" 2>/dev/null`,
        { timeout: 5000, encoding: 'utf-8' }
      ).trim()

      if (!raw) continue

      const nowS = Math.floor(Date.now() / 1000)

      for (const line of raw.split('\n')) {
        const parts = line.split(':')
        const name = parts[0]
        if (!name) continue
        const activityTs = parseInt(parts[1] || '0', 10)
        const ageS = nowS - activityTs
        const isStale = ageS > STALE_THRESHOLD_S

        let lastOutput = ''
        try {
          lastOutput = execSync(
            `tmux -S "${sock}" capture-pane -t "${name}" -p 2>/dev/null | tail -5`,
            { timeout: 3000, encoding: 'utf-8' }
          ).trim()
        } catch {
          lastOutput = '(unable to capture)'
        }

        // Truncate
        if (lastOutput.length > 300) {
          lastOutput = lastOutput.slice(-300)
        }

        // Infer owner from session name pattern (e.g. "ralph-collector", "sentinel-scan")
        const owner = inferOwner(name)

        runs.push({
          name: `tmux:${name}`,
          type: 'tmux',
          owner,
          status: isStale ? 'stale' : 'active',
          lastProgressTs: activityTs * 1000,
          lastOutput,
        })
      }
    } catch {
      // Socket not available
    }
  }

  return runs
}

/**
 * Check cron job status from the Mission Control DB
 */
async function getCronStatus(): Promise<RunEntry[]> {
  const runs: RunEntry[] = []

  try {
    const db = getDatabase()
    const cronJobs = db.prepare(`
      SELECT name, schedule, last_run_at, last_result, enabled
      FROM cron_jobs
      WHERE enabled = 1
      ORDER BY last_run_at DESC
      LIMIT 20
    `).all() as Array<{
      name: string
      schedule: string
      last_run_at: number | null
      last_result: string | null
      enabled: number
    }>

    const nowS = Math.floor(Date.now() / 1000)

    for (const job of cronJobs) {
      const lastRunTs = job.last_run_at ? job.last_run_at * 1000 : null
      const ageS = job.last_run_at ? nowS - job.last_run_at : Infinity

      // A cron job is "stale" if it hasn't run in 2 hours (7200s)
      const isStale = ageS > 7200

      runs.push({
        name: `cron:${job.name}`,
        type: 'cron',
        owner: null,
        status: isStale ? 'stale' : 'active',
        lastProgressTs: lastRunTs,
        lastOutput: job.last_result ? job.last_result.slice(0, 200) : '',
      })
    }
  } catch {
    // cron_jobs table may not exist yet
  }

  return runs
}

/**
 * Check for known background collectors (btc-5m-latency, etc.)
 */
async function getBackgroundCollectors(): Promise<RunEntry[]> {
  const runs: RunEntry[] = []

  // Check for known collector PID files or processes
  const collectors = [
    {
      name: 'btc-5m-collector',
      pidPattern: 'btc_5m_latency',
      owner: 'sentinel',
    },
    {
      name: 'content-calendar',
      pidPattern: 'content-calendar',
      owner: 'ralph',
    },
  ]

  for (const col of collectors) {
    try {
      const result = execSync(
        `pgrep -af "${col.pidPattern}" 2>/dev/null | head -3`,
        { timeout: 3000, encoding: 'utf-8' }
      ).trim()

      if (result) {
        runs.push({
          name: `collector:${col.name}`,
          type: 'collector',
          owner: col.owner,
          status: 'active',
          lastProgressTs: Date.now(),
          lastOutput: result.slice(0, 200),
        })
      }
    } catch {
      // Process not running — skip, don't report stopped for known optional processes
    }
  }

  return runs
}

/**
 * Infer agent owner from tmux session name
 */
function inferOwner(sessionName: string): string | null {
  const lower = sessionName.toLowerCase()
  if (lower.includes('ralph')) return 'ralph'
  if (lower.includes('sentinel')) return 'sentinel'
  if (lower.includes('obsidian')) return 'obsidian'
  if (lower.includes('collector') || lower.includes('btc')) return 'sentinel'
  return null
}
