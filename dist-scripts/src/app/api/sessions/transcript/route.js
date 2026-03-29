"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testables = exports.dynamic = void 0;
exports.GET = GET;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const server_1 = require("next/server");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
function messageTimestampMs(message) {
    if (!message.timestamp)
        return 0;
    const ts = new Date(message.timestamp).getTime();
    return Number.isFinite(ts) ? ts : 0;
}
function listRecentFiles(root, ext, limit) {
    if (!root || !node_fs_1.default.existsSync(root))
        return [];
    const files = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        if (!dir)
            continue;
        let entries = [];
        try {
            entries = node_fs_1.default.readdirSync(dir);
        }
        catch (_a) {
            continue;
        }
        for (const entry of entries) {
            const full = node_path_1.default.join(dir, entry);
            let stat;
            try {
                stat = node_fs_1.default.statSync(full);
            }
            catch (_b) {
                continue;
            }
            if (stat.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (!stat.isFile() || !full.endsWith(ext))
                continue;
            files.push({ path: full, mtimeMs: stat.mtimeMs });
        }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files.slice(0, Math.max(1, limit)).map((f) => f.path);
}
function pushMessage(list, role, parts, timestamp) {
    if (parts.length === 0)
        return;
    list.push({ role, parts, timestamp });
}
function textPart(content, limit = 8000) {
    const text = String(content || '').trim();
    if (!text)
        return null;
    return { type: 'text', text: text.slice(0, limit) };
}
function readClaudeTranscript(sessionId, limit) {
    var _a, _b;
    const root = node_path_1.default.join(config_1.config.claudeHome, 'projects');
    const files = listRecentFiles(root, '.jsonl', 300);
    const out = [];
    for (const file of files) {
        let raw = '';
        try {
            raw = node_fs_1.default.readFileSync(file, 'utf-8');
        }
        catch (_c) {
            continue;
        }
        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch (_d) {
                continue;
            }
            if ((parsed === null || parsed === void 0 ? void 0 : parsed.sessionId) !== sessionId || (parsed === null || parsed === void 0 ? void 0 : parsed.isSidechain))
                continue;
            const ts = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.timestamp) === 'string' ? parsed.timestamp : undefined;
            if ((parsed === null || parsed === void 0 ? void 0 : parsed.type) === 'user') {
                const rawContent = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.message) === null || _a === void 0 ? void 0 : _a.content;
                // Check if this is a tool_result array (not real user input)
                if (Array.isArray(rawContent) && rawContent.some((b) => (b === null || b === void 0 ? void 0 : b.type) === 'tool_result')) {
                    const parts = [];
                    for (const block of rawContent) {
                        if ((block === null || block === void 0 ? void 0 : block.type) === 'tool_result') {
                            const resultContent = typeof block.content === 'string'
                                ? block.content
                                : Array.isArray(block.content)
                                    ? block.content.map((c) => (c === null || c === void 0 ? void 0 : c.text) || '').join('\n')
                                    : '';
                            if (resultContent.trim()) {
                                parts.push({
                                    type: 'tool_result',
                                    toolUseId: block.tool_use_id || '',
                                    content: resultContent.trim().slice(0, 8000),
                                    isError: block.is_error === true,
                                });
                            }
                        }
                    }
                    pushMessage(out, 'system', parts, ts);
                }
                else {
                    const content = typeof rawContent === 'string'
                        ? rawContent
                        : Array.isArray(rawContent)
                            ? rawContent.map((b) => (b === null || b === void 0 ? void 0 : b.text) || '').join('\n').trim()
                            : '';
                    const part = textPart(content);
                    if (part)
                        pushMessage(out, 'user', [part], ts);
                }
            }
            else if ((parsed === null || parsed === void 0 ? void 0 : parsed.type) === 'assistant') {
                const parts = [];
                if (Array.isArray((_b = parsed === null || parsed === void 0 ? void 0 : parsed.message) === null || _b === void 0 ? void 0 : _b.content)) {
                    for (const block of parsed.message.content) {
                        if ((block === null || block === void 0 ? void 0 : block.type) === 'thinking' && typeof (block === null || block === void 0 ? void 0 : block.thinking) === 'string') {
                            const thinking = block.thinking.trim();
                            if (thinking) {
                                parts.push({ type: 'thinking', thinking: thinking.slice(0, 4000) });
                            }
                        }
                        else if ((block === null || block === void 0 ? void 0 : block.type) === 'text' && typeof (block === null || block === void 0 ? void 0 : block.text) === 'string') {
                            const part = textPart(block.text);
                            if (part)
                                parts.push(part);
                        }
                        else if ((block === null || block === void 0 ? void 0 : block.type) === 'tool_use') {
                            parts.push({
                                type: 'tool_use',
                                id: block.id || '',
                                name: block.name || 'unknown',
                                input: JSON.stringify(block.input || {}).slice(0, 500),
                            });
                        }
                    }
                }
                pushMessage(out, 'assistant', parts, ts);
            }
        }
    }
    const sorted = out
        .slice()
        .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));
    return sorted.slice(-limit);
}
function readCodexTranscript(sessionId, limit) {
    var _a;
    const root = node_path_1.default.join(config_1.config.homeDir, '.codex', 'sessions');
    const files = listRecentFiles(root, '.jsonl', 300);
    const out = [];
    for (const file of files) {
        let raw = '';
        try {
            raw = node_fs_1.default.readFileSync(file, 'utf-8');
        }
        catch (_b) {
            continue;
        }
        let matchedSession = file.includes(sessionId);
        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch (_c) {
                continue;
            }
            if (!matchedSession && (parsed === null || parsed === void 0 ? void 0 : parsed.type) === 'session_meta' && ((_a = parsed === null || parsed === void 0 ? void 0 : parsed.payload) === null || _a === void 0 ? void 0 : _a.id) === sessionId) {
                matchedSession = true;
            }
            if (!matchedSession)
                continue;
            const ts = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.timestamp) === 'string' ? parsed.timestamp : undefined;
            if ((parsed === null || parsed === void 0 ? void 0 : parsed.type) === 'response_item') {
                const payload = parsed === null || parsed === void 0 ? void 0 : parsed.payload;
                if ((payload === null || payload === void 0 ? void 0 : payload.type) === 'message') {
                    const role = (payload === null || payload === void 0 ? void 0 : payload.role) === 'assistant' ? 'assistant' : 'user';
                    const parts = [];
                    if (typeof (payload === null || payload === void 0 ? void 0 : payload.content) === 'string') {
                        const part = textPart(payload.content);
                        if (part)
                            parts.push(part);
                    }
                    else if (Array.isArray(payload === null || payload === void 0 ? void 0 : payload.content)) {
                        for (const block of payload.content) {
                            const blockType = String((block === null || block === void 0 ? void 0 : block.type) || '');
                            // Codex CLI emits message content as input_text/output_text.
                            if ((blockType === 'text' || blockType === 'input_text' || blockType === 'output_text')
                                && typeof (block === null || block === void 0 ? void 0 : block.text) === 'string') {
                                const part = textPart(block.text);
                                if (part)
                                    parts.push(part);
                            }
                        }
                    }
                    pushMessage(out, role, parts, ts);
                }
            }
        }
    }
    const sorted = out
        .slice()
        .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));
    return sorted.slice(-limit);
}
function epochSecondsToISO(epoch) {
    if (!epoch || !Number.isFinite(epoch) || epoch <= 0)
        return undefined;
    return new Date(epoch * 1000).toISOString();
}
function readHermesTranscriptFromDbPath(dbPath, sessionId, limit) {
    var _a, _b;
    if (!dbPath || !node_fs_1.default.existsSync(dbPath))
        return [];
    let db = null;
    try {
        db = new better_sqlite3_1.default(dbPath, { readonly: true, fileMustExist: true });
        const rows = db.prepare(`
      SELECT role, content, tool_call_id, tool_calls, tool_name, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(sessionId, Math.max(1, limit * 4));
        const messages = [];
        for (const row of rows) {
            const timestamp = epochSecondsToISO(row.timestamp);
            const parts = [];
            if (row.role === 'assistant' && row.tool_calls) {
                try {
                    const toolCalls = JSON.parse(row.tool_calls);
                    for (const call of toolCalls) {
                        const fn = call.function;
                        const fnRecord = fn && typeof fn === 'object' ? fn : null;
                        const name = typeof (fnRecord === null || fnRecord === void 0 ? void 0 : fnRecord.name) === 'string'
                            ? fnRecord.name
                            : typeof call.tool_name === 'string'
                                ? String(call.tool_name)
                                : typeof row.tool_name === 'string'
                                    ? row.tool_name
                                    : 'tool';
                        const id = typeof call.call_id === 'string'
                            ? call.call_id
                            : typeof call.id === 'string'
                                ? call.id
                                : '';
                        const input = typeof (fnRecord === null || fnRecord === void 0 ? void 0 : fnRecord.arguments) === 'string'
                            ? fnRecord.arguments
                            : JSON.stringify((fnRecord === null || fnRecord === void 0 ? void 0 : fnRecord.arguments) || {});
                        parts.push({
                            type: 'tool_use',
                            id,
                            name,
                            input: String(input).slice(0, 4000),
                        });
                    }
                }
                catch (_c) {
                    // Ignore malformed tool call payloads and fall back to text content if present.
                }
            }
            const text = textPart(row.content);
            if (text)
                parts.push(text);
            if (row.role === 'tool') {
                pushMessage(messages, 'system', [{
                        type: 'tool_result',
                        toolUseId: row.tool_call_id || '',
                        content: String(row.content || '').trim().slice(0, 8000),
                        isError: ((_a = row.content) === null || _a === void 0 ? void 0 : _a.includes('"success": false')) || ((_b = row.content) === null || _b === void 0 ? void 0 : _b.includes('"error"')),
                    }], timestamp);
                continue;
            }
            if (row.role === 'assistant') {
                pushMessage(messages, 'assistant', parts, timestamp);
                continue;
            }
            if (row.role === 'user') {
                pushMessage(messages, 'user', parts, timestamp);
            }
        }
        return messages.slice(-limit);
    }
    catch (error) {
        logger_1.logger.warn({ err: error, dbPath, sessionId }, 'Failed to read Hermes transcript');
        return [];
    }
    finally {
        try {
            db === null || db === void 0 ? void 0 : db.close();
        }
        catch ( /* noop */_d) { /* noop */ }
    }
}
function readHermesTranscript(sessionId, limit) {
    const dbPath = node_path_1.default.join(config_1.config.homeDir, '.hermes', 'state.db');
    return readHermesTranscriptFromDbPath(dbPath, sessionId, limit);
}
/**
 * GET /api/sessions/transcript
 * Query params:
 *   kind=claude-code|codex-cli|hermes
 *   id=<session-id>
 *   limit=40
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams } = new URL(request.url);
        const kind = searchParams.get('kind') || '';
        const sessionId = searchParams.get('id') || '';
        const limit = Math.min(parseInt(searchParams.get('limit') || '40', 10), 200);
        if (!sessionId || (kind !== 'claude-code' && kind !== 'codex-cli' && kind !== 'hermes')) {
            return server_1.NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
        }
        const messages = kind === 'claude-code'
            ? readClaudeTranscript(sessionId, limit)
            : kind === 'codex-cli'
                ? readCodexTranscript(sessionId, limit)
                : readHermesTranscript(sessionId, limit);
        return server_1.NextResponse.json({ messages });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/sessions/transcript error');
        return server_1.NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 });
    }
}
exports.dynamic = 'force-dynamic';
exports.__testables = { readHermesTranscriptFromDbPath };
