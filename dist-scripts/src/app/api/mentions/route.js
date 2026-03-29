"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const mentions_1 = require("@/lib/mentions");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/mentions - autocomplete source for @mentions (users + agents)
 * Query: q?, limit?, type?
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const { searchParams } = new URL(request.url);
        const q = String(searchParams.get('q') || '').trim().toLowerCase();
        const typeFilter = String(searchParams.get('type') || '').trim().toLowerCase();
        const limitRaw = Number.parseInt(searchParams.get('limit') || '25', 10);
        const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 25, 200));
        let targets = (0, mentions_1.getMentionTargets)(db, workspaceId);
        if (typeFilter === 'user' || typeFilter === 'agent') {
            targets = targets.filter((target) => target.type === typeFilter);
        }
        if (q) {
            targets = targets.filter((target) => (target.handle.includes(q) ||
                target.recipient.toLowerCase().includes(q) ||
                target.display.toLowerCase().includes(q)));
        }
        targets = targets.slice(0, limit);
        return server_1.NextResponse.json({
            mentions: targets,
            total: targets.length,
            q,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/mentions error');
        return server_1.NextResponse.json({ error: 'Failed to fetch mention targets' }, { status: 500 });
    }
}
