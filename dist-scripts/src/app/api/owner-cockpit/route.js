"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const owner_cockpit_1 = require("@/lib/owner-cockpit");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const data = await (0, owner_cockpit_1.collectOwnerCockpitData)();
        return server_1.NextResponse.json(data);
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/owner-cockpit error');
        return server_1.NextResponse.json({ error: 'Failed to load owner cockpit metrics' }, { status: 500 });
    }
}
