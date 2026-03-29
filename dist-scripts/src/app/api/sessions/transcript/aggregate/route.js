"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const sessions_1 = require("@/lib/sessions");
const transcript_parser_1 = require("@/lib/transcript-parser");
/**
 * GET /api/sessions/transcript/aggregate?limit=100&since=<unix-ms>
 *
 * Fan out to all active session JSONL files on disk, parse, merge into
 * a single chronological event stream for the agent-feed panel.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 500);
    const since = parseInt(searchParams.get('since') || '0', 10) || 0;
    const stateDir = config_1.config.openclawStateDir;
    if (!stateDir) {
        return server_1.NextResponse.json({ events: [], sessionCount: 0 });
    }
    const sessions = (0, sessions_1.getAllGatewaySessions)();
    const allEvents = [];
    for (const session of sessions) {
        if (!session.sessionId)
            continue;
        const raw = (0, transcript_parser_1.readSessionJsonl)(stateDir, session.agent, session.sessionId);
        if (!raw)
            continue;
        const messages = (0, transcript_parser_1.parseJsonlTranscript)(raw, 500);
        let lineIndex = 0;
        for (const msg of messages) {
            const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : session.updatedAt;
            if (since && ts <= since) {
                lineIndex++;
                continue;
            }
            for (const part of msg.parts) {
                allEvents.push(partToEvent(part, msg.role, ts, session.key, session.agent, lineIndex));
                lineIndex++;
            }
        }
    }
    // Sort chronologically (newest last), take the last `limit` entries
    allEvents.sort((a, b) => a.ts - b.ts);
    const trimmed = allEvents.slice(-limit);
    return server_1.NextResponse.json({
        events: trimmed,
        sessionCount: sessions.length,
    });
}
function partToEvent(part, role, ts, sessionKey, agentName, lineIndex) {
    const id = `tx-${sessionKey}-${lineIndex}`;
    switch (part.type) {
        case 'text':
            return { id, ts, sessionKey, agentName, role, type: 'text', content: part.text.slice(0, 500) };
        case 'thinking':
            return { id, ts, sessionKey, agentName, role, type: 'thinking', content: part.thinking.slice(0, 300) };
        case 'tool_use':
            return { id, ts, sessionKey, agentName, role, type: 'tool_use', content: part.name, metadata: { toolId: part.id, input: part.input } };
        case 'tool_result':
            return { id, ts, sessionKey, agentName, role, type: 'tool_result', content: part.content.slice(0, 500), metadata: { toolUseId: part.toolUseId, isError: part.isError } };
    }
}
exports.dynamic = 'force-dynamic';
