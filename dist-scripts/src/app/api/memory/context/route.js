"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const memory_utils_1 = require("@/lib/memory-utils");
const logger_1 = require("@/lib/logger");
const MEMORY_PATH = config_1.config.memoryDir;
/**
 * Context injection endpoint — generates a payload for agent session start.
 * Returns workspace tree, recent files, health summary, and maintenance signals.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const limited = (0, rate_limit_1.readLimiter)(request);
    if (limited)
        return limited;
    if (!MEMORY_PATH) {
        return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }
    try {
        const payload = await (0, memory_utils_1.generateContextPayload)(MEMORY_PATH);
        return server_1.NextResponse.json(payload);
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Memory context API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
