"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const crypto_1 = require("crypto");
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const validation_1 = require("@/lib/validation");
const rate_limit_1 = require("@/lib/rate-limit");
function makeUsernameFromEmail(email) {
    const base = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user';
    return base.slice(0, 28);
}
function ensureUniqueUsername(base) {
    const db = (0, db_1.getDatabase)();
    let candidate = base;
    let i = 0;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
        i += 1;
        candidate = `${base.slice(0, 24)}-${i}`;
    }
    return candidate;
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const user = (0, auth_1.getUserFromRequest)(request);
    if (!user || user.role !== 'admin') {
        return server_1.NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const db = (0, db_1.getDatabase)();
    db.exec(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'google',
      email TEXT NOT NULL,
      provider_user_id TEXT,
      display_name TEXT,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
      attempt_count INTEGER NOT NULL DEFAULT 1,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      review_note TEXT,
      approved_user_id INTEGER
    )
  `);
    const status = String(request.nextUrl.searchParams.get('status') || 'all');
    const rows = status === 'all'
        ? db.prepare("SELECT * FROM access_requests ORDER BY status = 'pending' DESC, last_attempt_at DESC, id DESC").all()
        : db.prepare('SELECT * FROM access_requests WHERE status = ? ORDER BY last_attempt_at DESC, id DESC').all(status);
    return server_1.NextResponse.json({ requests: rows });
}
async function POST(request) {
    const admin = (0, auth_1.getUserFromRequest)(request);
    if (!admin || admin.role !== 'admin') {
        return server_1.NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const result = await (0, validation_1.validateBody)(request, validation_1.accessRequestActionSchema);
    if ('error' in result)
        return result.error;
    const db = (0, db_1.getDatabase)();
    const { request_id: requestId, action, role, note } = result.data;
    const reqRow = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId);
    if (!reqRow)
        return server_1.NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (action === 'reject') {
        db.prepare(`
      UPDATE access_requests
      SET status = 'rejected', reviewed_by = ?, reviewed_at = (unixepoch()), review_note = ?
      WHERE id = ?
    `).run(admin.username, note, requestId);
        (0, db_1.logAuditEvent)({
            action: 'access_request_rejected',
            actor: admin.username,
            actor_id: admin.id,
            detail: { request_id: requestId, email: reqRow.email, note },
        });
        return server_1.NextResponse.json({ ok: true });
    }
    const email = String(reqRow.email || '').toLowerCase();
    const providerUserId = reqRow.provider_user_id ? String(reqRow.provider_user_id) : null;
    const displayName = String(reqRow.display_name || email.split('@')[0] || 'Google User');
    const avatarUrl = reqRow.avatar_url ? String(reqRow.avatar_url) : null;
    const user = db.transaction(() => {
        const existing = db.prepare('SELECT * FROM users WHERE lower(email) = ? OR (provider = ? AND provider_user_id = ?) ORDER BY id ASC LIMIT 1').get(email, 'google', providerUserId || '');
        let userId;
        if (existing) {
            db.prepare(`
        UPDATE users
        SET provider = 'google', provider_user_id = ?, email = ?, avatar_url = COALESCE(?, avatar_url), is_approved = 1, role = ?, approved_by = ?, approved_at = (unixepoch()), updated_at = (unixepoch())
        WHERE id = ?
      `).run(providerUserId, email, avatarUrl, role, admin.username, existing.id);
            userId = Number(existing.id);
        }
        else {
            const username = ensureUniqueUsername(makeUsernameFromEmail(email));
            const randomPwd = (0, crypto_1.randomBytes)(24).toString('hex');
            const created = (0, auth_1.createUser)(username, randomPwd, displayName, role, {
                provider: 'google',
                provider_user_id: providerUserId,
                email,
                avatar_url: avatarUrl,
                is_approved: 1,
                approved_by: admin.username,
                approved_at: Math.floor(Date.now() / 1000),
            });
            userId = created.id;
        }
        db.prepare(`
      UPDATE access_requests
      SET status = 'approved', reviewed_by = ?, reviewed_at = (unixepoch()), review_note = ?, approved_user_id = ?
      WHERE id = ?
    `).run(admin.username, note, userId, requestId);
        return db.prepare('SELECT id, username, display_name, role, provider, email, avatar_url, is_approved FROM users WHERE id = ?').get(userId);
    })();
    (0, db_1.logAuditEvent)({
        action: 'access_request_approved',
        actor: admin.username,
        actor_id: admin.id,
        detail: { request_id: requestId, email, role, user_id: user === null || user === void 0 ? void 0 : user.id, note },
    });
    return server_1.NextResponse.json({ ok: true, user });
}
