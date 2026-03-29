"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const gnap_sync_1 = require("@/lib/gnap-sync");
/**
 * GET /api/gnap — GNAP sync status
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const gnapConfig = config_1.config.gnap;
    if (!gnapConfig.enabled) {
        return server_1.NextResponse.json({ enabled: false });
    }
    try {
        const status = (0, gnap_sync_1.getGnapStatus)(gnapConfig.repoPath);
        return server_1.NextResponse.json(Object.assign({ enabled: true, repoPath: gnapConfig.repoPath, autoSync: gnapConfig.autoSync }, status));
    }
    catch (err) {
        logger_1.logger.error({ err }, 'GET /api/gnap error');
        return server_1.NextResponse.json({ error: 'Failed to get GNAP status' }, { status: 500 });
    }
}
/**
 * POST /api/gnap?action=init|sync — GNAP management
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const gnapConfig = config_1.config.gnap;
    if (!gnapConfig.enabled) {
        return server_1.NextResponse.json({ error: 'GNAP is not enabled' }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    try {
        switch (action) {
            case 'init': {
                (0, gnap_sync_1.initGnapRepo)(gnapConfig.repoPath);
                const status = (0, gnap_sync_1.getGnapStatus)(gnapConfig.repoPath);
                return server_1.NextResponse.json(Object.assign({ success: true }, status));
            }
            case 'sync': {
                const result = (0, gnap_sync_1.syncGnap)(gnapConfig.repoPath);
                return server_1.NextResponse.json(Object.assign({ success: true }, result));
            }
            default:
                return server_1.NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    }
    catch (err) {
        logger_1.logger.error({ err, action }, 'POST /api/gnap error');
        return server_1.NextResponse.json({ error: 'GNAP operation failed' }, { status: 500 });
    }
}
