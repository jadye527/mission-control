"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const command_1 = require("@/lib/command");
const sessions_1 = require("@/lib/sessions");
const event_bus_1 = require("@/lib/event-bus");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const injection_guard_1 = require("@/lib/injection-guard");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
const coordinator_routing_1 = require("@/lib/coordinator-routing");
const COORDINATOR_AGENT = String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
    'coordinator';
function parseGatewayJson(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed)
        return null;
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < start)
        return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1));
    }
    catch (_a) {
        return null;
    }
}
function toGatewayAttachments(value) {
    if (!Array.isArray(value))
        return undefined;
    const attachments = value.flatMap((entry) => {
        const file = entry;
        if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string')
            return [];
        const match = /^data:([^;]+);base64,(.+)$/.exec(file.dataUrl);
        if (!match)
            return [];
        if (!match[1].startsWith('image/'))
            return [];
        return [{
                type: 'image',
                mimeType: match[1],
                fileName: typeof file.name === 'string' ? file.name : undefined,
                content: match[2],
            }];
    });
    return attachments.length > 0 ? attachments : undefined;
}
function safeParseMetadata(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch (_a) {
        return null;
    }
}
function createChatReply(db, workspaceId, conversationId, fromAgent, toAgent, content, messageType = 'status', metadata = null) {
    const replyInsert = db
        .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
        .run(conversationId, fromAgent, toAgent, content, messageType, metadata ? JSON.stringify(metadata) : null, workspaceId);
    const row = db
        .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
        .get(replyInsert.lastInsertRowid, workspaceId);
    event_bus_1.eventBus.broadcast('chat.message', Object.assign(Object.assign({}, row), { metadata: safeParseMetadata(row.metadata) }));
}
function extractReplyText(waitPayload) {
    if (!waitPayload || typeof waitPayload !== 'object')
        return null;
    const directCandidates = [
        waitPayload.text,
        waitPayload.message,
        waitPayload.response,
        waitPayload.output,
        waitPayload.result,
    ];
    for (const value of directCandidates) {
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    if (typeof waitPayload.output === 'object' && waitPayload.output) {
        const nested = [
            waitPayload.output.text,
            waitPayload.output.message,
            waitPayload.output.content,
        ];
        for (const value of nested) {
            if (typeof value === 'string' && value.trim())
                return value.trim();
        }
    }
    if (Array.isArray(waitPayload.output)) {
        const parts = [];
        for (const item of waitPayload.output) {
            if (!item || typeof item !== 'object')
                continue;
            if (typeof item.text === 'string' && item.text.trim())
                parts.push(item.text.trim());
            if (item.type === 'message' && Array.isArray(item.content)) {
                for (const block of item.content) {
                    if (!block || typeof block !== 'object')
                        continue;
                    const blockType = String(block.type || '');
                    if ((blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') && typeof block.text === 'string' && block.text.trim()) {
                        parts.push(block.text.trim());
                    }
                }
            }
        }
        if (parts.length > 0)
            return parts.join('\n').slice(0, 8000);
    }
    return null;
}
function normalizeToolEvent(raw) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!raw || typeof raw !== 'object')
        return null;
    const name = String(raw.name || raw.tool || raw.toolName || raw.function || raw.call || '').trim();
    if (!name)
        return null;
    const inputRaw = (_c = (_b = (_a = raw.input) !== null && _a !== void 0 ? _a : raw.args) !== null && _b !== void 0 ? _b : raw.arguments) !== null && _c !== void 0 ? _c : raw.params;
    const outputRaw = (_e = (_d = raw.output) !== null && _d !== void 0 ? _d : raw.result) !== null && _e !== void 0 ? _e : raw.response;
    const statusRaw = (_h = (_g = (_f = raw.status) !== null && _f !== void 0 ? _f : (raw.isError === true ? 'error' : undefined)) !== null && _g !== void 0 ? _g : (raw.ok === false ? 'error' : undefined)) !== null && _h !== void 0 ? _h : (raw.success === true ? 'ok' : undefined);
    const input = typeof inputRaw === 'string'
        ? inputRaw.slice(0, 2000)
        : inputRaw !== undefined
            ? JSON.stringify(inputRaw).slice(0, 2000)
            : undefined;
    const output = typeof outputRaw === 'string'
        ? outputRaw.slice(0, 4000)
        : outputRaw !== undefined
            ? JSON.stringify(outputRaw).slice(0, 4000)
            : undefined;
    const status = statusRaw !== undefined ? String(statusRaw).slice(0, 60) : undefined;
    return { name, input, output, status };
}
function extractToolEvents(waitPayload) {
    var _a, _b, _c;
    if (!waitPayload || typeof waitPayload !== 'object')
        return [];
    const candidates = [
        waitPayload.toolCalls,
        waitPayload.tools,
        waitPayload.calls,
        waitPayload.events,
        (_a = waitPayload.output) === null || _a === void 0 ? void 0 : _a.toolCalls,
        (_b = waitPayload.output) === null || _b === void 0 ? void 0 : _b.tools,
        (_c = waitPayload.output) === null || _c === void 0 ? void 0 : _c.events,
    ];
    const events = [];
    for (const list of candidates) {
        if (!Array.isArray(list))
            continue;
        for (const item of list) {
            const evt = normalizeToolEvent(item);
            if (evt)
                events.push(evt);
            if (events.length >= 20)
                return events;
        }
    }
    // OpenAI Responses-style output array
    if (Array.isArray(waitPayload.output)) {
        for (const item of waitPayload.output) {
            if (!item || typeof item !== 'object')
                continue;
            const itemType = String(item.type || '').toLowerCase();
            if (itemType === 'function_call' || itemType === 'tool_call') {
                const evt = normalizeToolEvent({
                    name: item.name || item.tool_name || item.toolName,
                    arguments: item.arguments || item.input,
                    output: item.output || item.result,
                    status: item.status,
                });
                if (evt)
                    events.push(evt);
            }
            else if (itemType === 'message' && Array.isArray(item.content)) {
                for (const block of item.content) {
                    const blockType = String((block === null || block === void 0 ? void 0 : block.type) || '').toLowerCase();
                    if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'function_call') {
                        const evt = normalizeToolEvent(block);
                        if (evt)
                            events.push(evt);
                    }
                }
            }
            if (events.length >= 20)
                return events;
        }
    }
    return events;
}
/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
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
        const conversation_id = searchParams.get('conversation_id');
        const from_agent = searchParams.get('from_agent');
        const to_agent = searchParams.get('to_agent');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
        const offset = parseInt(searchParams.get('offset') || '0');
        const since = searchParams.get('since');
        let query = 'SELECT * FROM messages WHERE workspace_id = ?';
        const params = [workspaceId];
        if (conversation_id) {
            query += ' AND conversation_id = ?';
            params.push(conversation_id);
        }
        if (from_agent) {
            query += ' AND from_agent = ?';
            params.push(from_agent);
        }
        if (to_agent) {
            query += ' AND to_agent = ?';
            params.push(to_agent);
        }
        if (since) {
            query += ' AND created_at > ?';
            params.push(parseInt(since));
        }
        query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const messages = db.prepare(query).all(...params);
        const parsed = messages.map((msg) => (Object.assign(Object.assign({}, msg), { metadata: safeParseMetadata(msg.metadata) })));
        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE workspace_id = ?';
        const countParams = [workspaceId];
        if (conversation_id) {
            countQuery += ' AND conversation_id = ?';
            countParams.push(conversation_id);
        }
        if (from_agent) {
            countQuery += ' AND from_agent = ?';
            countParams.push(from_agent);
        }
        if (to_agent) {
            countQuery += ' AND to_agent = ?';
            countParams.push(to_agent);
        }
        if (since) {
            countQuery += ' AND created_at > ?';
            countParams.push(parseInt(since));
        }
        const countRow = db.prepare(countQuery).get(...countParams);
        return server_1.NextResponse.json({ messages: parsed, total: countRow.total, page: Math.floor(offset / limit) + 1, limit });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/chat/messages error');
        return server_1.NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }
}
/**
 * POST /api/chat/messages - Send a new message
 * Body: { to, content, message_type, conversation_id, metadata }
 * Sender identity is always resolved server-side from authenticated user.
 */
