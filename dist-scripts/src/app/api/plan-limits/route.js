"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const auth_2 = require("@/lib/auth");
const plan_limits_1 = require("@/lib/plan-limits");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/plan-limits
 * Returns current plan tier, usage, and soft-limit warnings for the caller's tenant.
 */
async function GET(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const tenantId = (0, auth_2.getTenantIdFromRequest)(request);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        // Fetch plan_tier from tenants table
        const tenant = db
            .prepare('SELECT plan_tier FROM tenants WHERE id = ? LIMIT 1')
            .get(tenantId);
        const tier = (_b = tenant === null || tenant === void 0 ? void 0 : tenant.plan_tier) !== null && _b !== void 0 ? _b : 'standard';
        // Count active agents in this workspace
        const { count: agentCount } = db
            .prepare('SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?')
            .get(workspaceId);
        // Count tasks created this calendar month
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthStartTs = Math.floor(monthStart.getTime() / 1000);
        const { count: taskCount } = db
            .prepare('SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ? AND created_at >= ?')
            .get(workspaceId, monthStartTs);
        // Count users in this workspace (via memberships if available, else users table)
        let userCount = 1;
        try {
            const row = db
                .prepare('SELECT COUNT(*) as count FROM workspace_memberships WHERE workspace_id = ?')
                .get(workspaceId);
            if (row)
                userCount = row.count;
        }
        catch (_c) {
            // workspace_memberships may not exist in all deployments — default to 1
        }
        const status = (0, plan_limits_1.evaluatePlanStatus)(tier, {
            agents: agentCount,
            tasksThisMonth: taskCount,
            users: userCount,
        });
        return server_1.NextResponse.json(status);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/plan-limits error');
        return server_1.NextResponse.json({ error: 'Failed to load plan limits' }, { status: 500 });
    }
}
