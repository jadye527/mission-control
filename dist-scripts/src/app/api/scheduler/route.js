"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const scheduler_1 = require("@/lib/scheduler");
/**
 * GET /api/scheduler - Get scheduler status
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json({ tasks: (0, scheduler_1.getSchedulerStatus)() });
}
/**
 * POST /api/scheduler - Manually trigger a scheduled task
 * Body: { task_id: 'auto_backup' | 'auto_cleanup' | 'agent_heartbeat' }
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const taskId = typeof (body === null || body === void 0 ? void 0 : body.task_id) === 'string' ? body.task_id : '';
    const allowedTaskIds = new Set((0, scheduler_1.getSchedulerStatus)().map((task) => task.id));
    if (!taskId || !allowedTaskIds.has(taskId)) {
        return server_1.NextResponse.json({
            error: `task_id required: ${Array.from(allowedTaskIds).join(', ')}`,
        }, { status: 400 });
    }
    const result = await (0, scheduler_1.triggerTask)(taskId);
    return server_1.NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
