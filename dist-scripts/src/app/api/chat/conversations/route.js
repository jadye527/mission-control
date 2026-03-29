"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/chat/conversations - List conversations derived from messages
 * Query params: agent (filter by participant), limit, offset
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const { searchParams } = new URL(request.url);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const agent = searchParams.get('agent');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
        const offset = parseInt(searchParams.get('offset') || '0');
        let query;
        const params = [];
        if (agent) {
            // Get conversations where this agent is a participant
            query = `
        SELECT
          m.conversation_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          COUNT(DISTINCT m.from_agent) + COUNT(DISTINCT CASE WHEN m.to_agent IS NOT NULL THEN m.to_agent END) as participant_count,
          SUM(CASE WHEN m.to_agent = ? AND m.read_at IS NULL THEN 1 ELSE 0 END) as unread_count
        FROM messages m
        WHERE m.workspace_id = ? AND (m.from_agent = ? OR m.to_agent = ? OR m.to_agent IS NULL)
        GROUP BY m.conversation_id
        ORDER BY last_message_at DESC
        LIMIT ? OFFSET ?
      `;
            params.push(agent, workspaceId, agent, agent, limit, offset);
        }
        else {
            query = `
        SELECT
          m.conversation_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          COUNT(DISTINCT m.from_agent) + COUNT(DISTINCT CASE WHEN m.to_agent IS NOT NULL THEN m.to_agent END) as participant_count,
          0 as unread_count
        FROM messages m
        WHERE m.workspace_id = ?
        GROUP BY m.conversation_id
        ORDER BY last_message_at DESC
        LIMIT ? OFFSET ?
      `;
            params.push(workspaceId, limit, offset);
        }
        const conversations = db.prepare(query).all(...params);
        // Prepare last message statement once (avoids N+1)
        const lastMsgStmt = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ? AND workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
        const withLastMessage = conversations.map((conv) => {
            const lastMsg = lastMsgStmt.get(conv.conversation_id, workspaceId);
            return Object.assign(Object.assign({}, conv), { last_message: lastMsg
                    ? Object.assign(Object.assign({}, lastMsg), { metadata: lastMsg.metadata ? JSON.parse(lastMsg.metadata) : null }) : null });
        });
        // Get total count for pagination
        let countQuery;
        const countParams = [workspaceId];
        if (agent) {
            countQuery = `
        SELECT COUNT(DISTINCT m.conversation_id) as total
        FROM messages m
        WHERE m.workspace_id = ? AND (m.from_agent = ? OR m.to_agent = ? OR m.to_agent IS NULL)
      `;
            countParams.push(agent, agent);
        }
        else {
            countQuery = 'SELECT COUNT(DISTINCT conversation_id) as total FROM messages WHERE workspace_id = ?';
        }
        const countRow = db.prepare(countQuery).get(...countParams);
        return server_1.NextResponse.json({ conversations: withLastMessage, total: countRow.total, page: Math.floor(offset / limit) + 1, limit });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/chat/conversations error');
        return server_1.NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
    }
}
