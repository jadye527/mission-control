"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const hermes_tasks_1 = require("@/lib/hermes-tasks");
/**
 * GET /api/hermes/tasks — Returns Hermes cron jobs
 * Read-only bridge: MC reads from ~/.hermes/cron/
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const force = request.nextUrl.searchParams.get('force') === 'true';
    const result = (0, hermes_tasks_1.getHermesTasks)(force);
    return server_1.NextResponse.json(result);
}
