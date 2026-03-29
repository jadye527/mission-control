"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const super_admin_1 = require("@/lib/super-admin");
/**
 * POST /api/super/tenants/[id]/decommission
 * Body: { dry_run?: boolean, remove_linux_user?: boolean, remove_state_dirs?: boolean, reason?: string }
 */
async function POST(request, context) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const params = await context.params;
    const tenantId = Number(params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return server_1.NextResponse.json({ error: 'Invalid tenant id' }, { status: 400 });
    }
    try {
        const body = await request.json().catch(() => ({}));
        const created = (0, super_admin_1.createTenantDecommissionJob)(tenantId, {
            dry_run: body === null || body === void 0 ? void 0 : body.dry_run,
            remove_linux_user: body === null || body === void 0 ? void 0 : body.remove_linux_user,
            remove_state_dirs: body === null || body === void 0 ? void 0 : body.remove_state_dirs,
            reason: body === null || body === void 0 ? void 0 : body.reason,
        }, auth.user.username);
        return server_1.NextResponse.json(created, { status: 201 });
    }
    catch (error) {
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to queue tenant decommission job' }, { status: 400 });
    }
}
