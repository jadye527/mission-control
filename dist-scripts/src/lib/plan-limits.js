"use strict";
/**
 * Plan tier limits for soft enforcement.
 * plan_tier values match the tenants.plan_tier column (migration 012).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_LIMITS = void 0;
exports.getPlanLimits = getPlanLimits;
exports.evaluatePlanStatus = evaluatePlanStatus;
// soft warning at 80%, hard block at 200%
const SOFT_THRESHOLD = 0.8;
const HARD_THRESHOLD = 2.0;
exports.PLAN_LIMITS = {
    starter: { agents: 3, tasksPerMonth: 500, users: 2 },
    pro: { agents: 15, tasksPerMonth: 5000, users: 10 },
    scale: { agents: Infinity, tasksPerMonth: Infinity, users: Infinity },
    standard: { agents: 15, tasksPerMonth: 5000, users: 10 }, // legacy default
};
function getPlanLimits(tier) {
    var _a;
    return (_a = exports.PLAN_LIMITS[tier === null || tier === void 0 ? void 0 : tier.toLowerCase()]) !== null && _a !== void 0 ? _a : exports.PLAN_LIMITS.standard;
}
function evaluatePlanStatus(tier, usage) {
    const limits = getPlanLimits(tier);
    const warnings = [];
    function check(metric, used, limit) {
        if (!isFinite(limit) || limit <= 0)
            return;
        const pct = used / limit;
        if (pct >= SOFT_THRESHOLD)
            warnings.push({ metric, used, limit, pct });
    }
    check('agents', usage.agents, limits.agents);
    check('tasksThisMonth', usage.tasksThisMonth, limits.tasksPerMonth);
    check('users', usage.users, limits.users);
    return {
        tier,
        limits,
        usage,
        softWarning: warnings.some((w) => w.pct < HARD_THRESHOLD),
        hardBlock: warnings.some((w) => w.pct >= HARD_THRESHOLD),
        warnings,
    };
}