async function POST(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const body = await request.json();
        const requestedFrom = typeof body.from === 'string' ? body.from.trim() : '';
        const isCoordinatorOverride = requestedFrom.toLowerCase() === COORDINATOR_AGENT.toLowerCase();
        const from = isCoordinatorOverride
            ? COORDINATOR_AGENT
            : (auth.user.display_name || auth.user.username || 'system');
        const to = body.to ? body.to.trim() : null;
        const content = (body.content || '').trim();
        const message_type = body.message_type || 'text';
        const conversation_id = body.conversation_id || `conv_${Date.now()}`;
        const metadata = body.metadata || null;
        if (!content) {
            return server_1.NextResponse.json({ error: '"content" is required' }, { status: 400 });
        }
        // Scan content for injection when it will be forwarded to an agent
        if (body.forward && to) {
            const injectionReport = (0, injection_guard_1.scanForInjection)(content, { context: 'prompt' });
            if (!injectionReport.safe) {
                const criticals = injectionReport.matches.filter(m => m.severity === 'critical');
                if (criticals.length > 0) {
                    logger_1.logger.warn({ to, rules: criticals.map(m => m.rule) }, 'Blocked chat message: injection detected');
                    return server_1.NextResponse.json({ error: 'Message blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) }, { status: 422 });
                }
            }
        }
        const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(conversation_id, from, to, content, message_type, metadata ? JSON.stringify(metadata) : null, workspaceId);
        const messageId = result.lastInsertRowid;
        let forwardInfo = null;
        // Log activity
        db_1.db_helpers.logActivity('chat_message', 'message', messageId, from, `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`, { conversation_id, to, message_type }, workspaceId);
        // Create notification for recipient if specified
        if (to) {
            db_1.db_helpers.createNotification(to, 'chat_message', `Message from ${from}`, content.substring(0, 200) + (content.length > 200 ? '...' : ''), 'message', messageId, workspaceId);
            // Optionally forward to agent via gateway
            if (body.forward) {
                forwardInfo = { attempted: true, delivered: false };
                const agent = db
                    .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
                    .get(to, workspaceId);
                const explicitSessionKey = typeof body.sessionKey === 'string' && body.sessionKey
                    ? body.sessionKey
                    : null;
                const sessions = (0, sessions_1.getAllGatewaySessions)();
                const isCoordinatorSend = String(to).toLowerCase() === COORDINATOR_AGENT.toLowerCase();
                const allAgents = isCoordinatorSend
                    ? db
                        .prepare('SELECT name, session_key, config FROM agents WHERE workspace_id = ?')
                        .all(workspaceId)
                    : [];
                const configuredCoordinatorTarget = isCoordinatorSend
                    ? ((_b = db
                        .prepare("SELECT value FROM settings WHERE key = 'chat.coordinator_target_agent'")
                        .get()) === null || _b === void 0 ? void 0 : _b.value) || null
                    : null;
                const coordinatorResolution = (0, coordinator_routing_1.resolveCoordinatorDeliveryTarget)({
                    to: String(to),
                    coordinatorAgent: COORDINATOR_AGENT,
                    directAgent: agent
                        ? {
                            name: String(agent.name || to),
                            session_key: typeof agent.session_key === 'string' ? agent.session_key : null,
                            config: typeof agent.config === 'string' ? agent.config : null,
                        }
                        : null,
                    allAgents,
                    sessions,
                    explicitSessionKey,
                    configuredCoordinatorTarget,
                });
                // Use explicit session key from caller if provided, then DB, then on-disk lookup
                let sessionKey = coordinatorResolution.sessionKey;
                // Fallback: derive session from on-disk gateway session stores
                if (!sessionKey) {
                    const match = sessions.find((s) => s.agent.toLowerCase() === String(to).toLowerCase() ||
                        s.agent.toLowerCase() === coordinatorResolution.deliveryName.toLowerCase() ||
                        s.agent.toLowerCase() === String(coordinatorResolution.openclawAgentId || '').toLowerCase());
                    sessionKey = (match === null || match === void 0 ? void 0 : match.key) || (match === null || match === void 0 ? void 0 : match.sessionId) || null;
                }
                // Prefer configured openclawId when present, fallback to normalized name
                let openclawAgentId = coordinatorResolution.openclawAgentId;
                if (!sessionKey && !openclawAgentId) {
                    forwardInfo.reason = 'no_active_session';
                    // For coordinator messages, emit an immediate visible status reply
                    if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
                        try {
                            createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, 'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.', 'status', { status: 'offline', reason: 'no_active_session' });
                        }
                        catch (e) {
                            logger_1.logger.error({ err: e }, 'Failed to create offline status reply');
                        }
                    }
                }
                else {
                    try {
                        const idempotencyKey = `mc-${messageId}-${Date.now()}`;
                        if (sessionKey) {
                            const acceptedPayload = await (0, openclaw_gateway_1.callOpenClawGateway)('chat.send', {
                                sessionKey,
                                message: content,
                                idempotencyKey,
                                deliver: false,
                                attachments: toGatewayAttachments(body.attachments),
                            }, 12000);
                            const status = String((acceptedPayload === null || acceptedPayload === void 0 ? void 0 : acceptedPayload.status) || '').toLowerCase();
                            forwardInfo.delivered = status === 'started' || status === 'ok' || status === 'in_flight';
                            forwardInfo.session = sessionKey;
                            if (typeof (acceptedPayload === null || acceptedPayload === void 0 ? void 0 : acceptedPayload.runId) === 'string' && acceptedPayload.runId) {
                                forwardInfo.runId = acceptedPayload.runId;
                            }
                        }
                        else {
                            const invokeParams = {
                                message: `Message from ${from}: ${content}`,
                                idempotencyKey,
                                deliver: false,
                            };
                            invokeParams.agentId = openclawAgentId;
                            const invokeResult = await (0, command_1.runOpenClaw)([
                                'gateway',
                                'call',
                                'agent',
                                '--timeout',
                                '10000',
                                '--params',
                                JSON.stringify(invokeParams),
                                '--json',
                            ], { timeoutMs: 12000 });
                            const acceptedPayload = parseGatewayJson(invokeResult.stdout);
                            forwardInfo.delivered = true;
                            forwardInfo.session = openclawAgentId || undefined;
                            if (typeof (acceptedPayload === null || acceptedPayload === void 0 ? void 0 : acceptedPayload.runId) === 'string' && acceptedPayload.runId) {
                                forwardInfo.runId = acceptedPayload.runId;
                            }
                        }
                    }
                    catch (err) {
                        // OpenClaw may return accepted JSON on stdout but still emit a late stderr warning.
                        // Treat accepted runs as successful delivery.
                        const maybeStdout = String((err === null || err === void 0 ? void 0 : err.stdout) || '');
                        const acceptedPayload = parseGatewayJson(maybeStdout);
                        if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
                            forwardInfo.delivered = true;
                            forwardInfo.session = sessionKey || openclawAgentId || undefined;
                            if (typeof (acceptedPayload === null || acceptedPayload === void 0 ? void 0 : acceptedPayload.runId) === 'string' && acceptedPayload.runId) {
                                forwardInfo.runId = acceptedPayload.runId;
                            }
                        }
                        else {
                            forwardInfo.reason = 'gateway_send_failed';
                            logger_1.logger.error({ err }, 'Failed to forward message via gateway');
                            // For coordinator messages, emit visible status when send fails
                            if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
                                try {
                                    createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, 'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.', 'status', { status: 'delivery_failed', reason: 'gateway_send_failed' });
                                }
                                catch (e) {
                                    logger_1.logger.error({ err: e }, 'Failed to create gateway failure status reply');
                                }
                            }
                        }
                    }
                    // Coordinator mode should always show visible coordinator feedback in thread.
                    if (typeof conversation_id === 'string' &&
                        conversation_id.startsWith('coord:') &&
                        forwardInfo.delivered) {
                        try {
                            createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, 'Received. I am coordinating downstream agents now.', 'status', { status: 'accepted', runId: forwardInfo.runId || null });
                        }
                        catch (e) {
                            logger_1.logger.error({ err: e }, 'Failed to create accepted status reply');
                        }
                        // Best effort: wait briefly and surface completion/error feedback.
                        if (forwardInfo.runId) {
                            try {
                                const waitResult = await (0, command_1.runOpenClaw)([
                                    'gateway',
                                    'call',
                                    'agent.wait',
                                    '--timeout',
                                    '8000',
                                    '--params',
                                    JSON.stringify({ runId: forwardInfo.runId, timeoutMs: 6000 }),
                                    '--json',
                                ], { timeoutMs: 9000 });
                                const waitPayload = parseGatewayJson(waitResult.stdout);
                                const waitStatus = String((waitPayload === null || waitPayload === void 0 ? void 0 : waitPayload.status) || '').toLowerCase();
                                const toolEvents = extractToolEvents(waitPayload);
                                if (toolEvents.length > 0) {
                                    for (const evt of toolEvents) {
                                        createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, evt.name, 'tool_call', {
                                            event: 'tool_call',
                                            toolName: evt.name,
                                            input: evt.input || null,
                                            output: evt.output || null,
                                            status: evt.status || null,
                                            runId: forwardInfo.runId || null,
                                        });
                                    }
                                }
                                if (waitStatus === 'error') {
                                    const reason = typeof (waitPayload === null || waitPayload === void 0 ? void 0 : waitPayload.error) === 'string'
                                        ? waitPayload.error
                                        : 'Unknown runtime error';
                                    createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, `I received your message, but execution failed: ${reason}`, 'status', { status: 'error', runId: forwardInfo.runId });
                                }
                                else if (waitStatus === 'timeout') {
                                    createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, 'I received your message and I am still processing it. I will post results as soon as execution completes.', 'status', { status: 'processing', runId: forwardInfo.runId });
                                }
                                else {
                                    const replyText = extractReplyText(waitPayload);
                                    if (replyText) {
                                        createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, replyText, 'text', { status: waitStatus || 'completed', runId: forwardInfo.runId });
                                    }
                                    else {
                                        createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, 'Execution accepted and completed. No textual response payload was returned by the runtime.', 'status', { status: waitStatus || 'completed', runId: forwardInfo.runId });
                                    }
                                }
                            }
                            catch (waitErr) {
                                const maybeWaitStdout = String((waitErr === null || waitErr === void 0 ? void 0 : waitErr.stdout) || '');
                                const maybeWaitStderr = String((waitErr === null || waitErr === void 0 ? void 0 : waitErr.stderr) || '');
                                const waitPayload = parseGatewayJson(maybeWaitStdout);
                                const reason = typeof (waitPayload === null || waitPayload === void 0 ? void 0 : waitPayload.error) === 'string'
                                    ? waitPayload.error
                                    : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim();
                                createChatReply(db, workspaceId, conversation_id, COORDINATOR_AGENT, from, `I received your message, but I could not retrieve completion output yet: ${reason}`, 'status', { status: 'unknown', runId: forwardInfo.runId });
                            }
                        }
                    }
                }
            }
        }
        const created = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?').get(messageId, workspaceId);
        const parsedMessage = Object.assign(Object.assign({}, created), { metadata: Object.assign(Object.assign({}, (safeParseMetadata(created.metadata) || {})), { forwardInfo: forwardInfo || undefined }) });
        // Broadcast to SSE clients
        event_bus_1.eventBus.broadcast('chat.message', parsedMessage);
        return server_1.NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/chat/messages error');
        return server_1.NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
