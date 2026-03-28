import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getTenantIdFromRequest } from '@/lib/auth'
import { evaluatePlanStatus } from '@/lib/plan-limits'
import { logger } from '@/lib/logger'

/**
 * GET /api/plan-limits
 * Returns current plan tier, usage, and soft-limit warnings for the caller's tenant.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const tenantId = getTenantIdFromRequest(request)
    const workspaceId = auth.user.workspace_id ?? 1

    // Fetch plan_tier from tenants table
    const tenant = db
      .prepare('SELECT plan_tier FROM tenants WHERE id = ? LIMIT 1')
      .get(tenantId) as { plan_tier?: string } | undefined
    const tier = tenant?.plan_tier ?? 'standard'

    // Count active agents in this workspace
    const { count: agentCount } = db
      .prepare('SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?')
      .get(workspaceId) as { count: number }

    // Count tasks created this calendar month
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthStartTs = Math.floor(monthStart.getTime() / 1000)

    const { count: taskCount } = db
      .prepare('SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ? AND created_at >= ?')
      .get(workspaceId, monthStartTs) as { count: number }

    // Count users in this workspace (via memberships if available, else users table)
    let userCount = 1
    try {
      const row = db
        .prepare('SELECT COUNT(*) as count FROM workspace_memberships WHERE workspace_id = ?')
        .get(workspaceId) as { count: number } | undefined
      if (row) userCount = row.count
    } catch {
      // workspace_memberships may not exist in all deployments — default to 1
    }

    const status = evaluatePlanStatus(tier, {
      agents: agentCount,
      tasksThisMonth: taskCount,
      users: userCount,
    })

    return NextResponse.json(status)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/plan-limits error')
    return NextResponse.json({ error: 'Failed to load plan limits' }, { status: 500 })
  }
}
