"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const agent_sync_1 = require("@/lib/agent-sync");
const local_agent_sync_1 = require("@/lib/local-agent-sync");
const logger_1 = require("@/lib/logger");
/**
 * POST /api/agents/sync - Trigger agent config sync
 * ?source=local triggers local disk scan instead of openclaw.json sync.
 * Requires admin role.
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    try {
        if (source === 'local') {
            const result = await (0, local_agent_sync_1.syncLocalAgents)();
            return server_1.NextResponse.json(result);
        }
        const result = await (0, agent_sync_1.syncAgentsFromConfig)(auth.user.username);
        if (result.error) {
            return server_1.NextResponse.json({ error: result.error }, { status: 500 });
        }
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/agents/sync error');
        return server_1.NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
    }
}
/**
 * GET /api/agents/sync - Preview diff between openclaw.json and MC
 * Shows what would change without writing.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const diff = await (0, agent_sync_1.previewSyncDiff)();
        return server_1.NextResponse.json(diff);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/sync error');
        return server_1.NextResponse.json({ error: error.message || 'Preview failed' }, { status: 500 });
    }
}
