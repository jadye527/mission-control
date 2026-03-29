"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const sessions_1 = require("@/lib/sessions");
const claude_sessions_1 = require("@/lib/claude-sessions");
const codex_sessions_1 = require("@/lib/codex-sessions");
const hermes_sessions_1 = require("@/lib/hermes-sessions");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const LOCAL_SESSION_ACTIVE_WINDOW_MS = 90 * 60 * 1000;
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const gatewaySessions = (0, sessions_1.getAllGatewaySessions)();
        const mappedGatewaySessions = mapGatewaySessions(gatewaySessions);
        // Always include local sessions alongside gateway sessions
        await (0, claude_sessions_1.syncClaudeSessions)();
        const claudeSessions = getLocalClaudeSessions();
        const codexSessions = getLocalCodexSessions();
        const hermesSessions = getLocalHermesSessions();
        const localMerged = mergeLocalSessions(claudeSessions, codexSessions, hermesSessions);
        if (mappedGatewaySessions.length === 0 && localMerged.length === 0) {
            return server_1.NextResponse.json({ sessions: [] });
        }
        const merged = dedupeAndSortSessions([...mappedGatewaySessions, ...localMerged]);
        return server_1.NextResponse.json({ sessions: merged });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Sessions API error');
        return server_1.NextResponse.json({ sessions: [] });
    }
}
const VALID_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const VALID_VERBOSE_LEVELS = ['off', 'on', 'full'];
const VALID_REASONING_LEVELS = ['off', 'on', 'stream'];
const SESSION_KEY_RE = /^[a-zA-Z0-9:_.-]+$/;
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');
        const body = await request.json();
        const { sessionKey } = body;
        if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
            return server_1.NextResponse.json({ error: 'Invalid session key' }, { status: 400 });
        }
        let rpcMethod;
        let rpcParams;
        let logDetail;
        switch (action) {
            case 'set-thinking': {
                const { level } = body;
                if (!VALID_THINKING_LEVELS.includes(level)) {
                    return server_1.NextResponse.json({ error: `Invalid thinking level. Must be: ${VALID_THINKING_LEVELS.join(', ')}` }, { status: 400 });
                }
                rpcMethod = 'session_setThinking';
                rpcParams = { sessionKey, level };
                logDetail = `Set thinking=${level} on ${sessionKey}`;
                break;
            }
            case 'set-verbose': {
                const { level } = body;
                if (!VALID_VERBOSE_LEVELS.includes(level)) {
                    return server_1.NextResponse.json({ error: `Invalid verbose level. Must be: ${VALID_VERBOSE_LEVELS.join(', ')}` }, { status: 400 });
                }
                rpcMethod = 'session_setVerbose';
                rpcParams = { sessionKey, level };
                logDetail = `Set verbose=${level} on ${sessionKey}`;
                break;
            }
            case 'set-reasoning': {
                const { level } = body;
                if (!VALID_REASONING_LEVELS.includes(level)) {
                    return server_1.NextResponse.json({ error: `Invalid reasoning level. Must be: ${VALID_REASONING_LEVELS.join(', ')}` }, { status: 400 });
                }
                rpcMethod = 'session_setReasoning';
                rpcParams = { sessionKey, level };
                logDetail = `Set reasoning=${level} on ${sessionKey}`;
                break;
            }
            case 'set-label': {
                const { label } = body;
                if (typeof label !== 'string' || label.length > 100) {
                    return server_1.NextResponse.json({ error: 'Label must be a string up to 100 characters' }, { status: 400 });
                }
                rpcMethod = 'session_setLabel';
                rpcParams = { sessionKey, label };
                logDetail = `Set label="${label}" on ${sessionKey}`;
                break;
            }
            default:
                return server_1.NextResponse.json({ error: 'Invalid action. Must be: set-thinking, set-verbose, set-reasoning, set-label' }, { status: 400 });
        }
        const result = await (0, openclaw_gateway_1.callOpenClawGateway)(rpcMethod, rpcParams, 10000);
        db_1.db_helpers.logActivity('session_control', 'session', 0, auth.user.username, logDetail, { session_key: sessionKey, action });
        return server_1.NextResponse.json({ success: true, action, sessionKey, result });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Session POST error');
        return server_1.NextResponse.json({ error: error.message || 'Session action failed' }, { status: 500 });
    }
}
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const body = await request.json();
        const { sessionKey } = body;
        if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
            return server_1.NextResponse.json({ error: 'Invalid session key' }, { status: 400 });
        }
        const result = await (0, openclaw_gateway_1.callOpenClawGateway)('session_delete', { sessionKey }, 10000);
        db_1.db_helpers.logActivity('session_control', 'session', 0, auth.user.username, `Deleted session ${sessionKey}`, { session_key: sessionKey, action: 'delete' });
        return server_1.NextResponse.json({ success: true, sessionKey, result });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Session DELETE error');
        return server_1.NextResponse.json({ error: error.message || 'Session deletion failed' }, { status: 500 });
    }
}
function mapGatewaySessions(gatewaySessions) {
    // Deduplicate by sessionId — OpenClaw tracks cron runs under the same
    // session ID as the parent session, causing duplicate React keys (#80).
    // Keep the most recently updated entry when duplicates exist.
    const sessionMap = new Map();
    for (const s of gatewaySessions) {
        const id = s.sessionId || `${s.agent}:${s.key}`;
        const existing = sessionMap.get(id);
        if (!existing || s.updatedAt > existing.updatedAt) {
            sessionMap.set(id, s);
        }
    }
    return Array.from(sessionMap.values()).map((s) => {
        const total = s.totalTokens || 0;
        const context = s.contextTokens || 35000;
        const pct = context > 0 ? Math.round((total / context) * 100) : 0;
        return {
            id: s.sessionId || `${s.agent}:${s.key}`,
            key: s.key,
            agent: s.agent,
            kind: s.chatType || 'unknown',
            age: formatAge(s.updatedAt),
            model: s.model,
            tokens: `${formatTokens(total)}/${formatTokens(context)} (${pct}%)`,
            channel: s.channel,
            flags: [],
            active: s.active,
            startTime: s.updatedAt,
            lastActivity: s.updatedAt,
            source: 'gateway',
        };
    });
}
/** Read Claude Code sessions from the local SQLite database */
function getLocalClaudeSessions() {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare('SELECT * FROM claude_sessions ORDER BY last_message_at DESC LIMIT 50').all();
        return rows.map((s) => {
            const total = (s.input_tokens || 0) + (s.output_tokens || 0);
            const lastMsg = s.last_message_at ? new Date(s.last_message_at).getTime() : 0;
            // Trust scanner state first, but fall back to derived recency so UI doesn't
            // show stale "xh ago" when the active flag lags behind disk updates.
            const derivedActive = lastMsg > 0 && (Date.now() - lastMsg) < LOCAL_SESSION_ACTIVE_WINDOW_MS;
            const isActive = s.is_active === 1 || derivedActive;
            const effectiveLastActivity = isActive ? Date.now() : lastMsg;
            return {
                id: s.session_id,
                key: s.project_slug || s.session_id,
                agent: s.project_slug || 'local',
                kind: 'claude-code',
                age: isActive ? 'now' : formatAge(lastMsg),
                model: s.model || 'unknown',
                tokens: `${formatTokens(s.input_tokens || 0)}/${formatTokens(s.output_tokens || 0)}`,
                channel: 'local',
                flags: s.git_branch ? [s.git_branch] : [],
                active: isActive,
                startTime: s.first_message_at ? new Date(s.first_message_at).getTime() : 0,
                lastActivity: effectiveLastActivity,
                source: 'local',
                userMessages: s.user_messages || 0,
                assistantMessages: s.assistant_messages || 0,
                toolUses: s.tool_uses || 0,
                estimatedCost: s.estimated_cost || 0,
                lastUserPrompt: s.last_user_prompt || null,
                workingDir: s.project_path || null,
            };
        });
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to read local Claude sessions');
        return [];
    }
}
function getLocalCodexSessions() {
    try {
        const rows = (0, codex_sessions_1.scanCodexSessions)(100);
        return rows.map((s) => {
            const total = s.totalTokens || (s.inputTokens + s.outputTokens);
            const lastMsg = s.lastMessageAt ? new Date(s.lastMessageAt).getTime() : 0;
            const firstMsg = s.firstMessageAt ? new Date(s.firstMessageAt).getTime() : 0;
            const effectiveLastActivity = s.isActive ? Date.now() : lastMsg;
            return {
                id: s.sessionId,
                key: s.projectSlug || s.sessionId,
                agent: s.projectSlug || 'codex-local',
                kind: 'codex-cli',
                age: s.isActive ? 'now' : formatAge(lastMsg),
                model: s.model || 'codex',
                tokens: `${formatTokens(s.inputTokens || 0)}/${formatTokens(s.outputTokens || 0)}`,
                channel: 'local',
                flags: [],
                active: s.isActive,
                startTime: firstMsg,
                lastActivity: effectiveLastActivity,
                source: 'local',
                userMessages: s.userMessages || 0,
                assistantMessages: s.assistantMessages || 0,
                toolUses: 0,
                estimatedCost: 0,
                lastUserPrompt: null,
                totalTokens: total,
                workingDir: s.projectPath || null,
            };
        });
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to read local Codex sessions');
        return [];
    }
}
function getLocalHermesSessions() {
    try {
        const rows = (0, hermes_sessions_1.scanHermesSessions)(100);
        return rows.map((s) => {
            const total = s.inputTokens + s.outputTokens;
            const lastMsg = s.lastMessageAt ? new Date(s.lastMessageAt).getTime() : 0;
            const firstMsg = s.firstMessageAt ? new Date(s.firstMessageAt).getTime() : 0;
            const effectiveLastActivity = s.isActive ? Date.now() : lastMsg;
            return {
                id: s.sessionId,
                key: s.title || s.sessionId,
                agent: 'hermes',
                kind: 'hermes',
                age: s.isActive ? 'now' : formatAge(lastMsg),
                model: s.model || 'hermes',
                tokens: `${formatTokens(s.inputTokens)}/${formatTokens(s.outputTokens)}`,
                channel: s.source || 'cli',
                flags: s.source && s.source !== 'cli' ? [s.source] : [],
                active: s.isActive,
                startTime: firstMsg,
                lastActivity: effectiveLastActivity,
                source: 'local',
                userMessages: s.messageCount,
                assistantMessages: 0,
                toolUses: s.toolCallCount,
                estimatedCost: 0,
                lastUserPrompt: s.title || null,
                totalTokens: total,
                workingDir: null,
            };
        });
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to read local Hermes sessions');
        return [];
    }
}
function mergeLocalSessions(claudeSessions, codexSessions, hermesSessions = []) {
    const merged = [...claudeSessions, ...codexSessions, ...hermesSessions];
    return dedupeAndSortSessions(merged);
}
function dedupeAndSortSessions(merged) {
    const deduped = new Map();
    for (const session of merged) {
        const id = String((session === null || session === void 0 ? void 0 : session.id) || '');
        const source = String((session === null || session === void 0 ? void 0 : session.source) || '');
        const key = `${source}:${id}`;
        if (!id)
            continue;
        const existing = deduped.get(key);
        const currentActivity = Number((session === null || session === void 0 ? void 0 : session.lastActivity) || 0);
        const existingActivity = Number((existing === null || existing === void 0 ? void 0 : existing.lastActivity) || 0);
        if (!existing || currentActivity > existingActivity)
            deduped.set(key, session);
    }
    return Array.from(deduped.values())
        .sort((a, b) => Number((b === null || b === void 0 ? void 0 : b.lastActivity) || 0) - Number((a === null || a === void 0 ? void 0 : a.lastActivity) || 0))
        .slice(0, 100);
}
function formatTokens(n) {
    if (n >= 1000000)
        return `${(n / 1000000).toFixed(1)}m`;
    if (n >= 1000)
        return `${Math.round(n / 1000)}k`;
    return String(n);
}
function formatAge(timestamp) {
    if (!timestamp)
        return '-';
    const diff = Date.now() - timestamp;
    if (diff <= 0)
        return 'now';
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}d`;
    if (hours > 0)
        return `${hours}h`;
    return `${mins}m`;
}
exports.dynamic = 'force-dynamic';
