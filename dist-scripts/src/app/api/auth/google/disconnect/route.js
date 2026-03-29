"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
async function POST(request) {
    const user = (0, auth_1.getUserFromRequest)(request);
    if (!user || user.id === 0) {
        return server_1.NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (user.provider !== 'google') {
        return server_1.NextResponse.json({ error: 'Account is not connected to Google' }, { status: 400 });
    }
    const db = (0, db_1.getDatabase)();
    // Check that the user has a password set so they can still log in after disconnect
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!(row === null || row === void 0 ? void 0 : row.password_hash)) {
        return server_1.NextResponse.json({ error: 'Cannot disconnect Google — no password set. Set a password first to avoid being locked out.' }, { status: 400 });
    }
    db.prepare(`
    UPDATE users
    SET provider = 'local', provider_user_id = NULL, updated_at = (unixepoch())
    WHERE id = ?
  `).run(user.id);
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;
    (0, db_1.logAuditEvent)({
        action: 'google_disconnect',
        actor: user.username,
        actor_id: user.id,
        ip_address: ipAddress,
        user_agent: userAgent,
    });
    return server_1.NextResponse.json({ ok: true });
}
