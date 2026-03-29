"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const crypto_1 = require("crypto");
const db_1 = require("@/lib/db");
const password_1 = require("@/lib/password");
const auth_1 = require("@/lib/auth");
const session_cookie_1 = require("@/lib/session-cookie");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 * Validates token, updates password, issues new session.
 */
async function POST(request) {
    try {
        const rateCheck = (0, rate_limit_1.loginLimiter)(request);
        if (rateCheck)
            return rateCheck;
        const body = await request.json().catch(() => ({}));
        const rawToken = String((body === null || body === void 0 ? void 0 : body.token) || '').trim();
        const newPassword = String((body === null || body === void 0 ? void 0 : body.password) || '');
        if (!rawToken || !newPassword) {
            return server_1.NextResponse.json({ error: 'token and password are required' }, { status: 400 });
        }
        if (newPassword.length < 12) {
            return server_1.NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 });
        }
        const tokenHash = (0, crypto_1.createHash)('sha256').update(rawToken).digest('hex');
        const now = Math.floor(Date.now() / 1000);
        const db = (0, db_1.getDatabase)();
        const record = db.prepare(`
      SELECT prt.id, prt.user_id, u.workspace_id
      FROM password_reset_tokens prt
      JOIN users u ON u.id = prt.user_id
      WHERE prt.token_hash = ?
        AND prt.expires_at > ?
        AND prt.used_at IS NULL
      LIMIT 1
    `).get(tokenHash, now);
        if (!record) {
            return server_1.NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
        }
        // Update password and mark token used in one transaction
        db.transaction(() => {
            db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
                .run((0, password_1.hashPassword)(newPassword), now, record.user_id);
            db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
                .run(now, record.id);
            // Invalidate all sessions for this user for security
            db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(record.user_id);
        })();
        const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;
        const { token, expiresAt } = (0, auth_1.createSession)(record.user_id, ipAddress, userAgent, record.workspace_id);
        const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
        const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
        const response = server_1.NextResponse.json({ ok: true });
        response.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - now, isSecureRequest })));
        return response;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/auth/reset-password error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
