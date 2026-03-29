"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const google_auth_1 = require("@/lib/google-auth");
const session_cookie_1 = require("@/lib/session-cookie");
const rate_limit_1 = require("@/lib/rate-limit");
function upsertAccessRequest(input) {
    const db = (0, db_1.getDatabase)();
    db.prepare(`
    INSERT INTO access_requests (provider, email, provider_user_id, display_name, avatar_url, status, attempt_count, requested_at, last_attempt_at)
    VALUES ('google', ?, ?, ?, ?, 'pending', 1, (unixepoch()), (unixepoch()))
    ON CONFLICT(email, provider) DO UPDATE SET
      provider_user_id = excluded.provider_user_id,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      status = 'pending',
      attempt_count = access_requests.attempt_count + 1,
      last_attempt_at = (unixepoch())
  `).run(input.email.toLowerCase(), input.providerUserId, input.displayName, input.avatarUrl || null);
}
async function POST(request) {
    var _a, _b, _c, _d;
    const rateCheck = (0, rate_limit_1.loginLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const body = await request.json().catch(() => ({}));
        const credential = String((body === null || body === void 0 ? void 0 : body.credential) || '');
        const profile = await (0, google_auth_1.verifyGoogleIdToken)(credential);
        const db = (0, db_1.getDatabase)();
        const email = String(profile.email || '').toLowerCase().trim();
        const sub = String(profile.sub || '').trim();
        const displayName = String(profile.name || email.split('@')[0] || 'Google User').trim();
        const avatar = profile.picture ? String(profile.picture) : null;
        const row = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE (provider = 'google' AND provider_user_id = ?) OR lower(email) = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(sub, email);
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;
        if (!row || Number((_a = row.is_approved) !== null && _a !== void 0 ? _a : 1) !== 1) {
            upsertAccessRequest({
                email,
                providerUserId: sub,
                displayName,
                avatarUrl: avatar || undefined,
            });
            (0, db_1.logAuditEvent)({
                action: 'google_login_pending_approval',
                actor: email,
                detail: { email, sub },
                ip_address: ipAddress,
                user_agent: userAgent,
            });
            return server_1.NextResponse.json({ error: 'Access request pending admin approval', code: 'PENDING_APPROVAL' }, { status: 403 });
        }
        db.prepare(`
      UPDATE users
      SET provider = 'google', provider_user_id = ?, email = ?, avatar_url = COALESCE(?, avatar_url), updated_at = (unixepoch())
      WHERE id = ?
    `).run(sub, email, avatar, row.id);
        const { token, expiresAt } = (0, auth_1.createSession)(row.id, ipAddress, userAgent, (_b = row.workspace_id) !== null && _b !== void 0 ? _b : 1);
        (0, db_1.logAuditEvent)({ action: 'login_google', actor: row.username, actor_id: row.id, ip_address: ipAddress, user_agent: userAgent });
        const response = server_1.NextResponse.json({
            user: {
                id: row.id,
                username: row.username,
                display_name: row.display_name,
                role: row.role,
                provider: 'google',
                email,
                avatar_url: avatar,
                workspace_id: (_c = row.workspace_id) !== null && _c !== void 0 ? _c : 1,
                tenant_id: (_d = row.tenant_id) !== null && _d !== void 0 ? _d : 1,
            },
        });
        const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
        const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
        response.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest })));
        return response;
    }
    catch (error) {
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Google login failed' }, { status: 400 });
    }
}
