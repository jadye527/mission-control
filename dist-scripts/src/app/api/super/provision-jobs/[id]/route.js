"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const super_admin_1 = require("@/lib/super-admin");
/**
 * GET /api/super/provision-jobs/[id] - Get job details and events
 */
async function GET(request, context) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const params = await context.params;
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return server_1.NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    const job = (0, super_admin_1.getProvisionJob)(id);
    if (!job)
        return server_1.NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return server_1.NextResponse.json({ job });
}
/**
 * POST /api/super/provision-jobs/[id] - Change job approval state
 * Body: { action: 'approve' | 'reject' | 'cancel', reason?: string }
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
        const body = await request.json().catch(() => ({}));
        const action = String((body === null || body === void 0 ? void 0 : body.action) || '');
        const reason = (body === null || body === void 0 ? void 0 : body.reason) ? String(body.reason) : undefined;
        if (!['approve', 'reject', 'cancel'].includes(action)) {
            return server_1.NextResponse.json({ error: 'Invalid action. Use approve, reject, or cancel.' }, { status: 400 });
        }
        const job = (0, super_admin_1.transitionProvisionJobStatus)(id, auth.user.username, action, reason);
        return server_1.NextResponse.json({ job });
    }
    catch (error) {
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to update provisioning job state' }, { status: 400 });
    }
}
