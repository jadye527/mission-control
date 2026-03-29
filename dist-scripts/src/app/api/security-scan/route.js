"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const security_scan_1 = require("@/lib/security-scan");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        return server_1.NextResponse.json((0, security_scan_1.runSecurityScan)());
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Security scan error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
