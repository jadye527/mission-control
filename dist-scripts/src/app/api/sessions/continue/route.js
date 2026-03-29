"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const command_1 = require("@/lib/command");
function sanitizePrompt(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * POST /api/sessions/continue
 * Body: { kind: 'claude-code'|'codex-cli', id: string, prompt: string }
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json().catch(() => ({}));
        const kind = body === null || body === void 0 ? void 0 : body.kind;
        const sessionId = typeof (body === null || body === void 0 ? void 0 : body.id) === 'string' ? body.id.trim() : '';
        const prompt = sanitizePrompt(body === null || body === void 0 ? void 0 : body.prompt);
        if (!sessionId || !/^[a-zA-Z0-9._:-]+$/.test(sessionId)) {
            return server_1.NextResponse.json({ error: 'Invalid session id' }, { status: 400 });
        }
        if (kind !== 'claude-code' && kind !== 'codex-cli') {
            return server_1.NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
        }
        if (!prompt || prompt.length > 6000) {
            return server_1.NextResponse.json({ error: 'prompt is required (max 6000 chars)' }, { status: 400 });
        }
        let reply = '';
        if (kind === 'claude-code') {
            const result = await (0, command_1.runCommand)('claude', ['--print', '--resume', sessionId, prompt], {
                timeoutMs: 180000,
            });
            reply = (result.stdout || '').trim() || (result.stderr || '').trim();
        }
        else {
            const outputPath = node_path_1.default.join('/tmp', `mc-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
            try {
                await (0, command_1.runCommand)('codex', ['exec', 'resume', sessionId, prompt, '--skip-git-repo-check', '-o', outputPath], {
                    timeoutMs: 180000,
                });
            }
            finally {
                // Read after run attempt either way for best-effort output
            }
            try {
                reply = (await node_fs_1.promises.readFile(outputPath, 'utf-8')).trim();
            }
            catch (_a) {
                reply = '';
            }
            try {
                await node_fs_1.promises.unlink(outputPath);
            }
            catch (_b) {
                // ignore
            }
        }
        if (!reply) {
            reply = 'Session continued, but no text response was returned.';
        }
        return server_1.NextResponse.json({ ok: true, reply });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/sessions/continue error');
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to continue session' }, { status: 500 });
    }
}
exports.dynamic = 'force-dynamic';
