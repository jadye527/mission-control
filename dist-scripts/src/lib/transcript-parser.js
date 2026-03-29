"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJsonlTranscript = parseJsonlTranscript;
exports.parseGatewayHistoryTranscript = parseGatewayHistoryTranscript;
exports.readSessionJsonl = readSessionJsonl;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/i;
function isSilentReplyText(text) {
    return SILENT_REPLY_PATTERN.test(text.trim());
}
function parseTranscriptParts(content) {
    const parts = [];
    if (typeof content === 'string' && content.trim()) {
        if (!isSilentReplyText(content)) {
            parts.push({ type: 'text', text: content.trim().slice(0, 8000) });
        }
        return parts;
    }
    if (!Array.isArray(content))
        return parts;
    for (const block of content) {
        if (!block || typeof block !== 'object')
            continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            if (!isSilentReplyText(block.text)) {
                parts.push({ type: 'text', text: block.text.trim().slice(0, 8000) });
            }
        }
        else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            parts.push({ type: 'thinking', thinking: block.thinking.slice(0, 4000) });
        }
        else if (block.type === 'tool_use') {
            parts.push({
                type: 'tool_use',
                id: block.id || '',
                name: block.name || 'unknown',
                input: JSON.stringify(block.input || {}).slice(0, 500),
            });
        }
        else if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string' ? block.content
                : Array.isArray(block.content) ? block.content.map((c) => (c === null || c === void 0 ? void 0 : c.text) || '').join('\n')
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
    return parts;
}
function normalizeTranscriptMessage(msg, timestamp) {
    var _a;
    const role = (msg === null || msg === void 0 ? void 0 : msg.role) === 'assistant' ? 'assistant'
        : (msg === null || msg === void 0 ? void 0 : msg.role) === 'system' ? 'system'
            : 'user';
    const parts = parseTranscriptParts((_a = msg === null || msg === void 0 ? void 0 : msg.content) !== null && _a !== void 0 ? _a : msg === null || msg === void 0 ? void 0 : msg.text);
    if (parts.length === 0)
        return null;
    return { role, parts, timestamp };
}
/**
 * Parse OpenClaw JSONL transcript format.
 *
 * Each line is a JSON object. We care about entries with type: "message"
 * which contain { message: { role, content } } in Claude API format.
 */
function parseJsonlTranscript(raw, limit) {
    const lines = raw.split('\n').filter(Boolean);
    const out = [];
    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch (_a) {
            continue;
        }
        if (entry.type !== 'message' || !entry.message)
            continue;
        const msg = entry.message;
        const ts = typeof entry.timestamp === 'string' ? entry.timestamp
            : typeof msg.timestamp === 'string' ? msg.timestamp
                : undefined;
        const normalized = normalizeTranscriptMessage(msg, ts);
        if (normalized) {
            out.push(normalized);
        }
    }
    return out.slice(-limit);
}
function parseGatewayHistoryTranscript(messages, limit) {
    const out = [];
    for (const value of messages) {
        const entry = value;
        if (!entry || typeof entry !== 'object')
            continue;
        const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
        const normalized = normalizeTranscriptMessage(entry, timestamp);
        if (normalized) {
            out.push(normalized);
        }
    }
    return out.slice(-limit);
}
/**
 * Read a session's JSONL transcript file from disk given stateDir, agentName, and sessionId.
 */
function readSessionJsonl(stateDir, agentName, sessionId) {
    const jsonlPath = node_path_1.default.join(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`);
    if (!(0, node_fs_1.existsSync)(jsonlPath))
        return null;
    try {
        return (0, node_fs_1.readFileSync)(jsonlPath, 'utf-8');
    }
    catch (_a) {
        return null;
    }
}
