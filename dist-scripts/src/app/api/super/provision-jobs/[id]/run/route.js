"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const super_admin_1 = require("@/lib/super-admin");
/**
 * POST /api/super/provision-jobs/[id]/run - Execute an approved provisioning job
 */
async function POST(request, context) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const params = await context.params;
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return server_1.NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    try {
        const job = await (0, super_admin_1.executeProvisionJob)(id, auth.user.username);
        return server_1.NextResponse.json({ job });
    }
    catch (error) {
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to execute provisioning job' }, { status: 400 });
    }
}
