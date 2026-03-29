"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const transcript_parser_1 = require("@/lib/transcript-parser");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
/**
 * GET /api/sessions/transcript/gateway?key=<session-key>&limit=50
 *
 * Reads the JSONL transcript file for a gateway session directly from disk.
 * OpenClaw stores session transcripts at:
 *   {OPENCLAW_STATE_DIR}/agents/{agent}/sessions/{sessionId}.jsonl
 *
 * The session key (e.g. "agent:jarv:cron:task-name") is used to look up
 * the sessionId from the agent's sessions.json, then the JSONL file is read.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const sessionKey = searchParams.get('key') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    if (!sessionKey) {
        return server_1.NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    const stateDir = config_1.config.openclawStateDir;
    if (!stateDir) {
        return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'OPENCLAW_STATE_DIR not configured' });
    }
    try {
        try {
            const history = await (0, openclaw_gateway_1.callOpenClawGateway)('chat.history', { sessionKey, limit }, 15000);
            const liveMessages = (0, transcript_parser_1.parseGatewayHistoryTranscript)(Array.isArray(history === null || history === void 0 ? void 0 : history.messages) ? history.messages : [], limit);
            if (liveMessages.length > 0) {
                return server_1.NextResponse.json({ messages: liveMessages, source: 'gateway-rpc' });
            }
        }
        catch (rpcErr) {
            logger_1.logger.warn({ err: rpcErr, sessionKey }, 'Gateway chat.history failed, falling back to disk transcript');
        }
        // Extract agent name from session key (e.g. "agent:jarv:main" -> "jarv")
        const agentName = extractAgentName(sessionKey);
        if (!agentName) {
            return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'Could not determine agent from session key' });
        }
        // Look up the sessionId from the agent's sessions.json
        const sessionsFile = node_path_1.default.join(stateDir, 'agents', agentName, 'sessions', 'sessions.json');
        if (!(0, node_fs_1.existsSync)(sessionsFile)) {
            return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'Agent sessions file not found' });
        }
        let sessionsData;
        try {
            sessionsData = JSON.parse((0, node_fs_1.readFileSync)(sessionsFile, 'utf-8'));
        }
        catch (_a) {
            return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'Could not parse sessions.json' });
        }
        const sessionEntry = sessionsData[sessionKey];
        if (!(sessionEntry === null || sessionEntry === void 0 ? void 0 : sessionEntry.sessionId)) {
            return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'Session not found in sessions.json' });
        }
        const sessionId = sessionEntry.sessionId;
        const jsonlPath = node_path_1.default.join(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`);
        if (!(0, node_fs_1.existsSync)(jsonlPath)) {
            return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'Session JSONL file not found' });
        }
        // Read and parse the JSONL file
        const raw = (0, node_fs_1.readFileSync)(jsonlPath, 'utf-8');
        const messages = (0, transcript_parser_1.parseJsonlTranscript)(raw, limit);
        return server_1.NextResponse.json({ messages, source: 'gateway' });
    }
    catch (err) {
        logger_1.logger.warn({ err, sessionKey }, 'Gateway session transcript read failed');
        return server_1.NextResponse.json({ messages: [], source: 'gateway', error: 'Failed to read session transcript' });
    }
}
function extractAgentName(sessionKey) {
    const parts = sessionKey.split(':');
    if (parts.length >= 2 && parts[0] === 'agent') {
        return parts[1];
    }
    return null;
}
exports.dynamic = 'force-dynamic';
