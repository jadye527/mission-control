"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const hermes_memory_1 = require("@/lib/hermes-memory");
/**
 * GET /api/hermes/memory — Returns Hermes memory file contents
 * Read-only bridge: MC reads from ~/.hermes/memories/
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const result = (0, hermes_memory_1.getHermesMemory)();
    return server_1.NextResponse.json(result);
}
