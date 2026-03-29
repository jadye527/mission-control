"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PATCH = PATCH;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/chat/messages/[id] - Get a single message
 */
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const message = db
            .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
            .get(parseInt(id), workspaceId);
        if (!message) {
            return server_1.NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }
        return server_1.NextResponse.json({
            message: Object.assign(Object.assign({}, message), { metadata: message.metadata ? JSON.parse(message.metadata) : null })
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/chat/messages/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to fetch message' }, { status: 500 });
    }
}
/**
 * PATCH /api/chat/messages/[id] - Mark message as read
 */
async function PATCH(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { id } = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const message = db
            .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
            .get(parseInt(id), workspaceId);
        if (!message) {
            return server_1.NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }
        if (body.read) {
            const now = Math.floor(Date.now() / 1000);
            db.prepare('UPDATE messages SET read_at = ? WHERE id = ? AND workspace_id = ?').run(now, parseInt(id), workspaceId);
        }
        const updated = db
            .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
            .get(parseInt(id), workspaceId);
        return server_1.NextResponse.json({
            message: Object.assign(Object.assign({}, updated), { metadata: updated.metadata ? JSON.parse(updated.metadata) : null })
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PATCH /api/chat/messages/[id] error');
        return server_1.NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
    }
}
