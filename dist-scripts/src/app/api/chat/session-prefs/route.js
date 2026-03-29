"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.PATCH = PATCH;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const PREFS_KEY = 'chat.session_prefs.v1';
const ALLOWED_COLORS = new Set(['slate', 'blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal']);
function loadPrefs() {
    const db = (0, db_1.getDatabase)();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PREFS_KEY);
    if (!(row === null || row === void 0 ? void 0 : row.value))
        return {};
    try {
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch (_a) {
        return {};
    }
}
function savePrefs(prefs, username) {
    const db = (0, db_1.getDatabase)();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(PREFS_KEY, JSON.stringify(prefs), 'Chat local session preferences (rename + color tags)', 'chat', username, now);
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        return server_1.NextResponse.json({ prefs: loadPrefs() });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/chat/session-prefs error');
        return server_1.NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
    }
}
/**
 * PATCH /api/chat/session-prefs
 * Body: { key: "claude-code:<sessionId>", name?: string, color?: string | null }
 */
async function PATCH(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json().catch(() => ({}));
        const key = typeof (body === null || body === void 0 ? void 0 : body.key) === 'string' ? body.key.trim() : '';
        if (!key || !/^[a-zA-Z0-9_-]+:[a-zA-Z0-9._:-]+$/.test(key)) {
            return server_1.NextResponse.json({ error: 'Invalid key' }, { status: 400 });
        }
        const nextName = (body === null || body === void 0 ? void 0 : body.name) === null ? '' : (typeof (body === null || body === void 0 ? void 0 : body.name) === 'string' ? body.name.trim() : undefined);
        const nextColor = (body === null || body === void 0 ? void 0 : body.color) === null ? '' : (typeof (body === null || body === void 0 ? void 0 : body.color) === 'string' ? body.color.trim().toLowerCase() : undefined);
        if (typeof nextName === 'string' && nextName.length > 80) {
            return server_1.NextResponse.json({ error: 'name must be <= 80 chars' }, { status: 400 });
        }
        if (typeof nextColor === 'string' && nextColor && !ALLOWED_COLORS.has(nextColor)) {
            return server_1.NextResponse.json({ error: 'Invalid color' }, { status: 400 });
        }
        const prefs = loadPrefs();
        const existing = prefs[key] || {};
        const updated = Object.assign(Object.assign(Object.assign({}, existing), (typeof nextName === 'string' ? { name: nextName || undefined } : {})), (typeof nextColor === 'string' ? { color: nextColor || undefined } : {}));
        if (!updated.name && !updated.color) {
            delete prefs[key];
        }
        else {
            prefs[key] = updated;
        }
        savePrefs(prefs, auth.user.username);
        return server_1.NextResponse.json({ ok: true, pref: prefs[key] || null });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PATCH /api/chat/session-prefs error');
        return server_1.NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
    }
}
exports.dynamic = 'force-dynamic';
