/**
 * Plan tier limits for soft enforcement.
 * plan_tier values match the tenants.plan_tier column (migration 012).
 */

export interface PlanLimits {
  agents: number
  tasksPerMonth: number
  users: number
}

export interface PlanUsage {
  agents: number
  tasksThisMonth: number
  users: number
}

export interface PlanStatus {
  tier: string
  limits: PlanLimits
  usage: PlanUsage
  /** True when any metric >= 80% of limit */
  softWarning: boolean
  /** True when any metric >= 200% of limit (hard block threshold, future use) */
  hardBlock: boolean
  warnings: Array<{ metric: string; used: number; limit: number; pct: number }>
}

// soft warning at 80%, hard block at 200%
const SOFT_THRESHOLD = 0.8
const HARD_THRESHOLD = 2.0

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  starter: { agents: 3, tasksPerMonth: 500, users: 2 },
  pro: { agents: 15, tasksPerMonth: 5000, users: 10 },
  scale: { agents: Infinity, tasksPerMonth: Infinity, users: Infinity },
  standard: { agents: 15, tasksPerMonth: 5000, users: 10 }, // legacy default
}

export function getPlanLimits(tier: string): PlanLimits {
  return PLAN_LIMITS[tier?.toLowerCase()] ?? PLAN_LIMITS.standard
}

export function evaluatePlanStatus(tier: string, usage: PlanUsage): PlanStatus {
  const limits = getPlanLimits(tier)
  const warnings: PlanStatus['warnings'] = []

  function check(metric: string, used: number, limit: number) {
    if (!isFinite(limit) || limit <= 0) return
    const pct = used / limit
    if (pct >= SOFT_THRESHOLD) warnings.push({ metric, used, limit, pct })
  }

  check('agents', usage.agents, limits.agents)
  check('tasksThisMonth', usage.tasksThisMonth, limits.tasksPerMonth)
  check('users', usage.users, limits.users)

  return {
    tier,
    limits,
    usage,
    softWarning: warnings.some((w) => w.pct < HARD_THRESHOLD),
    hardBlock: warnings.some((w) => w.pct >= HARD_THRESHOLD),
    warnings,
  }
}
